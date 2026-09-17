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

    // Extract original / high-resolution image URL from HTML / embedded script
    let mut found_img: Option<String> = None;

    // 1. Check embedded JSON for images_orig
    let orig_re = Regex::new(r#""images_orig"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)""#).unwrap();
    if let Some(caps) = orig_re.captures(&html) {
        if let Some(m) = caps.get(1) {
            found_img = Some(m.as_str().to_string());
        }
    }

    // 2. Check imageLargeUrl
    if found_img.is_none() {
        let large_re = Regex::new(r#""imageLargeUrl"\s*:\s*"([^"]+)""#).unwrap();
        if let Some(caps) = large_re.captures(&html) {
            if let Some(m) = caps.get(1) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    // 3. Check link rel="preload" as="image"
    if found_img.is_none() {
        let link_re = Regex::new(r#"<link\s+[^>]*rel="preload"[^>]*href="([^"]+)"[^>]*as="image""#)
            .or_else(|_| Regex::new(r#"<link\s+[^>]*href="([^"]+)"[^>]*rel="preload""#))
            .unwrap();
        if let Some(caps) = link_re.captures(&html) {
            if let Some(m) = caps.get(1) {
                let s = m.as_str();
                if s.contains("pinimg.com") {
                    found_img = Some(s.to_string());
                }
            }
        }
    }

    // 4. Check og:image or twitter:image
    if found_img.is_none() {
        let meta_re = Regex::new(r#"(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)""#)
            .or_else(|_| Regex::new(r#"content="([^"]+)"\s+(?:property|name)="(?:og:image|twitter:image)""#))
            .unwrap();
        if let Some(caps) = meta_re.captures(&html) {
            if let Some(m) = caps.get(1) {
                found_img = Some(m.as_str().to_string());
            }
        }
    }

    // 5. Fallback: Any i.pinimg.com image URL in the page
    if found_img.is_none() {
        let general_re = Regex::new(r#"(https://i\.pinimg\.com/(?:originals|1200x|736x|564x|474x)/[a-zA-Z0-9/_.-]+\.(?:jpg|png|webp))"#).unwrap();
        if let Some(caps) = general_re.captures(&html) {
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
    let title_re = Regex::new(r#""seoTitle"\s*:\s*"([^"]+)""#)
        .or_else(|_| Regex::new(r#"property="og:title"\s+content="([^"]+)""#))
        .unwrap();
    let title = title_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("&amp;", "&").replace("&quot;", "\"").to_string())
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

/// 2. X (Twitter) Photo Extractor via VxTwitter & FxTwitter APIs
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
                let text = json_val["text"].as_str().unwrap_or("X Photo").to_string();
                let author_name = json_val["user_name"].as_str().unwrap_or(&user).to_string();
                let screen_name = json_val["user_screen_name"].as_str().unwrap_or(&user).to_string();

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
                    let thumb = image_items[0].url.clone();
                    let title = if text.trim().is_empty() {
                        format!("X Photo by @{}", screen_name)
                    } else {
                        text.chars().take(80).collect()
                    };

                    return Ok(ImageMediaBundle {
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

    let tweet = &json_val["tweet"];
    let text = tweet["text"].as_str().unwrap_or("X Photo").to_string();
    let author_name = tweet["author"]["name"]
        .as_str()
        .or_else(|| tweet["author"]["screen_name"].as_str())
        .unwrap_or(&user)
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

    let thumb = image_items[0].url.clone();
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

/// 3. TikTok Photo Mode & Carousel Extractor
#[derive(Deserialize)]
struct TikWmData {
    title: Option<String>,
    images: Option<Vec<String>>,
    music: Option<String>,
    author: Option<TikWmAuthor>,
}

#[derive(Deserialize)]
struct TikWmAuthor {
    unique_id: Option<String>,
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct TikWmResponse {
    code: i32,
    data: Option<TikWmData>,
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

    if res_obj.code != 0 || res_obj.data.is_none() {
        return Err("TikTok did not return any media. The post might be private or removed.".to_string());
    }

    let data = res_obj.data.unwrap();
    let image_urls = data.images.unwrap_or_default();

    if image_urls.is_empty() {
        return Err("No photos found in this TikTok post.".to_string());
    }

    let title = data.title.unwrap_or_else(|| "TikTok Photo Mode".to_string());
    let author_name = data
        .author
        .and_then(|a| a.unique_id.or(a.nickname))
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
        audio_url: data.music,
    })
}

/// 4. Instagram Image / Carousel Extractor via OpenGraph
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

    // Extract og:image
    let img_re = Regex::new(r#"property="og:image"\s+content="([^"]+)""#)
        .or_else(|_| Regex::new(r#"content="([^"]+)"[^>]*property="og:image""#))
        .unwrap();

    let image_url = img_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("&amp;", "&"))
        .ok_or_else(|| "Could not locate high-resolution image in this Instagram post".to_string())?;

    // Extract Title
    let title_re = Regex::new(r#"property="og:title"\s+content="([^"]+)""#).unwrap();
    let title = title_re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("&amp;", "&").replace("&quot;", "\""))
        .unwrap_or_else(|| "Instagram Post".to_string());

    let post_id_re = Regex::new(r"/(?:p|reel)/([A-Za-z0-9_-]+)").unwrap();
    let post_id = post_id_re
        .captures(url)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis().to_string());

    let filename = format!("instagram_{}.jpg", post_id);

    Ok(ImageMediaBundle {
        id: format!("ig_{}", post_id),
        source_url: url.to_string(),
        title,
        author: "Instagram".to_string(),
        platform: "instagram".to_string(),
        thumbnail: image_url.clone(),
        images: vec![ImageMediaItem {
            url: image_url,
            filename,
        }],
        audio_url: None,
    })
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

/// Converts an ImageMediaBundle into a VideoInfo struct for the frontend preview
pub fn bundle_to_video_info(bundle: &ImageMediaBundle, url: &str) -> VideoInfo {
    let count = bundle.images.len();
    let formatted_title = if count > 1 {
        format!("{} [Carousel: {} Images]", bundle.title, count)
    } else {
        bundle.title.clone()
    };

    VideoInfo {
        id: bundle.id.clone(),
        title: formatted_title,
        duration: 0,
        thumbnail: bundle.thumbnail.clone(),
        uploader: bundle.author.clone(),
        channel: bundle.platform.clone(),
        description: Some("image".to_string()),
        webpage_url: url.to_string(),
    }
}

/// Downloads image items (single or carousel bundle) directly to the target folder
pub async fn download_image_bundle(
    app: &AppHandle,
    db: Arc<Database>,
    task_id: &str,
    bundle: &ImageMediaBundle,
    output_folder: &Path,
    custom_name: Option<String>,
) -> Result<String, String> {
    let client = create_http_client();
    let total_items = bundle.images.len() + if bundle.audio_url.is_some() { 1 } else { 0 };

    let is_carousel = bundle.images.len() > 1 || bundle.audio_url.is_some();
    let clean_folder_name = sanitize_name(
        custom_name
            .as_deref()
            .unwrap_or(&bundle.title)
    );

    let target_dir = if is_carousel {
        let sub = output_folder.join(format!("{}_album", clean_folder_name.chars().take(40).collect::<String>()));
        let _ = std::fs::create_dir_all(&sub);
        sub
    } else {
        output_folder.to_path_buf()
    };

    let mut primary_saved_path = String::new();
    let mut total_bytes: i64 = 0;

    for (idx, item) in bundle.images.iter().enumerate() {
        let dest_file = target_dir.join(&item.filename);

        let resp = client
            .get(&item.url)
            .send()
            .await
            .map_err(|e| format!("Failed to download image {}: {}", item.filename, e))?;

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

        let percent = ((idx + 1) as f64 / total_items as f64) * 100.0;
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
                    speed_str: format!("{}/{}", idx + 1, total_items),
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

    // If carousel, primary path is the folder itself
    let final_record_path = if is_carousel {
        target_dir.to_string_lossy().to_string()
    } else {
        primary_saved_path.clone()
    };

    // Save final record in SQLite database
    let record = DownloadRecord {
        id: task_id.to_string(),
        platform: bundle.platform.clone(),
        url: bundle.source_url.clone(),
        title: bundle.title.clone(),
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

    #[tokio::test]
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
    async fn test_extract_tiktok_photos() {
        let url = "https://www.tiktok.com/@ra_yuthk/photo/7509108491907239176";
        let result = extract_tiktok_photos(url).await;
        assert!(result.is_ok(), "Failed to extract TikTok photos: {:?}", result.err());
        let bundle = result.unwrap();
        assert_eq!(bundle.platform, "tiktok");
        assert!(bundle.images.len() > 1, "TikTok carousel must have multiple images");
    }

    #[tokio::test]
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
    async fn test_dispatcher_routing() {
        let pin_url = "https://id.pinterest.com/pin/2040762329258273/";
        let res = try_extract_image_media(pin_url).await;
        assert!(res.is_ok());
    }
}
