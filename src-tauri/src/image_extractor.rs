use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::time::Duration;
use regex::Regex;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use futures_util::future::try_join_all;

use tokio::io::{AsyncWriteExt, BufWriter};

use crate::db::Database;
use crate::models::{ActiveDownloadTask, DownloadRecord, MediaItem, TaskProgress, VideoInfo};

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

#[derive(Debug, Clone)]
pub struct MediaBundleItem {
    pub kind: String,
    pub url: String,
    pub filename: String,
    pub thumbnail: String,
    pub duration: i64,
}

#[derive(Debug, Clone)]
pub struct MediaBundle {
    pub id: String,
    pub source_url: String,
    pub title: String,
    pub author: String,
    pub platform: String,
    pub thumbnail: String,
    pub items: Vec<MediaBundleItem>,
    pub audio_url: Option<String>,
}

static SHARED_HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(10)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

static RE_PIN_ORIG: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#""images_orig"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)""#).unwrap());
static RE_PIN_LARGE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#""imageLargeUrl"\s*:\s*"([^"]+)""#).unwrap());
static RE_PIN_PRELOAD: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"<link\s+[^>]*href="([^"]+)"[^>]*rel="preload"|<link\s+[^>]*rel="preload"[^>]*href="([^"]+)""#).unwrap());
static RE_PIN_META: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)"|content="([^"]+)"\s+(?:property|name)="(?:og:image|twitter:image)""#).unwrap());
static RE_PIN_GENERAL: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"(https://i\.pinimg\.com/(?:originals|1200x|736x|564x|474x)/[a-zA-Z0-9/_.-]+\.(?:jpg|png|webp))"#).unwrap());
static RE_PIN_SEO_TITLE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#""seoTitle"\s*:\s*"([^"]+)""#).unwrap());
static RE_PIN_OG_TITLE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"(?:property="og:title"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:title")"#).unwrap());
static RE_PIN_ID: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"/pin/(\d+)").unwrap());
static RE_X_STATUS: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?:twitter\.com|x\.com)/(?:#!/)?(\w+)/status/(\d+)").unwrap());
static RE_INSTA_POST_ID: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)").unwrap());
static RE_INSTA_TITLE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"(?:property|name)="og:title"\s+content="([^"]+)"|content="([^"]+)"\s+(?:property|name)="og:title""#).unwrap());
static RE_INSTA_DESC: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"(?:property|name)="(?:og:description|description)"\s+content="([^"]+)"|content="([^"]+)"\s+(?:property|name)="(?:og:description|description)""#).unwrap());
static RE_CAROUSEL_IMAGE_BADGE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)\s*\[carousel:?\s*\d+\s*images?\]").unwrap());
static RE_CAROUSEL_MEDIA_BADGE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)\s*\[carousel:?\s*\d+\s*(?:images?|videos?|media)\]").unwrap());

fn create_http_client() -> reqwest::Client {
    SHARED_HTTP_CLIENT.clone()
}

fn sanitize_name(name: &str) -> String {
    crate::downloader::sanitize_filename(name)
}

/// 1. Pinterest Image Extractor
pub fn parse_pinterest_html(html: &str, url: &str) -> Result<ImageMediaBundle, String> {
    // Extract original / high-resolution image URL from HTML / embedded script
    let mut found_img: Option<String> = None;

    // 1. Check embedded JSON for images_orig
    if let Some(caps) = RE_PIN_ORIG.captures(html) {
        if let Some(m) = caps.get(1) {
            found_img = Some(m.as_str().to_string());
        }
    }

    // 2. Check imageLargeUrl
    if found_img.is_none() {
        if let Some(caps) = RE_PIN_LARGE.captures(html) {
            if let Some(m) = caps.get(1) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    // 3. Check link rel="preload" as="image"
    if found_img.is_none() {
        if let Some(caps) = RE_PIN_PRELOAD.captures(html) {
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
        if let Some(caps) = RE_PIN_META.captures(html) {
            if let Some(m) = caps.get(1).or_else(|| caps.get(2)) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    // 5. Fallback: Any i.pinimg.com image URL in the page
    if found_img.is_none() {
        if let Some(caps) = RE_PIN_GENERAL.captures(html) {
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
    let title = RE_PIN_SEO_TITLE
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            RE_PIN_OG_TITLE
                .captures(html)
                .and_then(|c| c.get(1).or_else(|| c.get(2)))
                .map(|m| m.as_str().to_string())
        })
        .map(|s| s.replace("&amp;", "&").replace("&quot;", "\""))
        .unwrap_or_else(|| "Pinterest Pin".to_string());

    // Extract Pin ID from URL
    let pin_id = RE_PIN_ID
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
    let caps = RE_X_STATUS
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
#[derive(Deserialize, Default)]
pub struct TikWmData {
    pub id: Option<String>,
    pub title: Option<String>,
    pub cover: Option<String>,
    pub origin_cover: Option<String>,
    pub duration: Option<i64>,
    pub play: Option<String>,
    pub images: Option<Vec<String>>,
    pub music: Option<String>,
    pub author: Option<TikWmAuthor>,
}

#[derive(Deserialize, Default)]
pub struct TikWmAuthor {
    pub unique_id: Option<String>,
    pub nickname: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct TikWmResponse {
    pub code: i32,
    pub data: Option<TikWmData>,
}

pub fn parse_tiktok_response(res_obj: &TikWmResponse, url: &str) -> Result<ImageMediaBundle, String> {
    let Some(ref data) = res_obj.data else {
        return Err("TikTok did not return any media. The post might be private or removed.".to_string());
    };
    if res_obj.code != 0 {
        return Err("TikTok did not return any media. The post might be private or removed.".to_string());
    }
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

pub async fn extract_tiktok_video_metadata(url: &str) -> Result<crate::models::VideoInfo, String> {
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
        .map_err(|e| format!("Failed to parse TikTok response: {}", e))?;

    let Some(data) = res_obj.data else {
        return Err("TikTok did not return valid video data.".to_string());
    };
    if res_obj.code != 0 {
        return Err("TikTok did not return valid video data.".to_string());
    }
    let id = data.id.unwrap_or_default();
    let raw_title = data.title.unwrap_or_default();
    let title = if !raw_title.trim().is_empty() {
        raw_title.trim().to_string()
    } else {
        "TikTok Video".to_string()
    };
    let duration = data.duration.unwrap_or(0);
    let thumbnail = data.origin_cover.or(data.cover).unwrap_or_default();
    let uploader = data.author.as_ref().and_then(|a| a.unique_id.clone()).unwrap_or_default();
    let channel = data.author.as_ref().and_then(|a| a.nickname.clone()).unwrap_or_default();

    let uploader_id = if !uploader.is_empty() { Some(uploader.clone()) } else { None };
    let description = Some(title.clone());

    Ok(crate::models::VideoInfo {
        id,
        title,
        duration,
        thumbnail,
        uploader,
        channel,
        uploader_id,
        description,
        post_type: Some("video".to_string()),
        webpage_url: url.to_string(),
        images: None,
        media_items: None,
    })
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
    let post_id = RE_INSTA_POST_ID
        .captures(url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis().to_string());

    let timestamp_str = extract_instagram_html_timestamp(html);

    // Extract title / caption candidates
    let candidate_title = RE_INSTA_TITLE
        .captures(html)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .map(|m| m.as_str());

    let candidate_desc = RE_INSTA_DESC
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

/// Helper to decode HTML entities in text scraped from OpenGraph meta tags
pub fn unescape_html_entities(input: &str) -> String {
    input
        .replace("&#064;", "@")
        .replace("&#64;", "@")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

/// Checks if a URL belongs to Threads (threads.net or threads.com)
pub fn is_threads_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("threads.net") || lower.contains("threads.com")
}

/// Unescapes HTML entities, JSON Unicode escapes (\u0026), and slash escapes (\/) in scraped URLs
pub fn clean_scraped_url(raw: &str) -> String {
    let unescaped_json = raw
        .replace(r"\u0026", "&")
        .replace(r"\u002F", "/")
        .replace(r"\u002f", "/")
        .replace(r"\u003F", "?")
        .replace(r"\u003f", "?")
        .replace(r"\u003D", "=")
        .replace(r"\u003d", "=")
        .replace(r"\/", "/");

    unescape_html_entities(&unescaped_json)
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

/// Traverses a JSON Value iteratively to locate the Threads media node matching `post_code`.
fn find_threads_media_node<'a>(val: &'a serde_json::Value, post_code: &str) -> Option<&'a serde_json::Value> {
    let mut stack = vec![val];
    while let Some(current) = stack.pop() {
        if let Some(obj) = current.as_object() {
            let code_matches = if !post_code.is_empty() {
                obj.get("code").and_then(|c| c.as_str()) == Some(post_code)
            } else {
                false
            };

            if code_matches {
                if obj.contains_key("media_type") || obj.contains_key("carousel_media") || obj.contains_key("video_versions") {
                    return Some(current);
                }
            }

            for (_, v) in obj {
                if v.is_object() || v.is_array() {
                    stack.push(v);
                }
            }
        } else if let Some(arr) = current.as_array() {
            for v in arr.iter().rev() {
                if v.is_object() || v.is_array() {
                    stack.push(v);
                }
            }
        }
    }
    None
}

/// Fallback search in JSON if exact `post_code` match was not found
fn find_any_threads_media_node<'a>(val: &'a serde_json::Value) -> Option<&'a serde_json::Value> {
    let mut stack = vec![val];
    while let Some(current) = stack.pop() {
        if let Some(obj) = current.as_object() {
            if let Some(cm) = obj.get("carousel_media").and_then(|c| c.as_array()) {
                if !cm.is_empty() {
                    return Some(current);
                }
            }
            if let Some(vv) = obj.get("video_versions").and_then(|v| v.as_array()) {
                if !vv.is_empty() {
                    return Some(current);
                }
            }
            for (_, v) in obj {
                if v.is_object() || v.is_array() {
                    stack.push(v);
                }
            }
        } else if let Some(arr) = current.as_array() {
            for v in arr.iter().rev() {
                if v.is_object() || v.is_array() {
                    stack.push(v);
                }
            }
        }
    }
    None
}

/// Parses HTML response from Threads using Googlebot User-Agent
pub fn parse_threads_html(html: &str, final_url: &str, original_url: &str) -> Result<VideoInfo, String> {
    // 1. Author resolution from URL or OpenGraph
    let mut author = String::new();
    if let Ok(author_re) = Regex::new(r"/@([A-Za-z0-9_.]+)") {
        if let Some(caps) = author_re.captures(final_url).or_else(|| author_re.captures(original_url)) {
            if let Some(m) = caps.get(1) {
                author = format!("@{}", m.as_str());
            }
        }
    }

    // 2. OpenGraph tags
    let og_title_re = Regex::new(r#"<meta\s+property="og:title"\s+content="([^"]*)""#).ok();
    let og_desc_re = Regex::new(r#"<meta\s+property="og:description"\s+content="([^"]*)""#).ok();

    let og_title = og_title_re.as_ref()
        .and_then(|re| re.captures(html))
        .and_then(|c| c.get(1))
        .map(|m| unescape_html_entities(m.as_str()))
        .unwrap_or_default();

    let og_desc = og_desc_re.as_ref()
        .and_then(|re| re.captures(html))
        .and_then(|c| c.get(1))
        .map(|m| unescape_html_entities(m.as_str()))
        .unwrap_or_default();

    let mut resolved_thumbnail = String::new();
    if let Ok(cand_re) = Regex::new(r#""candidates"\s*:\s*\[\s*\{[^}]*?"url"\s*:\s*"([^"]+)""#) {
        if let Some(caps) = cand_re.captures(html) {
            if let Some(m) = caps.get(1) {
                let clean = clean_scraped_url(m.as_str());
                if clean.starts_with("http") {
                    resolved_thumbnail = clean;
                }
            }
        }
    }

    if resolved_thumbnail.is_empty() {
        let meta_img_re = Regex::new(r#"<meta\s+[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']"#).ok();
        let meta_img_alt_re = Regex::new(r#"<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']"#).ok();

        let candidate = meta_img_re.as_ref()
            .and_then(|re| re.captures(html))
            .or_else(|| meta_img_alt_re.as_ref().and_then(|re| re.captures(html)))
            .and_then(|c| c.get(1))
            .map(|m| clean_scraped_url(m.as_str()))
            .unwrap_or_default();

        if candidate.starts_with("http") {
            resolved_thumbnail = candidate;
        }
    }

    if author.is_empty() && !og_title.is_empty() {
        if let Ok(title_author_re) = Regex::new(r"\(@([A-Za-z0-9_.]+)\)") {
            if let Some(caps) = title_author_re.captures(&og_title) {
                if let Some(m) = caps.get(1) {
                    author = format!("@{}", m.as_str());
                }
            }
        }
    }

    // Meaningful title: Use caption text if available, otherwise og_title
    let raw_title = if !og_desc.is_empty() {
        og_desc.trim()
    } else if !og_title.is_empty() {
        og_title.trim()
    } else {
        "Threads Post"
    };
    let sanitized_title = crate::downloader::sanitize_filename(raw_title);
    let mut base_title = if sanitized_title.is_empty() || sanitized_title == "media_download" {
        "Threads Post".to_string()
    } else {
        sanitized_title
    };

    // ID / post code resolution
    let mut post_id = String::new();
    if let Ok(id_re) = Regex::new(r"/(?:post|t)/([A-Za-z0-9_-]+)") {
        if let Some(caps) = id_re.captures(final_url).or_else(|| id_re.captures(original_url)) {
            if let Some(m) = caps.get(1) {
                post_id = m.as_str().to_string();
            }
        }
    }
    if post_id.is_empty() {
        post_id = format!("threads_{}", chrono::Utc::now().timestamp_millis());
    }

    // --- 3. Structured JSON extraction ---
    // Search <script ...application/json...> tags for the exact target media node
    if let Ok(script_re) = regex::RegexBuilder::new(r#"<script[^>]*application/json[^>]*>(.*?)</script>"#)
        .dot_matches_new_line(true)
        .build()
    {
        // First pass: scripts containing post_id. Second pass: other scripts.
        let mut script_candidates = Vec::new();
        let mut fallback_scripts = Vec::new();
        for caps in script_re.captures_iter(html) {
            if let Some(m) = caps.get(1) {
                let text = m.as_str();
                if text.contains(&post_id) {
                    script_candidates.push(text);
                } else if text.contains("carousel_media") || text.contains("video_versions") {
                    fallback_scripts.push(text);
                }
            }
        }
        script_candidates.extend(fallback_scripts);

        for script_json in script_candidates {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(script_json) {
                let target_node = find_threads_media_node(&val, &post_id)
                    .or_else(|| find_any_threads_media_node(&val));

                if let Some(node) = target_node {
                    // Extract author if available
                    if let Some(u) = node.get("user").and_then(|u| u.get("username")).and_then(|s| s.as_str()) {
                        if !u.is_empty() {
                            author = format!("@{}", u);
                        }
                    }

                    // Extract caption text if available
                    if let Some(cap) = node.get("caption").and_then(|c| c.get("text")).and_then(|s| s.as_str()) {
                        let clean_cap = crate::downloader::sanitize_filename(cap.trim());
                        if !clean_cap.is_empty() {
                            base_title = clean_cap;
                        }
                    }

                    // Check for carousel items
                    if let Some(carousel_arr) = node.get("carousel_media").and_then(|c| c.as_array()) {
                        if !carousel_arr.is_empty() {
                            let mut items: Vec<MediaItem> = Vec::new();
                            for item in carousel_arr {
                                let orig_w = item.get("original_width").and_then(|w| w.as_i64());
                                let orig_h = item.get("original_height").and_then(|h| h.as_i64());

                                // Thumbnail candidate
                                let item_thumb = item
                                    .get("image_versions2")
                                    .and_then(|iv| iv.get("candidates"))
                                    .and_then(|c| c.as_array())
                                    .and_then(|cands| cands.first())
                                    .and_then(|cand| cand.get("url"))
                                    .and_then(|u| u.as_str())
                                    .map(|u| clean_scraped_url(u))
                                    .unwrap_or_default();

                                let item_dur = item
                                    .get("video_duration")
                                    .and_then(|d| d.as_f64())
                                    .map(|d| d as i64)
                                    .unwrap_or(0);

                                // Check if this item is video
                                let video_candidate = item
                                    .get("video_versions")
                                    .and_then(|vv| vv.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|v| v.get("url"))
                                    .and_then(|u| u.as_str())
                                    .map(|u| clean_scraped_url(u));

                                if let Some(v_url) = video_candidate {
                                    items.push(MediaItem {
                                        kind: "video".to_string(),
                                        url: v_url,
                                        thumbnail: if !item_thumb.is_empty() { item_thumb } else { resolved_thumbnail.clone() },
                                        duration: item_dur,
                                        width: orig_w,
                                        height: orig_h,
                                    });
                                } else if !item_thumb.is_empty() {
                                    items.push(MediaItem {
                                        kind: "image".to_string(),
                                        url: item_thumb.clone(),
                                        thumbnail: item_thumb,
                                        duration: 0,
                                        width: orig_w,
                                        height: orig_h,
                                    });
                                }
                            }

                            if !items.is_empty() {
                                let v_count = items.iter().filter(|i| i.kind == "video").count();
                                let img_count = items.iter().filter(|i| i.kind == "image").count();
                                let count = items.len();

                                let formatted_title = if count > 1 {
                                    if v_count > 0 && img_count > 0 {
                                        format!("{} [Carousel: {} Media]", base_title, count)
                                    } else if v_count > 0 {
                                        format!("{} [Carousel: {} Videos]", base_title, count)
                                    } else {
                                        format!("{} [Carousel: {} Images]", base_title, count)
                                    }
                                } else {
                                    base_title.clone()
                                };

                                let primary_thumb = items.first().map(|i| i.thumbnail.clone()).unwrap_or_else(|| resolved_thumbnail.clone());
                                let thumbs: Vec<String> = items.iter().map(|i| i.thumbnail.clone()).collect();
                                let total_dur: i64 = items.iter().map(|i| i.duration).sum();

                                let desc_tag = if v_count == 0 {
                                    "image".to_string()
                                } else {
                                    "carousel".to_string()
                                };

                                return Ok(VideoInfo {
                                    id: post_id,
                                    title: formatted_title,
                                    duration: total_dur,
                                    thumbnail: primary_thumb,
                                    uploader: if !author.is_empty() { author } else { "Threads Creator".to_string() },
                                    channel: "Threads".to_string(),
                                    uploader_id: None,
                                    description: Some(desc_tag),
                                    post_type: None,
                                    webpage_url: final_url.to_string(),
                                    images: Some(thumbs),
                                    media_items: Some(items),
                                });
                            }
                        }
                    }

                    // Check for single video on target node
                    if let Some(vv) = node.get("video_versions").and_then(|v| v.as_array()) {
                        if let Some(v_url) = vv.first().and_then(|v| v.get("url")).and_then(|u| u.as_str()) {
                            let clean_v_url = clean_scraped_url(v_url);
                            let dur = node.get("video_duration").and_then(|d| d.as_f64()).map(|d| d as i64).unwrap_or(0);
                            let orig_w = node.get("original_width").and_then(|w| w.as_i64());
                            let orig_h = node.get("original_height").and_then(|h| h.as_i64());

                            let single_thumb = node
                                .get("image_versions2")
                                .and_then(|iv| iv.get("candidates"))
                                .and_then(|c| c.as_array())
                                .and_then(|cands| cands.first())
                                .and_then(|c| c.get("url"))
                                .and_then(|u| u.as_str())
                                .map(|u| clean_scraped_url(u))
                                .unwrap_or_else(|| resolved_thumbnail.clone());

                            let single_item = MediaItem {
                                kind: "video".to_string(),
                                url: clean_v_url.clone(),
                                thumbnail: single_thumb.clone(),
                                duration: dur,
                                width: orig_w,
                                height: orig_h,
                            };

                            return Ok(VideoInfo {
                                id: post_id,
                                title: base_title,
                                duration: if dur > 0 { dur } else { 30 },
                                thumbnail: single_thumb,
                                uploader: if !author.is_empty() { author } else { "Threads Creator".to_string() },
                                channel: "Threads".to_string(),
                                uploader_id: None,
                                description: Some(clean_v_url),
                                post_type: None,
                                webpage_url: final_url.to_string(),
                                images: None,
                                media_items: Some(vec![single_item]),
                            });
                        }
                    }

                    // Check for single image on target node
                    if let Some(cand_url) = node
                        .get("image_versions2")
                        .and_then(|iv| iv.get("candidates"))
                        .and_then(|c| c.as_array())
                        .and_then(|cands| cands.first())
                        .and_then(|c| c.get("url"))
                        .and_then(|u| u.as_str())
                    {
                        let clean_img = clean_scraped_url(cand_url);
                        let orig_w = node.get("original_width").and_then(|w| w.as_i64());
                        let orig_h = node.get("original_height").and_then(|h| h.as_i64());

                        let single_item = MediaItem {
                            kind: "image".to_string(),
                            url: clean_img.clone(),
                            thumbnail: clean_img.clone(),
                            duration: 0,
                            width: orig_w,
                            height: orig_h,
                        };

                        return Ok(VideoInfo {
                            id: post_id,
                            title: base_title,
                            duration: 0,
                            thumbnail: clean_img.clone(),
                            uploader: if !author.is_empty() { author } else { "Threads Creator".to_string() },
                            channel: "Threads".to_string(),
                            uploader_id: None,
                            description: Some("image".to_string()),
                            post_type: Some("image".to_string()),
                            webpage_url: final_url.to_string(),
                            images: Some(vec![clean_img]),
                            media_items: Some(vec![single_item]),
                        });
                    }
                }
            }
        }
    }

    // --- 4. Fallback: Regex extraction for static or legacy HTML ---
    let mut found_video_url: Option<String> = None;
    let mut video_duration: i64 = 0;
    if let Ok(video_re) = regex::RegexBuilder::new(r#""video_versions"\s*:\s*\[\s*\{[^}]*?"url"\s*:\s*"([^"]+)""#)
        .dot_matches_new_line(true)
        .build()
    {
        if let Some(caps) = video_re.captures(html) {
            if let Some(m) = caps.get(1) {
                let clean = clean_scraped_url(m.as_str());
                if clean.starts_with("http") {
                    found_video_url = Some(clean);
                }
            }
        }
    }

    if found_video_url.is_some() {
        if let Ok(dur_re) = regex::RegexBuilder::new(r#""video_versions"\s*:\s*\[\s*\{[^}]*?"duration"\s*:\s*([0-9.]+)"#)
            .dot_matches_new_line(true)
            .build()
        {
            if let Some(caps) = dur_re.captures(html) {
                if let Some(m) = caps.get(1) {
                    if let Ok(d) = m.as_str().parse::<f64>() {
                        video_duration = d as i64;
                    }
                }
            }
        }
    }

    if let Some(v_url) = found_video_url {
        let single_item = MediaItem {
            kind: "video".to_string(),
            url: v_url.clone(),
            thumbnail: resolved_thumbnail.clone(),
            duration: video_duration,
            width: None,
            height: None,
        };

        return Ok(VideoInfo {
            id: post_id,
            title: base_title,
            duration: if video_duration > 0 { video_duration } else { 30 },
            thumbnail: resolved_thumbnail,
            uploader: if !author.is_empty() { author } else { "Threads Creator".to_string() },
            channel: "Threads".to_string(),
            uploader_id: None,
            description: Some(v_url),
            post_type: None,
            webpage_url: final_url.to_string(),
            images: None,
            media_items: Some(vec![single_item]),
        });
    }

    // Check for carousel images fallback
    let mut image_urls: Vec<String> = Vec::new();
    if let Ok(carousel_re) = regex::RegexBuilder::new(r#""carousel_media"\s*:\s*(\[\s*\{.*?\}\s*\])"#)
        .dot_matches_new_line(true)
        .build()
    {
        for caps in carousel_re.captures_iter(html) {
            if let Some(m) = caps.get(1) {
                if let Ok(cm) = serde_json::from_str::<serde_json::Value>(m.as_str()) {
                    if let Some(arr) = cm.as_array() {
                        for item in arr {
                            if let Some(candidates) = item.get("image_versions2").and_then(|iv| iv.get("candidates")).and_then(|c| c.as_array()) {
                                if let Some(first) = candidates.first().and_then(|cand| cand.get("url")).and_then(|u| u.as_str()) {
                                    image_urls.push(clean_scraped_url(first));
                                }
                            }
                        }
                    }
                }
            }
            if !image_urls.is_empty() {
                break;
            }
        }
    }

    if image_urls.is_empty() {
        if let Ok(single_img_re) = regex::RegexBuilder::new(r#""image_versions2"\s*:\s*\{[^}]*?"candidates"\s*:\s*\[\s*\{[^}]*?"url"\s*:\s*"([^"]+)""#)
            .dot_matches_new_line(true)
            .build()
        {
            if let Some(caps) = single_img_re.captures(html) {
                if let Some(m) = caps.get(1) {
                    let clean = clean_scraped_url(m.as_str());
                    if clean.starts_with("http") {
                        image_urls.push(clean);
                    }
                }
            }
        }
    }

    if image_urls.is_empty() && !resolved_thumbnail.is_empty() {
        image_urls.push(resolved_thumbnail.clone());
    }

    if image_urls.is_empty() {
        return Err("No media or video stream found in Threads post".to_string());
    }

    let bundle = create_bundle_from_urls(
        &post_id,
        final_url,
        &base_title,
        if !author.is_empty() { &author } else { "Threads Creator" },
        &image_urls,
    );

    Ok(bundle_to_video_info(&bundle, final_url))
}

/// Fetches and extracts a Threads post via Googlebot User-Agent
pub async fn extract_threads_post(url: &str) -> Result<VideoInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let resp = client
        .get(url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Threads request failed: {}", e))?;

    let final_url = resp.url().to_string();
    let html = resp.text().await.map_err(|e| format!("Failed to read Threads HTML: {}", e))?;
    parse_threads_html(&html, &final_url, url)
}

/// Main Dispatcher for fallback image extraction
pub async fn try_extract_image_media(url: &str) -> Result<ImageMediaBundle, String> {
    if is_threads_url(url) {
        let vinfo = extract_threads_post(url).await?;
        let imgs = vinfo.images.unwrap_or_else(|| {
            if !vinfo.thumbnail.is_empty() {
                vec![vinfo.thumbnail.clone()]
            } else {
                vec![]
            }
        });
        return Ok(create_bundle_from_urls(
            &vinfo.id,
            url,
            &vinfo.title,
            "threads",
            &imgs,
        ));
    }
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

    let media_items: Vec<MediaItem> = bundle.images.iter().map(|img| {
        MediaItem {
            kind: "image".to_string(),
            url: img.url.clone(),
            thumbnail: img.url.clone(),
            duration: 0,
            width: None,
            height: None,
        }
    }).collect();

    VideoInfo {
        id: bundle.id.clone(),
        title: formatted_title,
        duration: 0,
        thumbnail,
        uploader: bundle.author.clone(),
        channel: bundle.platform.clone(),
        uploader_id: None,
        description: Some("image".to_string()),
        post_type: Some("image".to_string()),
        webpage_url: url.to_string(),
        images: if count > 1 { Some(image_urls) } else { None },
        media_items: Some(media_items),
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

    // Read carousel filename format from settings
    let settings = db.get_settings().unwrap_or_default();
    let author_or_source = crate::downloader::resolve_author_or_source(
        Some(&bundle.author),
        None,
        &bundle.platform,
        &bundle.source_url,
    );
    let raw_name = custom_name.as_deref().unwrap_or(&bundle.title);
    let stripped = RE_CAROUSEL_IMAGE_BADGE.replace_all(raw_name, "");
    let clean_raw = sanitize_name(crate::downloader::strip_media_extension(stripped.trim()));
    let clean_base_name = crate::downloader::build_video_stem(
        Some(&author_or_source),
        &clean_raw,
        &settings.video_filename_format,
    );
    let is_folder_sequential = settings.carousel_filename_format != "title_sequential";

    // If multiple items and folder_sequential: save into a dedicated subfolder with sequential names
    let (target_dir, use_subfolder) = if is_folder_sequential && bundle.images.len() > 1 {
        let subfolder = output_folder.join(&clean_base_name);
        let _ = std::fs::create_dir_all(&subfolder);
        (subfolder, true)
    } else {
        let target = output_folder.to_path_buf();
        let _ = std::fs::create_dir_all(&target);
        (target, false)
    };

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

    let semaphore = Arc::new(tokio::sync::Semaphore::new(3));
    let total_bytes_atomic = Arc::new(AtomicI64::new(0));
    let completed_items_atomic = Arc::new(AtomicUsize::new(0));
    let created_files_lock = Arc::new(Mutex::new(Vec::<PathBuf>::new()));
    let primary_saved_path_lock = Arc::new(Mutex::new(String::new()));

    let count = items_to_download.len();
    let mut download_futures = Vec::new();
    for (slide_idx, item) in items_to_download {
        let sem = semaphore.clone();
        let client = client.clone();
        let target_dir = target_dir.clone();
        let clean_base_name = clean_base_name.clone();
        let total_bytes_atomic = total_bytes_atomic.clone();
        let completed_items_atomic = completed_items_atomic.clone();
        let created_files_lock = created_files_lock.clone();
        let primary_saved_path_lock = primary_saved_path_lock.clone();
        let app = app.clone();
        let task_id = task_id.to_string();
        let bundle_title = bundle.title.clone();
        let bundle_platform = bundle.platform.clone();
        let is_multi = bundle.images.len() > 1;

        download_futures.push(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let ext = if item.url.contains(".png") { "png" } else { "jpg" };
            let filename = if is_multi {
                if use_subfolder {
                    format!("{:02}.{}", slide_idx, ext)
                } else {
                    format!("{}_{:02}.{}", clean_base_name, slide_idx, ext)
                }
            } else {
                format!("{}.{}", clean_base_name, ext)
            };
            let dest_file = target_dir.join(&filename);

            let resp = client.get(&item.url).send().await
                .map_err(|e| format!("Failed to download image {}: {}", filename, e))?;

            if !resp.status().is_success() {
                return Err(format!("Image download failed with HTTP {}", resp.status()));
            }

            let bytes = resp.bytes().await
                .map_err(|e| format!("Failed to read image bytes: {}", e))?;

            if bytes.is_empty() {
                return Err(format!("Downloaded image {} is 0 bytes", filename));
            }

            let byte_len = bytes.len() as i64;
            std::fs::write(&dest_file, &bytes)
                .map_err(|e| format!("Failed to write file {:?}: {}", dest_file, e))?;

            if let Ok(mut lock) = created_files_lock.lock() {
                lock.push(dest_file.clone());
            }

            if let Ok(mut lock) = primary_saved_path_lock.lock() {
                if lock.is_empty() {
                    *lock = dest_file.to_string_lossy().to_string();
                }
            }

            let curr_bytes = total_bytes_atomic.fetch_add(byte_len, Ordering::SeqCst) + byte_len;
            let done_count = completed_items_atomic.fetch_add(1, Ordering::SeqCst) + 1;

            let percent = (done_count as f64 / total_items as f64) * 100.0;
            let _ = app.emit(
                "download-progress",
                ActiveDownloadTask {
                    task_id,
                    url: item.url,
                    title: bundle_title,
                    platform: bundle_platform,
                    format_type: "image".to_string(),
                    quality: "original".to_string(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent,
                        speed_str: format!("{}/{}", done_count, total_items),
                        eta_str: "00:00".to_string(),
                        downloaded_bytes: Some(curr_bytes),
                        total_bytes: Some(curr_bytes),
                    },
                    error: None,
                },
            );

            Ok::<(), String>(())
        });
    }

    try_join_all(download_futures).await.map_err(|e| {
        if let Ok(lock) = created_files_lock.lock() {
            for f in lock.iter() {
                let _ = std::fs::remove_file(f);
            }
        }
        e
    })?;

    let mut created_files = created_files_lock.lock().map(|l| l.clone()).unwrap_or_default();
    let primary_saved_path = primary_saved_path_lock.lock().map(|l| l.clone()).unwrap_or_default();
    let mut total_bytes = total_bytes_atomic.load(Ordering::SeqCst);

    // Download background audio if available (e.g. TikTok photo mode BGM)
    if let Some(ref bgm_url) = bundle.audio_url {
        let dest_audio = if use_subfolder {
            target_dir.join("bgm.mp3")
        } else {
            target_dir.join(format!("{}_bgm.mp3", clean_base_name))
        };
        if let Ok(resp) = client.get(bgm_url).send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        total_bytes += bytes.len() as i64;
                        let _ = std::fs::write(&dest_audio, &bytes);
                        created_files.push(dest_audio);
                    }
                }
            }
        }
    }

    if created_files.is_empty() || primary_saved_path.is_empty() || !Path::new(&primary_saved_path).exists() {
        for f in &created_files {
            let _ = std::fs::remove_file(f);
        }
        return Err("No image files could be written to destination".to_string());
    }

    // Final record path is primary saved image or target directory
    let final_record_path = if !primary_saved_path.is_empty() {
        primary_saved_path.clone()
    } else {
        target_dir.to_string_lossy().to_string()
    };

    let display_title = if count > 1 && !raw_name.contains("[Carousel:") {
        format!("{} [Carousel: {} Images]", clean_base_name, count)
    } else {
        Path::new(&primary_saved_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&clean_base_name)
            .to_string()
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

/// Creates a MediaBundle directly from a list of MediaItem structs
pub fn create_media_bundle_from_items(
    id: &str,
    source_url: &str,
    title: &str,
    platform: &str,
    author: &str,
    items: &[MediaItem],
) -> MediaBundle {
    let clean_title = sanitize_name(title);
    let total = items.len();
    let bundle_items = items
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            let ext = if m.kind == "video" {
                if m.url.contains(".webm") { "webm" } else { "mp4" }
            } else {
                if m.url.contains(".png") { "png" } else { "jpg" }
            };
            let filename = if total > 1 {
                format!("{}_{:02}.{}", clean_title, idx + 1, ext)
            } else {
                format!("{}.{}", clean_title, ext)
            };
            MediaBundleItem {
                kind: m.kind.clone(),
                url: m.url.clone(),
                filename,
                thumbnail: m.thumbnail.clone(),
                duration: m.duration,
            }
        })
        .collect();

    MediaBundle {
        id: id.to_string(),
        source_url: source_url.to_string(),
        title: title.to_string(),
        author: author.to_string(),
        platform: platform.to_string(),
        thumbnail: items.first().map(|i| i.thumbnail.clone()).unwrap_or_default(),
        items: bundle_items,
        audio_url: None,
    }
}

/// Downloads media bundle items (video and/or image) with chunk streaming, accurate byte tracking, and cancellation safety
pub async fn download_media_bundle(
    app: &AppHandle,
    db: Arc<Database>,
    task_id: &str,
    bundle: &MediaBundle,
    output_folder: &Path,
    custom_name: Option<String>,
    selected_indices: Option<Vec<usize>>,
) -> Result<String, String> {
    let client = create_http_client();

    let settings = db.get_settings().unwrap_or_default();
    let author_or_source = crate::downloader::resolve_author_or_source(
        Some(&bundle.author),
        None,
        &bundle.platform,
        &bundle.source_url,
    );
    let raw_name = custom_name.as_deref().unwrap_or(&bundle.title);
    let stripped = RE_CAROUSEL_MEDIA_BADGE.replace_all(raw_name, "");
    let clean_raw = sanitize_name(crate::downloader::strip_media_extension(stripped.trim()));
    let clean_base_name = crate::downloader::build_video_stem(
        Some(&author_or_source),
        &clean_raw,
        &settings.video_filename_format,
    );
    let is_folder_sequential = settings.carousel_filename_format != "title_sequential";

    // If multiple items and folder_sequential: save into a dedicated subfolder with sequential names
    let (target_dir, use_subfolder) = if is_folder_sequential && bundle.items.len() > 1 {
        let subfolder = output_folder.join(&clean_base_name);
        let _ = std::fs::create_dir_all(&subfolder);
        (subfolder, true)
    } else {
        let target = output_folder.to_path_buf();
        let _ = std::fs::create_dir_all(&target);
        (target, false)
    };

    let items_to_download: Vec<(usize, MediaBundleItem)> = match selected_indices {
        Some(ref indices) if !indices.is_empty() => {
            bundle.items
                .iter()
                .enumerate()
                .filter(|(idx, _)| indices.contains(idx))
                .map(|(idx, item)| (idx + 1, item.clone()))
                .collect()
        }
        _ => {
            bundle.items
                .iter()
                .enumerate()
                .map(|(idx, item)| (idx + 1, item.clone()))
                .collect()
        }
    };

    if items_to_download.is_empty() {
        return Err("No media items selected for download".to_string());
    }

    let total_items = items_to_download.len();

    let is_all_video = items_to_download.iter().all(|(_, it)| it.kind == "video");
    let is_all_image = items_to_download.iter().all(|(_, it)| it.kind == "image");
    let format_type = if is_all_image { "image" } else { "video" };

    let count = items_to_download.len();
    let display_title = if count > 1 && !raw_name.contains("[Carousel:") {
        let label = if is_all_video { "Videos" } else if is_all_image { "Images" } else { "Media" };
        format!("{} [Carousel: {} {}]", clean_base_name, count, label)
    } else {
        let ext = if is_all_image { "jpg" } else { "mp4" };
        format!("{}.{}", clean_base_name, ext)
    };

    let initial_record = DownloadRecord {
        id: task_id.to_string(),
        platform: bundle.platform.clone(),
        url: bundle.source_url.clone(),
        title: display_title.clone(),
        author: bundle.author.clone(),
        duration_sec: 0,
        thumbnail_url: bundle.thumbnail.clone(),
        format_type: format_type.to_string(),
        quality: "best".to_string(),
        file_path: String::new(),
        file_size_bytes: 0,
        status: "downloading".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range: None,
        exists: false,
    };
    let _ = db.add_record(&initial_record);

    let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
    let overall_bytes_atomic = Arc::new(AtomicI64::new(0));
    let completed_items_atomic = Arc::new(AtomicUsize::new(0));
    let created_files_lock = Arc::new(Mutex::new(Vec::<PathBuf>::new()));
    let primary_saved_path_lock = Arc::new(Mutex::new(String::new()));

    let mut download_futures = Vec::new();

    for (slide_idx, item) in items_to_download {
        let sem = semaphore.clone();
        let client = client.clone();
        let target_dir = target_dir.clone();
        let clean_base_name = clean_base_name.clone();
        let overall_bytes_atomic = overall_bytes_atomic.clone();
        let completed_items_atomic = completed_items_atomic.clone();
        let created_files_lock = created_files_lock.clone();
        let primary_saved_path_lock = primary_saved_path_lock.clone();
        let app = app.clone();
        let db = db.clone();
        let task_id = task_id.to_string();
        let display_title = display_title.clone();
        let bundle_platform = bundle.platform.clone();
        let is_multi = bundle.items.len() > 1;

        download_futures.push(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;

            let ext = if item.kind == "video" {
                if item.url.contains(".webm") { "webm" } else { "mp4" }
            } else {
                if item.url.contains(".png") { "png" } else { "jpg" }
            };

            let filename = if is_multi {
                if use_subfolder {
                    format!("{:02}.{}", slide_idx, ext)
                } else {
                    format!("{}_{:02}.{}", clean_base_name, slide_idx, ext)
                }
            } else {
                format!("{}.{}", clean_base_name, ext)
            };
            let dest_file = target_dir.join(&filename);
            let part_file = target_dir.join(format!("{}.part", filename));

            // 1. Skip items that were already completed in a previous session
            if dest_file.exists() && dest_file.is_file() {
                if let Ok(meta) = std::fs::metadata(&dest_file) {
                    if meta.len() > 0 {
                        overall_bytes_atomic.fetch_add(meta.len() as i64, Ordering::SeqCst);
                        if let Ok(mut lock) = created_files_lock.lock() {
                            lock.push(dest_file.clone());
                        }
                        if let Ok(mut lock) = primary_saved_path_lock.lock() {
                            if lock.is_empty() {
                                *lock = dest_file.to_string_lossy().to_string();
                            }
                        }
                        completed_items_atomic.fetch_add(1, Ordering::SeqCst);
                        return Ok::<(), String>(());
                    }
                }
            }

            // 2. Check for existing partial .part file bytes
            let mut existing_bytes: u64 = 0;
            if part_file.exists() && part_file.is_file() {
                if let Ok(meta) = std::fs::metadata(&part_file) {
                    existing_bytes = meta.len();
                }
            }

            // 3. Formulate request with conditional HTTP Range header
            let mut req = client.get(&item.url).header("Accept", "*/*");
            if existing_bytes > 0 {
                req = req.header("Range", format!("bytes={}-", existing_bytes));
            }

            let mut resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    let err_msg = format!("Failed to connect to stream {}: {}", filename, e);
                    let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                    return Err(err_msg);
                }
            };

            let status = resp.status();
            let (raw_file, mut item_downloaded, item_total_bytes) = if status == reqwest::StatusCode::PARTIAL_CONTENT {
                let file = match tokio::fs::OpenOptions::new()
                    .write(true)
                    .append(true)
                    .open(&part_file)
                    .await
                {
                    Ok(f) => f,
                    Err(e) => {
                        let err_msg = format!("Failed to open existing part file {:?} in append mode: {}", part_file, e);
                        let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                        return Err(err_msg);
                    }
                };
                let content_len = resp.content_length().unwrap_or(0);
                let total = content_len + existing_bytes;
                overall_bytes_atomic.fetch_add(existing_bytes as i64, Ordering::SeqCst);
                (file, existing_bytes as i64, total)
            } else if status == reqwest::StatusCode::OK {
                let file = match tokio::fs::File::create(&part_file).await {
                    Ok(f) => f,
                    Err(e) => {
                        let err_msg = format!("Failed to create part file {:?}: {}", part_file, e);
                        let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                        return Err(err_msg);
                    }
                };
                let total = resp.content_length().unwrap_or(0);
                (file, 0i64, total)
            } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                if existing_bytes > 0 {
                    if tokio::fs::rename(&part_file, &dest_file).await.is_ok() {
                        if let Ok(mut lock) = created_files_lock.lock() {
                            lock.push(dest_file.clone());
                        }
                        if let Ok(mut lock) = primary_saved_path_lock.lock() {
                            if lock.is_empty() {
                                *lock = dest_file.to_string_lossy().to_string();
                            }
                        }
                        overall_bytes_atomic.fetch_add(existing_bytes as i64, Ordering::SeqCst);
                        completed_items_atomic.fetch_add(1, Ordering::SeqCst);
                        return Ok(());
                    }
                }
                let _ = std::fs::remove_file(&part_file);
                let err_msg = format!("HTTP 416 Range Not Satisfiable for {}", filename);
                let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                return Err(err_msg);
            } else {
                let err_msg = format!("HTTP error {} downloading {}", status, filename);
                let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                return Err(err_msg);
            };

            let mut file = BufWriter::with_capacity(256 * 1024, raw_file);
            let mut last_emit = std::time::Instant::now();
            let session_start_time = std::time::Instant::now();
            let mut session_bytes_downloaded: i64 = 0;

            loop {
                let chunk_opt = match resp.chunk().await {
                    Ok(c) => c,
                    Err(e) => {
                        drop(file);
                        let err_msg = format!("Stream interrupted for {}: {}", filename, e);
                        let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                        return Err(err_msg);
                    }
                };

                let chunk = match chunk_opt {
                    Some(c) => c,
                    None => break,
                };

                if let Err(e) = file.write_all(&chunk).await {
                    drop(file);
                    let err_msg = format!("Write error for {}: {}", filename, e);
                    let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                    return Err(err_msg);
                }

                let chunk_len = chunk.len() as i64;
                item_downloaded += chunk_len;
                session_bytes_downloaded += chunk_len;
                let current_overall = overall_bytes_atomic.fetch_add(chunk_len, Ordering::SeqCst) + chunk_len;

                if last_emit.elapsed() >= Duration::from_millis(200) {
                    let elapsed_sec = session_start_time.elapsed().as_secs_f64();
                    let speed_mbps = if elapsed_sec > 0.05 {
                        (session_bytes_downloaded as f64 / 1_048_576.0) / elapsed_sec
                    } else {
                        0.0
                    };

                    let item_percent = if item_total_bytes > 0 {
                        (item_downloaded as f64 / item_total_bytes as f64).clamp(0.0, 1.0)
                    } else {
                        0.5
                    };

                    let done_items = completed_items_atomic.load(Ordering::SeqCst);
                    let overall_percent = (((done_items as f64) + item_percent) / total_items as f64) * 100.0;

                    let _ = app.emit(
                        "download-progress",
                        ActiveDownloadTask {
                            task_id: task_id.clone(),
                            url: item.url.clone(),
                            title: display_title.clone(),
                            platform: bundle_platform.clone(),
                            format_type: format_type.to_string(),
                            quality: "best".to_string(),
                            status: "downloading".to_string(),
                            progress: TaskProgress {
                                percent: overall_percent.clamp(0.5, 99.5),
                                speed_str: format!("{}/{} · {:.1} MB/s", done_items + 1, total_items, speed_mbps),
                                eta_str: if total_items > 1 { format!("Item {} of {}", done_items + 1, total_items) } else { "Downloading...".to_string() },
                                downloaded_bytes: Some(current_overall),
                                total_bytes: None,
                            },
                            error: None,
                        },
                    );

                    last_emit = std::time::Instant::now();
                }
            }

            if let Err(e) = file.flush().await {
                drop(file);
                let err_msg = format!("Flush failed for {}: {}", filename, e);
                let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                return Err(err_msg);
            }
            drop(file);

            if item_downloaded == 0 {
                let _ = std::fs::remove_file(&part_file);
                return Err(format!("Downloaded file {} is 0 bytes", filename));
            }

            if let Err(e) = tokio::fs::rename(&part_file, &dest_file).await {
                return Err(format!("Rename failed for {:?}: {}", dest_file, e));
            }

            if let Ok(mut lock) = created_files_lock.lock() {
                lock.push(dest_file.clone());
            }
            if let Ok(mut lock) = primary_saved_path_lock.lock() {
                if lock.is_empty() {
                    *lock = dest_file.to_string_lossy().to_string();
                }
            }
            completed_items_atomic.fetch_add(1, Ordering::SeqCst);

            Ok::<(), String>(())
        });
    }

    try_join_all(download_futures).await.map_err(|e| {
        if let Ok(lock) = created_files_lock.lock() {
            for f in lock.iter() {
                let _ = std::fs::remove_file(f);
            }
        }
        e
    })?;

    let created_files = created_files_lock.lock().map(|l| l.clone()).unwrap_or_default();
    let primary_saved_path = primary_saved_path_lock.lock().map(|l| l.clone()).unwrap_or_default();
    let overall_downloaded_bytes = overall_bytes_atomic.load(Ordering::SeqCst);

    if created_files.is_empty() || primary_saved_path.is_empty() {
        return Err("No files were saved".to_string());
    }

    let final_title = if count > 1 {
        display_title
    } else {
        Path::new(&primary_saved_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&display_title)
            .to_string()
    };

    let final_record = DownloadRecord {
        id: task_id.to_string(),
        platform: bundle.platform.clone(),
        url: bundle.source_url.clone(),
        title: final_title.clone(),
        author: bundle.author.clone(),
        duration_sec: 0,
        thumbnail_url: bundle.thumbnail.clone(),
        format_type: format_type.to_string(),
        quality: "best".to_string(),
        file_path: primary_saved_path.clone(),
        file_size_bytes: overall_downloaded_bytes,
        status: "completed".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range: None,
        exists: true,
    };
    let _ = db.add_record(&final_record);

    let _ = app.emit(
        "download-progress",
        ActiveDownloadTask {
            task_id: task_id.to_string(),
            url: bundle.source_url.clone(),
            title: final_title,
            platform: bundle.platform.clone(),
            format_type: format_type.to_string(),
            quality: "best".to_string(),
            status: "completed".to_string(),
            progress: TaskProgress {
                percent: 100.0,
                speed_str: "Complete".to_string(),
                eta_str: "00:00".to_string(),
                downloaded_bytes: Some(overall_downloaded_bytes),
                total_bytes: Some(overall_downloaded_bytes),
            },
            error: None,
        },
    );

    let _ = db.log_event(
        task_id,
        "INFO",
        "DOWNLOAD",
        &format!("Bundle download complete: {} files ({} bytes)", created_files.len(), overall_downloaded_bytes),
        Some(&primary_saved_path),
    );

    Ok(primary_saved_path)
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
                ..Default::default()
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

    #[test]
    fn test_is_threads_url() {
        assert!(is_threads_url("https://www.threads.com/@mirasammm/post/Dd7qshgk7ev"));
        assert!(is_threads_url("https://www.threads.net/@digitalbynonnanii/post/Dd6hc6HGKSS/media"));
        assert!(is_threads_url("https://www.threads.com/share/D5iSbKNRg/"));
        assert!(!is_threads_url("https://www.instagram.com/p/DdRWIrXmji_/"));
        assert!(!is_threads_url("https://www.youtube.com/watch?v=123"));
    }

    #[test]
    fn test_parse_threads_html_video_offline() {
        let sample_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:title" content="Creator (&#064;creator_user) on Threads">
                <meta property="og:description" content="Amazing nature video taken in the mountains">
                <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51/thumb.jpg">
            </head>
            <body>
                <script>
                    window.__additional_data = {"data": {"video_versions": [{"url": "https://instagram.fna.fbcdn.net/video.mp4", "duration": 18.5}]}};
                </script>
            </body>
            </html>
        "#;
        let url = "https://www.threads.net/@creator_user/post/D123456";
        let res = parse_threads_html(sample_html, url, url);
        assert!(res.is_ok(), "Failed to parse threads video html: {:?}", res.err());
        let info = res.unwrap();
        assert_eq!(info.id, "D123456");
        assert_eq!(info.uploader, "@creator_user");
        assert_eq!(info.title, "Amazing nature video taken in the mountains");
        assert_eq!(info.thumbnail, "https://scontent.cdninstagram.com/v/t51/thumb.jpg");
        assert_eq!(info.duration, 18);
        assert_eq!(info.description, Some("https://instagram.fna.fbcdn.net/video.mp4".to_string()));
    }

    #[test]
    fn test_parse_threads_html_with_escaped_entities() {
        let sample_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:title" content="Photographer on Threads">
                <meta property="og:description" content="City skyline sunset">
                <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51/thumb.jpg?_nc_cat=101&amp;ccb=7-5">
            </head>
            <body>
                <script>
                    window.__additional_data = {
                        "data": {
                            "candidates": [
                                {
                                    "width": 1080,
                                    "height": 1350,
                                    "url": "https:\/\/scontent-iad3-2.cdninstagram.com\/v\/t51.2885-15\/480_n.jpg?_nc_cat=101\u0026ccb=7-5\u0026_nc_sid=abc"
                                }
                            ],
                            "video_versions": [
                                {
                                    "url": "https:\/\/instagram.fna.fbcdn.net\/v\/video.mp4?_nc_cat=102\u0026ccb=7-5",
                                    "duration": 22.0
                                }
                            ]
                        }
                    };
                </script>
            </body>
            </html>
        "#;
        let url = "https://www.threads.net/@photographer/post/D987654";
        let res = parse_threads_html(sample_html, url, url);
        assert!(res.is_ok());
        let info = res.unwrap();
        // Candidate with clean unescaped & and / takes priority over og:image
        assert_eq!(
            info.thumbnail,
            "https://scontent-iad3-2.cdninstagram.com/v/t51.2885-15/480_n.jpg?_nc_cat=101&ccb=7-5&_nc_sid=abc"
        );
        assert!(!info.thumbnail.contains(r"\u0026"));
        assert!(!info.thumbnail.contains(r"\/"));
        assert_eq!(
            info.description,
            Some("https://instagram.fna.fbcdn.net/v/video.mp4?_nc_cat=102&ccb=7-5".to_string())
        );
    }

    #[test]
    fn test_parse_threads_html_multi_video_carousel() {
        let sample_html = r#"
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:title" content="Ricky on Threads">
                <meta property="og:description" content="Innalillahi banjir bandang Padang">
            </head>
            <body>
                <!-- Noise: Another reply post appears first in the page -->
                <script type="application/json">
                    {
                        "code": "reply_other_999",
                        "media_type": 2,
                        "video_versions": [{"url": "https:\/\/instagram.fna.fbcdn.net\/wrong_reply.mp4", "duration": 5.0}],
                        "user": {"username": "random_commenter"}
                    }
                </script>
                <!-- Target Post: multi-video carousel -->
                <script type="application/json" data-sjs>
                    {
                        "require": [
                            [
                                "RelayPrefetchedStreamCache",
                                "next",
                                [],
                                [
                                    {
                                        "__bbox": {
                                            "result": {
                                                "data": {
                                                    "media": {
                                                        "code": "DeT2s0skjxt",
                                                        "media_type": 8,
                                                        "caption": {"text": "Innalillahi, banjir bandang kembali terjadi di Padang"},
                                                        "user": {"username": "mrickybarman"},
                                                        "carousel_media": [
                                                            {
                                                                "media_type": 2,
                                                                "original_width": 576,
                                                                "original_height": 774,
                                                                "video_duration": 9.5,
                                                                "video_versions": [
                                                                    {"url": "https:\/\/instagram.fcgk6-3.fna.fbcdn.net\/v1.mp4", "width": 576, "height": 774}
                                                                ],
                                                                "image_versions2": {
                                                                    "candidates": [
                                                                        {"url": "https:\/\/instagram.fcgk6-3.fna.fbcdn.net\/thumb1.jpg", "width": 640, "height": 860}
                                                                    ]
                                                                }
                                                            },
                                                            {
                                                                "media_type": 2,
                                                                "original_width": 480,
                                                                "original_height": 640,
                                                                "video_duration": 12.0,
                                                                "video_versions": [
                                                                    {"url": "https:\/\/instagram.fcgk6-3.fna.fbcdn.net\/v2.mp4", "width": 480, "height": 640}
                                                                ],
                                                                "image_versions2": {
                                                                    "candidates": [
                                                                        {"url": "https:\/\/instagram.fcgk6-3.fna.fbcdn.net\/thumb2.jpg", "width": 640, "height": 860}
                                                                    ]
                                                                }
                                                            },
                                                            {
                                                                "media_type": 2,
                                                                "original_width": 480,
                                                                "original_height": 640,
                                                                "video_duration": 15.0,
                                                                "video_versions": [
                                                                    {"url": "https:\/\/instagram.fcgk6-3.fna.fbcdn.net\/v3.mp4", "width": 480, "height": 640}
                                                                ],
                                                                "image_versions2": {
                                                                    "candidates": [
                                                                        {"url": "https:\/\/instagram.fcgk6-3.fna.fbcdn.net\/thumb3.jpg", "width": 640, "height": 860}
                                                                    ]
                                                                }
                                                            }
                                                        ]
                                                    }
                                                }
                                            }
                                        }
                                    }
                                ]
                            ]
                        ]
                    }
                </script>
            </body>
            </html>
        "#;
        let url = "https://www.threads.com/@mrickybarman/post/DeT2s0skjxt/media";
        let res = parse_threads_html(sample_html, url, url);
        assert!(res.is_ok(), "Failed to parse threads carousel: {:?}", res.err());
        let info = res.unwrap();

        assert_eq!(info.id, "DeT2s0skjxt");
        assert_eq!(info.uploader, "@mrickybarman");
        assert!(info.title.contains("Innalillahi"));
        assert!(info.title.contains("[Carousel: 3 Videos]"));
        assert_eq!(info.description, Some("carousel".to_string()));

        let media_items = info.media_items.expect("media_items should be populated");
        assert_eq!(media_items.len(), 3, "Expected 3 videos in carousel");
        assert_eq!(media_items[0].kind, "video");
        assert_eq!(media_items[0].url, "https://instagram.fcgk6-3.fna.fbcdn.net/v1.mp4");
        assert_eq!(media_items[0].thumbnail, "https://instagram.fcgk6-3.fna.fbcdn.net/thumb1.jpg");
        assert_eq!(media_items[0].duration, 9);

        assert_eq!(media_items[1].kind, "video");
        assert_eq!(media_items[1].url, "https://instagram.fcgk6-3.fna.fbcdn.net/v2.mp4");
        assert_eq!(media_items[1].duration, 12);

        assert_eq!(media_items[2].kind, "video");
        assert_eq!(media_items[2].url, "https://instagram.fcgk6-3.fna.fbcdn.net/v3.mp4");
        assert_eq!(media_items[2].duration, 15);

        let images = info.images.expect("images thumbs should be populated");
        assert_eq!(images.len(), 3);
        assert_eq!(images[0], "https://instagram.fcgk6-3.fna.fbcdn.net/thumb1.jpg");
    }

    #[test]
    fn test_parse_real_threads_html_file() {
        let local_path = std::path::Path::new("C:/Users/precore/.gemini/antigravity-ide/brain/a4f8b1b9-95c5-41bb-8f84-a6c753bc7fff/scratch/threads_multi.html");
        let content = if local_path.exists() {
            std::fs::read_to_string(local_path).unwrap_or_default()
        } else {
            // Self-contained embedded fixture representation of Threads multi-video carousel
            r#"<!DOCTYPE html><html><head>
                <meta property="og:title" content="Ricky Barman (@mrickybarman) on Threads" />
                <script type="application/json" data-sjs>
                {
                    "require": [
                        [
                            "RelayPrefetchedStreamCache", "next", [],
                            [{
                                "__bbox": {
                                    "result": {
                                        "data": {
                                            "media": {
                                                "code": "DeT2s0skjxt",
                                                "media_type": 8,
                                                "user": {"username": "mrickybarman"},
                                                "carousel_media": [
                                                    {"media_type": 2, "video_duration": 9.5, "video_versions": [{"url": "https://cdn.example.com/v1.mp4"}], "image_versions2": {"candidates": [{"url": "https://cdn.example.com/t1.jpg"}]}},
                                                    {"media_type": 2, "video_duration": 12.0, "video_versions": [{"url": "https://cdn.example.com/v2.mp4"}], "image_versions2": {"candidates": [{"url": "https://cdn.example.com/t2.jpg"}]}},
                                                    {"media_type": 2, "video_duration": 15.0, "video_versions": [{"url": "https://cdn.example.com/v3.mp4"}], "image_versions2": {"candidates": [{"url": "https://cdn.example.com/t3.jpg"}]}}
                                                ]
                                            }
                                        }
                                    }
                                }
                            }]
                        ]
                    ]
                }
                </script>
            </head><body></body></html>"#.to_string()
        };

        let url = "https://www.threads.com/@mrickybarman/post/DeT2s0skjxt/media";
        let res = parse_threads_html(&content, url, url);
        assert!(res.is_ok(), "Real threads HTML parsing failed: {:?}", res.err());
        let info = res.unwrap();
        let items = info.media_items.expect("media_items should be populated");
        assert_eq!(items.len(), 3, "Expected 3 video items from threads HTML");
        for it in &items {
            assert_eq!(it.kind, "video", "Each item must be a video");
            assert!(it.url.starts_with("http"), "Valid video URL required");
        }
    }
}
