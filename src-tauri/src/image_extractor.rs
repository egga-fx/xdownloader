use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use regex::Regex;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::db::Database;
use crate::models::{ActiveDownloadTask, DownloadRecord, TaskProgress, VideoInfo};

#[derive(Debug, Clone)]
pub struct ImageMediaItem {
    pub url: String,
    pub filename: String,
}

#[derive(Debug, Clone)]
pub struct ImageMediaBundle {
    pub id: String,
    pub source_url: String,
    pub title: String,
    pub author: String,
    pub platform: String,
    pub thumbnail: String,
    pub images: Vec<ImageMediaItem>,
    pub audio_url: Option<String>,
}

fn create_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

/// 1. Pinterest Image Extractor
pub fn parse_pinterest_html(html: &str, url: &str) -> Result<ImageMediaBundle, String> {
    // Extract original / high-resolution image URL from HTML / embedded script
    let mut found_img: Option<String> = None;

    // 1. Check embedded JSON for images_orig
    let orig_re = Regex::new(r#""images_orig"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)""#).unwrap();
    if let Some(caps) = orig_re.captures(html) {
        if let Some(m) = caps.get(1) {
            found_img = Some(m.as_str().to_string());
        }
    }

    // 2. Check imageLargeUrl
    if found_img.is_none() {
        let large_re = Regex::new(r#""imageLargeUrl"\s*:\s*"([^"]+)""#).unwrap();
        if let Some(caps) = large_re.captures(html) {
            if let Some(m) = caps.get(1) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    // 3. Check link rel="preload" as="image"
    if found_img.is_none() {
        let link_re = Regex::new(r#"<link\s+[^>]*href="([^"]+)"[^>]*rel="preload"|<link\s+[^>]*rel="preload"[^>]*href="([^"]+)""#).unwrap();
        if let Some(caps) = link_re.captures(html) {
            if let Some(m) = caps.get(1).or_else(|| caps.get(2)) {
                let s = m.as_str();
                if s.contains("pinimg.com") {
                    found_img = Some(s.to_string());
                }
            }
        }
    }

    // 4. Check og:image or twitter:image
    if found_img.is_none() {
        let meta_re = Regex::new(r#"(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)"|content="([^"]+)"\s+(?:property|name)="(?:og:image|twitter:image)""#).unwrap();
        if let Some(caps) = meta_re.captures(html) {
            if let Some(m) = caps.get(1).or_else(|| caps.get(2)) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    // 5. Fallback: Any i.pinimg.com image URL in the page
    if found_img.is_none() {
        let general_re = Regex::new(r#"(https://i\.pinimg\.com/(?:originals|1200x|736x|564x|474x)/[a-zA-Z0-9/_.-]+\.(?:jpg|png|webp))"#).unwrap();
        if let Some(caps) = general_re.captures(html) {
            if let Some(m) = caps.get(1) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    let preview_img = found_img.ok_or_else(|| "Could not find image in Pinterest Pin".to_string())?;

    // Upgrade to uncompressed original quality: /736x/ or /1200x/ etc. -> /originals/
    let full_res_img = preview_img
        .replace("/1200x/", "/originals/")
        .replace("/736x/", "/originals/")
        .replace("/564x/", "/originals/")
        .replace("/474x/", "/originals/")
        .replace("/236x/", "/originals/");

    // Extract Title from seoTitle or og:title
    let title = Regex::new(r#""seoTitle"\s*:\s*"([^"]+)""#)
        .unwrap()
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            Regex::new(r#"(?:property="og:title"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:title")"#)
                .unwrap()
                .captures(html)
                .and_then(|c| c.get(1).or_else(|| c.get(2)))
                .map(|m| m.as_str().to_string())
        })
        .map(|s| s.replace("&amp;", "&").replace("&quot;", "\""))
        .unwrap_or_else(|| "Pinterest Pin".to_string());

    // Extract Pin ID from URL
    let pin_id_re = Regex::new(r"/pin/(\d+)").unwrap();
    let pin_id = pin_id_re
        .captures(url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis().to_string());

    let ext = if full_res_img.ends_with(".png") { "png" } else { "jpg" };
    let filename = format!("{}_{}.{}", sanitize_name(&title).chars().take(40).collect::<String>(), pin_id, ext);

    Ok(ImageMediaBundle {
        id: format!("pin_{}", pin_id),
        source_url: url.to_string(),
        title,
        author: "Pinterest".to_string(),
        platform: "pinterest".to_string(),
        thumbnail: preview_img,
        images: vec![ImageMediaItem {
            url: full_res_img,
            filename,
        }],
        audio_url: None,
    })
}

pub async fn extract_pinterest_image(url: &str) -> Result<ImageMediaBundle, String> {
    let client = create_http_client();
    let resp = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Pinterest request failed: {}", e))?;

    let html = resp.text().await.map_err(|e| format!("Failed to read Pinterest HTML: {}", e))?;
    parse_pinterest_html(&html, url)
}

pub fn parse_slide_index(u: &str) -> Option<usize> {
    if let Ok(re) = Regex::new(r#"[?&]img_index=(\d+)"#) {
        if let Some(caps) = re.captures(u) {
            if let Some(m) = caps.get(1) {
                if let Ok(idx) = m.as_str().parse::<usize>() {
                    return Some(idx);
                }
            }
        }
    }
    if let Ok(re) = Regex::new(r#"/photo/(\d+)"#) {
        if let Some(caps) = re.captures(u) {
            if let Some(m) = caps.get(1) {
                if let Ok(idx) = m.as_str().parse::<usize>() {
                    return Some(idx);
                }
            }
        }
    }
    None
}

/// 2. X (Twitter) Photo Extractor via VxTwitter & FxTwitter APIs
pub fn parse_x_vxtwitter_json(
    json_val: &serde_json::Value,
    url: &str,
    user: &str,
    tweet_id: &str,
) -> Option<ImageMediaBundle> {
    let text = json_val["text"].as_str().unwrap_or("X Photo").to_string();
    let author_name = json_val["user_name"].as_str().unwrap_or(user).to_string();
    let screen_name = json_val["user_screen_name"].as_str().unwrap_or(user).to_string();

    let mut image_items: Vec<ImageMediaItem> = Vec::new();
    if let Some(media_urls) = json_val["mediaURLs"].as_array() {
        for (idx, u) in media_urls.iter().enumerate() {
            if let Some(photo_url) = u.as_str() {
                let mut orig_url = photo_url.to_string();
                if orig_url.contains("name=") {
                    orig_url = Regex::new(r"name=\w+")
                        .unwrap()
                        .replace(&orig_url, "name=orig")
                        .to_string();
                } else if !orig_url.contains("?") {
                    orig_url.push_str("?name=orig");
                }

                let ext = if orig_url.contains(".png") { "png" } else { "jpg" };
                let filename = format!("{}_photo_{:02}.{}", tweet_id, idx + 1, ext);
                image_items.push(ImageMediaItem {
                    url: orig_url,
                    filename,
                });
            }
        }
    }

    if !image_items.is_empty() {
        let target_idx = parse_slide_index(url);
        let thumb = if let Some(idx) = target_idx {
            if idx >= 1 && idx <= image_items.len() {
                image_items[idx - 1].url.clone()
            } else {
                image_items[0].url.clone()
            }
        } else {
            image_items[0].url.clone()
        };

        let title = if text.trim().is_empty() {
            format!("X Photo by @{}", screen_name)
        } else {
            text.chars().take(80).collect()
        };

        return Some(ImageMediaBundle {
            id: format!("x_{}", tweet_id),
            source_url: url.to_string(),
            title,
            author: format!("{} (@{})", author_name, screen_name),
            platform: "x".to_string(),
            thumbnail: thumb,
            images: image_items,
            audio_url: None,
        });
    }

    None
}

pub fn parse_x_fxtwitter_json(
    json_val: &serde_json::Value,
    url: &str,
    user: &str,
    tweet_id: &str,
) -> Result<ImageMediaBundle, String> {
    let tweet = &json_val["tweet"];
    let text = tweet["text"].as_str().unwrap_or("X Photo").to_string();
    let author_name = tweet["author"]["name"]
        .as_str()
        .or_else(|| tweet["author"]["screen_name"].as_str())
        .unwrap_or(user)
        .to_string();

    let photos = tweet["media"]["photos"].as_array();
    let mut image_items: Vec<ImageMediaItem> = Vec::new();

    if let Some(photo_list) = photos {
        for (idx, p) in photo_list.iter().enumerate() {
            if let Some(photo_url) = p["url"].as_str() {
                let mut orig_url = photo_url.to_string();
                if orig_url.contains("name=") {
                    orig_url = Regex::new(r"name=\w+")
                        .unwrap()
                        .replace(&orig_url, "name=orig")
                        .to_string();
                } else if !orig_url.contains("?") {
                    orig_url.push_str("?name=orig");
                }

                let ext = if orig_url.contains(".png") { "png" } else { "jpg" };
                let filename = format!("{}_photo_{:02}.{}", tweet_id, idx + 1, ext);
                image_items.push(ImageMediaItem {
                    url: orig_url,
                    filename,
                });
            }
        }
    }

    if image_items.is_empty() {
        return Err("No photos found in this X post".to_string());
    }

    let target_idx = parse_slide_index(url);
    let thumb = if let Some(idx) = target_idx {
        if idx >= 1 && idx <= image_items.len() {
            image_items[idx - 1].url.clone()
        } else {
            image_items[0].url.clone()
        }
    } else {
        image_items[0].url.clone()
    };
    let title = if text.trim().is_empty() {
        format!("X Photo by @{}", user)
    } else {
        text.chars().take(80).collect()
    };

    Ok(ImageMediaBundle {
        id: format!("x_{}", tweet_id),
        source_url: url.to_string(),
        title,
        author: format!("{} (@{})", author_name, user),
        platform: "x".to_string(),
        thumbnail: thumb,
        images: image_items,
        audio_url: None,
    })
}

pub async fn extract_x_photos(url: &str) -> Result<ImageMediaBundle, String> {
    let client = create_http_client();

    // Extract status ID from X URL
    let status_re = Regex::new(r"(?:twitter\.com|x\.com)/(?:#!/)?(\w+)/status/(\d+)").unwrap();
    let caps = status_re
        .captures(url)
        .ok_or_else(|| "Invalid X/Twitter status URL".to_string())?;

    let user = caps[1].to_string();
    let tweet_id = caps[2].to_string();

    // Try 1: VxTwitter API
    let vx_url = format!("https://api.vxtwitter.com/{}/status/{}", user, tweet_id);
    if let Ok(resp) = client
        .get(&vx_url)
        .header("Accept", "application/json")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(json_val) = resp.json::<serde_json::Value>().await {
                if let Some(bundle) = parse_x_vxtwitter_json(&json_val, url, &user, &tweet_id) {
                    return Ok(bundle);
                }
            }
        }
    }

    // Try 2: FxTwitter API Fallback
    let fx_url = format!("https://api.fxtwitter.com/{}/status/{}", user, tweet_id);
    let resp = client
        .get(&fx_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to query tweet details: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Tweet API returned HTTP {}", resp.status()));
    }

    let json_val: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse tweet JSON: {}", e))?;

    parse_x_fxtwitter_json(&json_val, url, &user, &tweet_id)
}

/// 3. TikTok Photo Mode & Carousel Extractor
#[derive(Deserialize)]
pub struct TikWmData {
    pub title: Option<String>,
    pub images: Option<Vec<String>>,
    pub music: Option<String>,
    pub author: Option<TikWmAuthor>,
}

#[derive(Deserialize)]
pub struct TikWmAuthor {
    pub unique_id: Option<String>,
    pub nickname: Option<String>,
}

#[derive(Deserialize)]
pub struct TikWmResponse {
    pub code: i32,
    pub data: Option<TikWmData>,
}

pub fn parse_tiktok_response(res_obj: &TikWmResponse, url: &str) -> Result<ImageMediaBundle, String> {
    if res_obj.code != 0 || res_obj.data.is_none() {
        return Err("TikTok did not return any media. The post might be private or removed.".to_string());
    }

    let data = res_obj.data.as_ref().unwrap();
    let image_urls = data.images.as_ref().cloned().unwrap_or_default();

    if image_urls.is_empty() {
        return Err("No photos found in this TikTok post.".to_string());
    }

    let title = data.title.clone().unwrap_or_else(|| "TikTok Photo Mode".to_string());
    let author_name = data
        .author
        .as_ref()
        .and_then(|a| a.unique_id.clone().or_else(|| a.nickname.clone()))
        .unwrap_or_else(|| "TikTok Creator".to_string());

    let mut images = Vec::new();
    for (idx, img_url) in image_urls.iter().enumerate() {
        let filename = format!("slide_{:02}.jpg", idx + 1);
        images.push(ImageMediaItem {
            url: img_url.clone(),
            filename,
        });
    }

    let thumb = images[0].url.clone();

    Ok(ImageMediaBundle {
        id: format!("tiktok_photo_{}", chrono::Utc::now().timestamp_millis()),
        source_url: url.to_string(),
        title,
        author: format!("@{}", author_name),
        platform: "tiktok".to_string(),
        thumbnail: thumb,
        images,
        audio_url: data.music.clone(),
    })
}

pub async fn extract_tiktok_photos(url: &str) -> Result<ImageMediaBundle, String> {
    let client = create_http_client();
    let api_url = format!("https://www.tikwm.com/api/?url={}", url);

    let resp = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch TikTok details: {}", e))?;

    let res_obj: TikWmResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse TikTok photo response: {}", e))?;

    parse_tiktok_response(&res_obj, url)
}

/// Cleans raw text into a standard post caption/title.
/// Strips quotes, hashtags, illegal filename characters, and collapses whitespace.
pub fn clean_instagram_caption(raw: &str) -> Option<String> {
    let mut text = raw
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");

    // If text is wrapped in pattern like: Username on Instagram: "Caption" or ...: "Caption"
    if let Ok(quote_pattern) = Regex::new(r#"(?:on Instagram|likes?|comments?|Instagram photo by [^:]+)?:\s*["“]([^"”]+)["”]"#) {
        if let Some(caps) = quote_pattern.captures(&text) {
            if let Some(m) = caps.get(1) {
                text = m.as_str().to_string();
            }
        }
    }

    // Take first line (before newline)
    let first_line = text.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return None;
    }

    // Strip hashtags (e.g. #travel #bali)
    let without_hashtags = if let Ok(hashtag_re) = Regex::new(r"#\S+") {
        hashtag_re.replace_all(first_line, "").to_string()
    } else {
        first_line.to_string()
    };

    // Sanitize invalid filesystem characters
    let sanitized: String = without_hashtags
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\n' | '\r' | '\t' => ' ',
            _ => c,
        })
        .collect();

    // Collapse multiple spaces into single space
    let clean = if let Ok(ws_re) = Regex::new(r"\s+") {
        ws_re.replace_all(&sanitized, " ").trim().to_string()
    } else {
        sanitized.trim().to_string()
    };

    // Filter out generic placeholders
    let lower = clean.to_lowercase();
    if lower.is_empty()
        || lower.len() < 2
        || lower == "instagram"
        || lower == "instagram post"
        || lower == "instagram video"
        || lower == "instagram photo"
        || lower == "instagram reel"
        || lower == "untitled"
        || lower == "untitled media"
        || lower.starts_with("video by")
        || lower.starts_with("post by")
        || lower.starts_with("photo by")
        || lower.starts_with("instagram photo by")
        || lower.starts_with("instagram post by")
        || lower.starts_with("instagram video by")
    {
        return None;
    }

    // Ensure at least 2 alphanumeric characters exist
    let alnum_count = clean.chars().filter(|c| c.is_alphanumeric()).count();
    if alnum_count < 2 {
        return None;
    }

    // Limit length to max 50 characters to prevent excessive path lengths
    let truncated: String = clean.chars().take(50).collect();
    let final_clean = truncated.trim().to_string();
    if final_clean.is_empty() {
        None
    } else {
        Some(final_clean)
    }
}

pub fn extract_instagram_html_timestamp(html: &str) -> String {
    // 1. ISO 8601 timestamps in meta or JSON-LD
    if let Ok(iso_re) = Regex::new(r#"(?:article:published_time|uploadDate|datePublished)"\s*(?::\s*"|content=")([^"T]+T[^"Z]+Z?)"#) {
        if let Some(caps) = iso_re.captures(html) {
            if let Some(m) = caps.get(1) {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(m.as_str()) {
                    return dt.format("%Y%m%d_%H%M%S").to_string();
                }
            }
        }
    }

    // 2. UNIX timestamp in embedded json
    if let Ok(ts_re) = Regex::new(r#""(?:taken_at_timestamp|upload_date)"\s*:\s*(\d{9,11})"#) {
        if let Some(caps) = ts_re.captures(html) {
            if let Some(m) = caps.get(1) {
                if let Ok(ts) = m.as_str().parse::<i64>() {
                    if let Some(dt) = chrono::DateTime::from_timestamp(ts, 0) {
                        return dt.format("%Y%m%d_%H%M%S").to_string();
                    }
                }
            }
        }
    }

    // Fallback: local now timestamp
    chrono::Local::now().format("%Y%m%d_%H%M%S").to_string()
}

pub fn extract_instagram_json_timestamp(json_val: &serde_json::Value) -> String {
    if let Some(ts) = json_val["timestamp"].as_i64() {
        if let Some(dt) = chrono::DateTime::from_timestamp(ts, 0) {
            return dt.format("%Y%m%d_%H%M%S").to_string();
        }
    }
    if let Some(upload_date) = json_val["upload_date"].as_str() {
        let clean = upload_date.trim();
        if clean.len() == 8 && clean.chars().all(|c| c.is_ascii_digit()) {
            return clean.to_string();
        }
    }
    chrono::Local::now().format("%Y%m%d_%H%M%S").to_string()
}

pub fn format_instagram_standard_title(
    timestamp_str: &str,
    candidate_title: Option<&str>,
    candidate_desc: Option<&str>,
    post_id: &str,
) -> String {
    let clean_ts = timestamp_str.trim();

    // Check candidate_desc first, then candidate_title
    let maybe_clean = candidate_desc
        .and_then(clean_instagram_caption)
        .or_else(|| candidate_title.and_then(clean_instagram_caption));

    match maybe_clean {
        Some(title) if !title.is_empty() => format!("{}_{}", clean_ts, title),
        _ => format!("{}_{}", clean_ts, post_id.trim()),
    }
}

/// 4. Instagram Image / Carousel Extractor via OpenGraph & Embedded JSON
pub fn parse_instagram_html(html: &str, url: &str) -> Result<ImageMediaBundle, String> {
    let mut image_urls: Vec<String> = Vec::new();

    let clean_url = |raw: &str| -> String {
        raw.replace(r"\/", "/")
            .replace(r"\u0026", "&")
            .replace("&amp;", "&")
            .trim()
            .to_string()
    };

    // If the post explicitly indicates it is a video (e.g. Reels or video posts), do not treat it as an image bundle
    if html.contains(r#"property="og:video""#)
        || html.contains(r#"content="video""#)
        || html.contains(r#""is_video":true"#)
        || html.contains(r#""is_video": true"#)
    {
        return Err("This Instagram post is a video, not an image".to_string());
    }

    // 1. Scoped Carousel Extraction: Look specifically for carousel children in edge_sidecar_to_children or carousel_media
    // Use (?s) so '.' matches across newlines in JSON payloads.
    let sidecar_re = Regex::new(r#"(?s)(?:"edge_sidecar_to_children"\s*:\s*\{.*?"edges"\s*:\s*\[|"carousel_media"\s*:\s*\[)(.*?)\]"#).ok();
    if let Some(re) = sidecar_re {
        if let Some(caps) = re.captures(html) {
            if let Some(edges_block) = caps.get(1) {
                if let Ok(display_re) = Regex::new(r#""(?:display_url|url)"\s*:\s*"([^"]+)""#) {
                    for cap in display_re.captures_iter(edges_block.as_str()) {
                        if let Some(m) = cap.get(1) {
                            let u = clean_url(m.as_str());
                            if (u.starts_with("http://") || u.starts_with("https://")) && !image_urls.contains(&u) {
                                image_urls.push(u);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Single Post Extraction: If no sidecar was found, extract only the first main display_url
    if image_urls.is_empty() {
        if let Ok(display_re) = Regex::new(r#""display_url"\s*:\s*"([^"]+)""#) {
            if let Some(cap) = display_re.captures(html) {
                if let Some(m) = cap.get(1) {
                    let u = clean_url(m.as_str());
                    image_urls.push(u);
                }
            }
        }
    }

    // 3. Fallback: ONLY if image_urls is still empty, fallback to og:image meta tags
    if image_urls.is_empty() {
        if let Ok(og_re) = Regex::new(r#"(?:property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image")"#) {
            for cap in og_re.captures_iter(html) {
                if let Some(m) = cap.get(1).or_else(|| cap.get(2)) {
                    let u = clean_url(m.as_str());
                    if !image_urls.contains(&u) {
                        image_urls.push(u);
                    }
                }
            }
        }
    }

    if image_urls.is_empty() {
        return Err("Could not locate high-resolution image in this Instagram post".to_string());
    }

    // Extract Post ID
    let post_id_re = Regex::new(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)").unwrap();
    let post_id = post_id_re
        .captures(url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis().to_string());

    let timestamp_str = extract_instagram_html_timestamp(html);

    // Extract title / caption candidates
    let title_re = Regex::new(r#"(?:property|name)="og:title"\s+content="([^"]+)"|content="([^"]+)"\s+(?:property|name)="og:title""#).unwrap();
    let candidate_title = title_re
        .captures(html)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .map(|m| m.as_str());

    let desc_re = Regex::new(r#"(?:property|name)="(?:og:description|description)"\s+content="([^"]+)"|content="([^"]+)"\s+(?:property|name)="(?:og:description|description)""#).unwrap();
    let candidate_desc = desc_re
        .captures(html)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .map(|m| m.as_str());

    let json_caption_re = Regex::new(r#""edge_media_to_caption"\s*:\s*\{.*?"text"\s*:\s*"([^"]+)""#).ok();
    let json_desc = json_caption_re.as_ref().and_then(|re| re.captures(html)).and_then(|c| c.get(1)).map(|m| m.as_str());

    let standard_title = format_instagram_standard_title(
        &timestamp_str,
        candidate_title,
        json_desc.or(candidate_desc),
        &post_id,
    );

    let is_carousel = image_urls.len() > 1;
    let mut images: Vec<ImageMediaItem> = Vec::new();
    for (idx, u) in image_urls.iter().enumerate() {
        let filename = if is_carousel {
            format!("{}_{:02}.jpg", standard_title, idx + 1)
        } else {
            format!("{}.jpg", standard_title)
        };
        images.push(ImageMediaItem {
            url: u.clone(),
            filename,
        });
    }

    let thumbnail = images[0].url.clone();

    Ok(ImageMediaBundle {
        id: format!("ig_{}", post_id),
        source_url: url.to_string(),
        title: standard_title,
        author: "Instagram".to_string(),
        platform: "instagram".to_string(),
        thumbnail,
        images,
        audio_url: None,
    })
}

pub async fn extract_instagram_image(url: &str) -> Result<ImageMediaBundle, String> {
    let client = create_http_client();

    // Use Facebook crawler User-Agent to bypass Instagram client-side rendering
    let resp = client
        .get(url)
        .header(
            "User-Agent",
            "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        )
        .send()
        .await
        .map_err(|e| format!("Instagram request failed: {}", e))?;

    let html = resp.text().await.map_err(|e| format!("Failed to read Instagram HTML: {}", e))?;
    parse_instagram_html(&html, url)
}

/// Main Dispatcher for fallback image extraction
pub async fn try_extract_image_media(url: &str) -> Result<ImageMediaBundle, String> {
    if url.contains("pinterest.com") || url.contains("pin.it") {
        return extract_pinterest_image(url).await;
    }
    if url.contains("twitter.com") || url.contains("x.com") {
        return extract_x_photos(url).await;
    }
    if url.contains("tiktok.com") {
        return extract_tiktok_photos(url).await;
    }
    if url.contains("instagram.com") {
        return extract_instagram_image(url).await;
    }

    Err("No dedicated image extractor available for this domain".to_string())
}

/// Creates an ImageMediaBundle directly from a pre-extracted list of image URLs
pub fn create_bundle_from_urls(
    id: &str,
    source_url: &str,
    title: &str,
    platform: &str,
    image_urls: &[String],
) -> ImageMediaBundle {
    let clean_title = sanitize_name(title);
    let images = image_urls
        .iter()
        .enumerate()
        .map(|(idx, u)| {
            let ext = if u.contains(".png") { "png" } else { "jpg" };
            ImageMediaItem {
                url: u.clone(),
                filename: format!("{}_{:02}.{}", clean_title, idx + 1, ext),
            }
        })
        .collect();

    let thumbnail = image_urls.first().cloned().unwrap_or_default();

    ImageMediaBundle {
        id: id.to_string(),
        source_url: source_url.to_string(),
        title: title.to_string(),
        author: platform.to_string(),
        platform: platform.to_string(),
        thumbnail,
        images,
        audio_url: None,
    }
}

/// Converts an ImageMediaBundle into a VideoInfo struct for the frontend preview
pub fn bundle_to_video_info(bundle: &ImageMediaBundle, url: &str) -> VideoInfo {
    let count = bundle.images.len();
    let formatted_title = if count > 1 {
        format!("{} [Carousel: {} Images]", bundle.title, count)
    } else {
        bundle.title.clone()
    };

    let image_urls: Vec<String> = bundle.images.iter().map(|img| img.url.clone()).collect();

    // Check if target slide index is specified in url (?img_index=N or /photo/N)
    let mut thumbnail = bundle.thumbnail.clone();
    if let Some(target_idx) = parse_slide_index(url) {
        if target_idx >= 1 && target_idx <= bundle.images.len() {
            thumbnail = bundle.images[target_idx - 1].url.clone();
        }
    }

    VideoInfo {
        id: bundle.id.clone(),
        title: formatted_title,
        duration: 0,
        thumbnail,
        uploader: bundle.author.clone(),
        channel: bundle.platform.clone(),
        description: Some("image".to_string()),
        webpage_url: url.to_string(),
        images: if count > 1 { Some(image_urls) } else { None },
    }
}

/// Downloads image items (single or carousel bundle) directly to the target folder with sequential naming
pub async fn download_image_bundle(
    app: &AppHandle,
    db: Arc<Database>,
    task_id: &str,
    bundle: &ImageMediaBundle,
    output_folder: &Path,
    custom_name: Option<String>,
    selected_indices: Option<Vec<usize>>,
) -> Result<String, String> {
    let client = create_http_client();

    let raw_name = custom_name.as_deref().unwrap_or(&bundle.title);
    let carousel_badge_re = Regex::new(r"(?i)\s*\[carousel:?\s*\d+\s*images?\]").unwrap();
    let stripped = carousel_badge_re.replace_all(raw_name, "");
    let clean_base_name = sanitize_name(stripped.trim());

    // Save directly into output_folder with sequential filenames without creating extra subfolders
    let target_dir = output_folder.to_path_buf();
    let _ = std::fs::create_dir_all(&target_dir);

    // Filter items based on selected_indices while preserving 1-based original sequence number
    let items_to_download: Vec<(usize, ImageMediaItem)> = match selected_indices {
        Some(ref indices) if !indices.is_empty() => {
            bundle.images
                .iter()
                .enumerate()
                .filter(|(idx, _)| indices.contains(idx))
                .map(|(idx, item)| (idx + 1, item.clone()))
                .collect()
        }
        _ => {
            bundle.images
                .iter()
                .enumerate()
                .map(|(idx, item)| (idx + 1, item.clone()))
                .collect()
        }
    };

    let total_items = items_to_download.len() + if bundle.audio_url.is_some() { 1 } else { 0 };

    let mut primary_saved_path = String::new();
    let mut total_bytes: i64 = 0;

    for (step_idx, (slide_idx, item)) in items_to_download.iter().enumerate() {
        let ext = if item.url.contains(".png") { "png" } else { "jpg" };
        let filename = if bundle.images.len() > 1 {
            format!("{}_{:02}.{}", clean_base_name, slide_idx, ext)
        } else {
            format!("{}.{}", clean_base_name, ext)
        };
        let dest_file = target_dir.join(&filename);

        let resp = client
            .get(&item.url)
            .send()
            .await
            .map_err(|e| format!("Failed to download image {}: {}", filename, e))?;

        if !resp.status().is_success() {
            return Err(format!("Image download failed with HTTP {}", resp.status()));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read image bytes: {}", e))?;

        total_bytes += bytes.len() as i64;
        std::fs::write(&dest_file, &bytes)
            .map_err(|e| format!("Failed to write file {:?}: {}", dest_file, e))?;

        if primary_saved_path.is_empty() {
            primary_saved_path = dest_file.to_string_lossy().to_string();
        }

        let percent = ((step_idx + 1) as f64 / total_items as f64) * 100.0;
        let _ = app.emit(
            "download-progress",
            ActiveDownloadTask {
                task_id: task_id.to_string(),
                url: item.url.clone(),
                title: bundle.title.clone(),
                platform: bundle.platform.clone(),
                format_type: "image".to_string(),
                quality: "original".to_string(),
                status: "downloading".to_string(),
                progress: TaskProgress {
                    percent,
                    speed_str: format!("{}/{}", step_idx + 1, total_items),
                    eta_str: "00:00".to_string(),
                    downloaded_bytes: Some(total_bytes),
                    total_bytes: Some(total_bytes),
                },
                error: None,
            },
        );
    }

    // Download background audio if available (e.g. TikTok photo mode BGM)
    if let Some(ref bgm_url) = bundle.audio_url {
        let dest_audio = target_dir.join("background_music.mp3");
        if let Ok(resp) = client.get(bgm_url).send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    total_bytes += bytes.len() as i64;
                    let _ = std::fs::write(dest_audio, bytes);
                }
            }
        }
    }

    // Final record path is primary saved image or target directory
    let final_record_path = if !primary_saved_path.is_empty() {
        primary_saved_path.clone()
    } else {
        target_dir.to_string_lossy().to_string()
    };

    let count = items_to_download.len();
    let display_title = if count > 1 && !raw_name.contains("[Carousel:") {
        format!("{} [Carousel: {} Images]", clean_base_name, count)
    } else {
        clean_base_name.to_string()
    };

    // Save final record in SQLite database
    let record = DownloadRecord {
        id: task_id.to_string(),
        platform: bundle.platform.clone(),
        url: bundle.source_url.clone(),
        title: display_title,
        author: bundle.author.clone(),
        duration_sec: 0,
        thumbnail_url: bundle.thumbnail.clone(),
        format_type: "image".to_string(),
        quality: "original".to_string(),
        file_path: final_record_path.clone(),
        file_size_bytes: total_bytes,
        status: "completed".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range: None,
        exists: true,
    };

    let _ = db.add_record(&record);

    let _ = app.emit(
        "download-progress",
        ActiveDownloadTask {
            task_id: task_id.to_string(),
            url: bundle.source_url.clone(),
            title: bundle.title.clone(),
            platform: bundle.platform.clone(),
            format_type: "image".to_string(),
            quality: "original".to_string(),
            status: "completed".to_string(),
            progress: TaskProgress {
                percent: 100.0,
                speed_str: "Done".to_string(),
                eta_str: "00:00".to_string(),
                downloaded_bytes: Some(total_bytes),
                total_bytes: Some(total_bytes),
            },
            error: None,
        },
    );

    Ok(final_record_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- 1. Offline Deterministic Pure Parsing Tests ---

    #[test]
    fn test_parse_pinterest_html_offline() {
        let mock_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <link rel="preload" href="https://i.pinimg.com/736x/ab/cd/ef12345.jpg" as="image">
                <meta property="og:title" content="Minimalist Architecture Design &amp; Ideas">
            </head>
            <body></body>
            </html>
        "#;
        let url = "https://www.pinterest.com/pin/123456789012345678/";
        let res = parse_pinterest_html(mock_html, url);
        assert!(res.is_ok(), "Failed to parse Pinterest HTML: {:?}", res.err());
        let bundle = res.unwrap();
        assert_eq!(bundle.platform, "pinterest");
        assert_eq!(bundle.title, "Minimalist Architecture Design & Ideas");
        assert_eq!(bundle.images.len(), 1);
        assert_eq!(bundle.images[0].url, "https://i.pinimg.com/originals/ab/cd/ef12345.jpg");
    }

    #[test]
    fn test_parse_x_vxtwitter_json_offline() {
        let json_val = serde_json::json!({
            "text": "Stunning sunset in Kyoto #japan",
            "user_name": "Kyoto Explorer",
            "user_screen_name": "kyoto_exp",
            "mediaURLs": [
                "https://pbs.twimg.com/media/GAbc123.jpg?name=large",
                "https://pbs.twimg.com/media/GAbc456.jpg?name=medium"
            ]
        });
        let url = "https://x.com/kyoto_exp/status/123456789";
        let res = parse_x_vxtwitter_json(&json_val, url, "kyoto_exp", "123456789");
        assert!(res.is_some(), "VxTwitter parser returned None");
        let bundle = res.unwrap();
        assert_eq!(bundle.platform, "x");
        assert_eq!(bundle.images.len(), 2);
        assert!(bundle.images[0].url.ends_with("name=orig"));
        assert!(bundle.images[1].url.ends_with("name=orig"));
    }

    #[test]
    fn test_parse_tiktok_response_offline() {
        let res_obj = TikWmResponse {
            code: 0,
            data: Some(TikWmData {
                title: Some("Day in Tokyo Photolog".to_string()),
                images: Some(vec![
                    "https://p16-sign.tiktokcdn.com/obj/slide1.jpg".to_string(),
                    "https://p16-sign.tiktokcdn.com/obj/slide2.jpg".to_string(),
                    "https://p16-sign.tiktokcdn.com/obj/slide3.jpg".to_string(),
                ]),
                music: Some("https://sf16.tiktokcdn.com/music.mp3".to_string()),
                author: Some(TikWmAuthor {
                    unique_id: Some("traveler_tokyo".to_string()),
                    nickname: Some("Tokyo Guide".to_string()),
                }),
            }),
        };
        let url = "https://www.tiktok.com/@traveler_tokyo/photo/7123456789";
        let res = parse_tiktok_response(&res_obj, url);
        assert!(res.is_ok(), "Failed to parse TikTok response: {:?}", res.err());
        let bundle = res.unwrap();
        assert_eq!(bundle.platform, "tiktok");
        assert_eq!(bundle.images.len(), 3);
        assert_eq!(bundle.title, "Day in Tokyo Photolog");
        assert_eq!(bundle.author, "@traveler_tokyo");
        assert!(bundle.audio_url.is_some());
    }

    #[test]
    fn test_clean_instagram_caption() {
        assert_eq!(
            clean_instagram_caption("Art Gallery Exhibition \"Moments\""),
            Some("Art Gallery Exhibition Moments".to_string())
        );
        assert_eq!(
            clean_instagram_caption("User on Instagram: \"Amazing Tokyo sunset! #japan #travel\""),
            Some("Amazing Tokyo sunset!".to_string())
        );
        // Generic titles rejected
        assert_eq!(clean_instagram_caption("Video by username"), None);
        assert_eq!(clean_instagram_caption("Instagram post by user"), None);
        assert_eq!(clean_instagram_caption("Instagram"), None);
        assert_eq!(clean_instagram_caption("#sunset #holiday"), None);
        assert_eq!(clean_instagram_caption("❤️✨"), None);
    }

    #[test]
    fn test_format_instagram_standard_title() {
        // With meaningful caption
        let res1 = format_instagram_standard_title(
            "20240315_120000",
            Some("Instagram post"),
            Some("Exploring Mount Bromo at dawn #bromo"),
            "Cxyz1234567",
        );
        assert_eq!(res1, "20240315_120000_Exploring Mount Bromo at dawn");

        // Without caption or with generic title -> fallbacks to post_id
        let res2 = format_instagram_standard_title(
            "20240315_120000",
            Some("Video by user"),
            None,
            "Cxyz1234567",
        );
        assert_eq!(res2, "20240315_120000_Cxyz1234567");
    }

    #[test]
    fn test_parse_instagram_html_offline() {
        let mock_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="article:published_time" content="2024-03-15T10:00:00Z">
                <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.2885-15/photo_highres.jpg?_nc_cat=1&amp;token=abc">
                <meta property="og:title" content="Art Gallery Exhibition &quot;Moments&quot;">
            </head>
            <body></body>
            </html>
        "#;
        let url = "https://www.instagram.com/p/Cxyz1234567/";
        let res = parse_instagram_html(mock_html, url);
        assert!(res.is_ok(), "Failed to parse Instagram HTML: {:?}", res.err());
        let bundle = res.unwrap();
        assert_eq!(bundle.platform, "instagram");
        assert_eq!(bundle.title, "20240315_100000_Art Gallery Exhibition Moments");
        assert_eq!(bundle.images.len(), 1);
        assert_eq!(bundle.images[0].url, "https://scontent.cdninstagram.com/v/t51.2885-15/photo_highres.jpg?_nc_cat=1&token=abc");
        assert_eq!(bundle.images[0].filename, "20240315_100000_Art Gallery Exhibition Moments.jpg");
    }

    #[test]
    fn test_parse_instagram_html_fallback_to_id() {
        let mock_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="article:published_time" content="2024-03-15T10:00:00Z">
                <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.2885-15/photo_highres.jpg?_nc_cat=1&amp;token=abc">
                <meta property="og:title" content="Instagram">
            </head>
            <body></body>
            </html>
        "#;
        let url = "https://www.instagram.com/p/Cxyz1234567/";
        let res = parse_instagram_html(mock_html, url);
        assert!(res.is_ok());
        let bundle = res.unwrap();
        assert_eq!(bundle.title, "20240315_100000_Cxyz1234567");
        assert_eq!(bundle.images[0].filename, "20240315_100000_Cxyz1234567.jpg");
    }

    #[test]
    fn test_parse_instagram_video_html_offline_rejection() {
        let mock_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:title" content="Video by kemenkes_ri">
                <meta property="og:video" content="https://scontent.cdninstagram.com/video.mp4">
                <meta property="og:image" content="https://scontent.cdninstagram.com/thumb.jpg">
            </head>
            <body></body>
            </html>
        "#;
        let url = "https://www.instagram.com/p/DdVzoQTTkM4/";
        let res = parse_instagram_html(mock_html, url);
        assert!(res.is_err(), "Expected Instagram video post to be rejected by image extractor");
        assert!(res.unwrap_err().contains("video"));
    }

    #[test]
    fn test_parse_instagram_carousel_html_offline() {
        let mock_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="article:published_time" content="2024-03-15T10:00:00Z">
                <meta property="og:title" content="Tokyo City Walk Highlights">
                <script type="application/json">
                    {
                        "edge_sidecar_to_children": {
                            "edges": [
                                {"node": {"display_url": "https:\/\/scontent.cdninstagram.com\/slide1.jpg?token=1\u0026v=1"}},
                                {"node": {"display_url": "https:\/\/scontent.cdninstagram.com\/slide2.jpg?token=2\u0026v=2"}},
                                {"node": {"display_url": "https:\/\/scontent.cdninstagram.com\/slide3.jpg?token=3\u0026v=3"}}
                            ]
                        }
                    }
                </script>
            </head>
            <body></body>
            </html>
        "#;
        let url = "https://www.instagram.com/p/Tokyo123456/";
        let res = parse_instagram_html(mock_html, url);
        assert!(res.is_ok(), "Failed to parse Instagram Carousel: {:?}", res.err());
        let bundle = res.unwrap();
        assert_eq!(bundle.platform, "instagram");
        assert_eq!(bundle.title, "20240315_100000_Tokyo City Walk Highlights");
        assert_eq!(bundle.images.len(), 3);
        assert_eq!(bundle.images[0].url, "https://scontent.cdninstagram.com/slide1.jpg?token=1&v=1");
        assert_eq!(bundle.images[1].url, "https://scontent.cdninstagram.com/slide2.jpg?token=2&v=2");
        assert_eq!(bundle.images[2].url, "https://scontent.cdninstagram.com/slide3.jpg?token=3&v=3");
        assert_eq!(bundle.images[0].filename, "20240315_100000_Tokyo City Walk Highlights_01.jpg");
        assert_eq!(bundle.images[1].filename, "20240315_100000_Tokyo City Walk Highlights_02.jpg");
        assert_eq!(bundle.images[2].filename, "20240315_100000_Tokyo City Walk Highlights_03.jpg");
    }

    #[test]
    fn test_parse_slide_index() {
        assert_eq!(parse_slide_index("https://x.com/txtharihariWNI/status/2100223177443905716/photo/1"), Some(1));
        assert_eq!(parse_slide_index("https://x.com/txtharihariWNI/status/2100223177443905716/photo/3"), Some(3));
        assert_eq!(parse_slide_index("https://www.instagram.com/p/DdRWIrXmji_/?img_index=5"), Some(5));
        assert_eq!(parse_slide_index("https://x.com/user/status/12345"), None);
    }

    #[test]
    fn test_bundle_to_video_info_carousel() {
        let bundle = ImageMediaBundle {
            id: "ig_test123".to_string(),
            source_url: "https://www.instagram.com/p/test123/".to_string(),
            title: "Summer Vacation".to_string(),
            author: "Instagram".to_string(),
            platform: "instagram".to_string(),
            thumbnail: "https://example.com/slide1.jpg".to_string(),
            images: vec![
                ImageMediaItem { url: "https://example.com/slide1.jpg".to_string(), filename: "slide_01.jpg".to_string() },
                ImageMediaItem { url: "https://example.com/slide2.jpg".to_string(), filename: "slide_02.jpg".to_string() },
                ImageMediaItem { url: "https://example.com/slide3.jpg".to_string(), filename: "slide_03.jpg".to_string() },
            ],
            audio_url: None,
        };

        // Without slide param
        let video_info = bundle_to_video_info(&bundle, "https://www.instagram.com/p/test123/");
        assert!(video_info.images.is_some());
        assert_eq!(video_info.images.as_ref().unwrap().len(), 3);
        assert_eq!(video_info.title, "Summer Vacation [Carousel: 3 Images]");
        assert_eq!(video_info.thumbnail, "https://example.com/slide1.jpg");

        // With /photo/3 target
        let video_info_photo3 = bundle_to_video_info(&bundle, "https://x.com/user/status/123/photo/3");
        assert_eq!(video_info_photo3.thumbnail, "https://example.com/slide3.jpg");
    }

    #[tokio::test]
    async fn test_dispatcher_routing_unsupported() {
        let unsupported_url = "https://example.com/not_supported/photo.jpg";
        let res = try_extract_image_media(unsupported_url).await;
        assert!(res.is_err(), "Expected unsupported domain to return Err");
    }

    // --- 2. Live Network Integration Tests (Marked with #[ignore]) ---

    #[tokio::test]
    #[ignore = "requires external live network connectivity"]
    async fn test_extract_pinterest_image() {
        let url = "https://id.pinterest.com/pin/2040762329258273/";
        let result = extract_pinterest_image(url).await;
        assert!(result.is_ok(), "Failed to extract Pinterest image: {:?}", result.err());
        let bundle = result.unwrap();
        assert_eq!(bundle.platform, "pinterest");
        assert!(!bundle.images.is_empty(), "Pinterest images must not be empty");
        assert!(bundle.images[0].url.contains("pinimg.com"), "Image url must be from pinimg.com");
    }

    #[tokio::test]
    #[ignore = "requires external live network connectivity"]
    async fn test_extract_x_photos() {
        let url = "https://x.com/anggarasamvdr/status/2099374138796507472/photo/1";
        let result = extract_x_photos(url).await;
        assert!(result.is_ok(), "Failed to extract X photos: {:?}", result.err());
        let bundle = result.unwrap();
        assert_eq!(bundle.platform, "x");
        assert!(!bundle.images.is_empty(), "X photo images must not be empty");
        assert!(bundle.images[0].url.contains("pbs.twimg.com"), "Image url must be from twimg");
    }

    #[tokio::test]
    #[ignore = "requires external live network connectivity"]
    async fn test_extract_tiktok_photos() {
        let url = "https://www.tiktok.com/@ra_yuthk/photo/7509108491907239176";
        let result = extract_tiktok_photos(url).await;
        assert!(result.is_ok(), "Failed to extract TikTok photos: {:?}", result.err());
        let bundle = result.unwrap();
        assert_eq!(bundle.platform, "tiktok");
        assert!(bundle.images.len() > 1, "TikTok carousel must have multiple images");
    }

    #[tokio::test]
    #[ignore = "requires external live network connectivity"]
    async fn test_extract_instagram_image() {
        let url = "https://www.instagram.com/p/DdRWIrXmji_/?img_index=1";
        let result = extract_instagram_image(url).await;
        assert!(result.is_ok(), "Failed to extract Instagram image: {:?}", result.err());
        let bundle = result.unwrap();
        assert_eq!(bundle.platform, "instagram");
        assert!(!bundle.images.is_empty(), "Instagram images must not be empty");
        assert!(bundle.images[0].url.contains("cdninstagram.com"), "Image url must be from cdninstagram.com");
    }

    #[tokio::test]
    #[ignore = "requires external live network connectivity"]
    async fn test_dispatcher_routing_live() {
        let pin_url = "https://id.pinterest.com/pin/2040762329258273/";
        let res = try_extract_image_media(pin_url).await;
        assert!(res.is_ok());
    }
}
