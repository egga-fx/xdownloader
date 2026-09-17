use std::time::Duration;
use tokio::process::Command;
use crate::binaries::find_binary;
use crate::models::VideoInfo;



const CREATE_NO_WINDOW: u32 = 0x08000000;

fn parse_img_index(u: &str) -> Option<usize> {
    if let Ok(re) = regex::Regex::new(r#"[?&]img_index=(\d+)"#) {
        if let Some(caps) = re.captures(u) {
            if let Some(m) = caps.get(1) {
                if let Ok(idx) = m.as_str().parse::<usize>() {
                    return Some(idx);
                }
            }
        }
    }
    if let Ok(re) = regex::Regex::new(r#"/photo/(\d+)"#) {
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

pub async fn fetch_video_metadata(url: &str) -> Result<VideoInfo, String> {
    let ytdlp_path = match find_binary("yt-dlp") {
        Some(p) => p,
        None => {
            // Fallback: Check if this is an image/photo URL that can be extracted natively
            if let Ok(bundle) = crate::image_extractor::try_extract_image_media(url).await {
                return Ok(crate::image_extractor::bundle_to_video_info(&bundle, url));
            }
            return Err("yt-dlp binary is not installed. Please set it up via the engine setup button.".to_string());
        }
    };

    let mut cmd = Command::new(ytdlp_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.arg("--dump-single-json")
        .arg("--ignore-no-formats-error")
        .arg("--no-warnings")
        .arg("--skip-download")
        .arg(url);

    // Run async command with 20 seconds safety timeout to prevent UI freezes
    let output = match tokio::time::timeout(Duration::from_secs(20), cmd.output()).await {
        Ok(res) => res.map_err(|e| format!("Failed to execute yt-dlp: {}", e))?,
        Err(_) => return Err("Metadata request timed out (exceeded 20 seconds). Please check your connection.".to_string()),
    };

    if !output.status.success() {
        // Fallback: Check if it's an image/photo post that yt-dlp cannot extract (e.g. Pinterest, X, TikTok, IG images)
        if let Ok(bundle) = crate::image_extractor::try_extract_image_media(url).await {
            return Ok(crate::image_extractor::bundle_to_video_info(&bundle, url));
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        let first_err = stderr.lines().next().unwrap_or("Failed to fetch video metadata");
        return Err(first_err.to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_val: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse metadata JSON: {}", e))?;

    let id = json_val["id"].as_str().unwrap_or("").to_string();
    let raw_title = json_val["title"].as_str().unwrap_or("Untitled Media").to_string();
    let duration = json_val["duration"].as_f64().map(|d| d as i64).unwrap_or(0);
    let mut thumbnail = json_val["thumbnail"].as_str().unwrap_or("").to_string();
    let uploader = json_val["uploader"]
        .as_str()
        .or_else(|| json_val["channel"].as_str())
        .unwrap_or("")
        .to_string();
    let channel = json_val["channel"].as_str().unwrap_or("").to_string();
    let webpage_url = json_val["webpage_url"]
        .as_str()
        .unwrap_or(url)
        .to_string();

    // Check for video formats across root object and entries
    let mut extracted_images: Vec<String> = Vec::new();
    let mut has_video_formats = false;

    // 1. Root level formats (single video post, e.g. Instagram Reels or video posts)
    if let Some(formats) = json_val["formats"].as_array() {
        for f in formats {
            let vcodec = f["vcodec"].as_str().unwrap_or("none");
            let video_ext = f["video_ext"].as_str().unwrap_or("none");
            if (vcodec != "none" && !vcodec.is_empty()) || (video_ext != "none" && !video_ext.is_empty()) {
                has_video_formats = true;
                break;
            }
        }
        if !has_video_formats && !formats.is_empty() && (duration > 0 || json_val["_type"].as_str() == Some("video")) {
            has_video_formats = true;
        }
    }

    if !has_video_formats && json_val["_type"].as_str() == Some("video") && duration > 0 {
        has_video_formats = true;
    }

    // 2. Playlist / Multi-item carousel entries
    if let Some(entries) = json_val["entries"].as_array() {
        for entry in entries {
            if let Some(formats) = entry["formats"].as_array() {
                for f in formats {
                    let vcodec = f["vcodec"].as_str().unwrap_or("none");
                    let video_ext = f["video_ext"].as_str().unwrap_or("none");
                    if (vcodec != "none" && !vcodec.is_empty()) || (video_ext != "none" && !video_ext.is_empty()) {
                        has_video_formats = true;
                        break;
                    }
                }
                if !has_video_formats && !formats.is_empty() && entry["duration"].as_f64().unwrap_or(0.0) > 0.0 {
                    has_video_formats = true;
                }
            }
            if let Some(thumb) = entry["thumbnail"].as_str() {
                if !thumb.is_empty() && !extracted_images.contains(&thumb.to_string()) {
                    extracted_images.push(thumb.to_string());
                }
            } else if let Some(thumbs) = entry["thumbnails"].as_array() {
                if let Some(last) = thumbs.last().and_then(|t| t["url"].as_str()) {
                    if !last.is_empty() && !extracted_images.contains(&last.to_string()) {
                        extracted_images.push(last.to_string());
                    }
                }
            }
        }
    }

    // Fallback: If yt-dlp succeeded but found 0 video formats and 0 extracted images
    // (e.g. X/Twitter photo post or other photo-only URLs), attempt native image extraction
    if !has_video_formats && extracted_images.is_empty() {
        if let Ok(bundle) = crate::image_extractor::try_extract_image_media(url).await {
            return Ok(crate::image_extractor::bundle_to_video_info(&bundle, url));
        }
    }

    let is_carousel = extracted_images.len() > 1;
    let description = if !has_video_formats && (!extracted_images.is_empty() || is_carousel) {
        Some("image".to_string())
    } else {
        None
    };

    let title = if is_carousel {
        format!("{} [Carousel: {} Images]", raw_title, extracted_images.len())
    } else {
        raw_title
    };

    // If a specific ?img_index=N is in the URL, target that slide as the primary preview thumbnail
    if let Some(target_idx) = parse_img_index(url) {
        if target_idx >= 1 && target_idx <= extracted_images.len() {
            thumbnail = extracted_images[target_idx - 1].clone();
        }
    } else if thumbnail.is_empty() && !extracted_images.is_empty() {
        thumbnail = extracted_images[0].clone();
    }

    let images = if is_carousel {
        Some(extracted_images)
    } else {
        None
    };

    Ok(VideoInfo {
        id,
        title,
        duration,
        thumbnail,
        uploader,
        channel,
        description,
        webpage_url,
        images,
    })
}
