use std::time::Duration;
use tokio::process::Command;
use crate::binaries::find_binary;
use crate::models::VideoInfo;



const CREATE_NO_WINDOW: u32 = 0x08000000;

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

    cmd.arg("--dump-json")
        .arg("--no-playlist")
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
    let title = json_val["title"].as_str().unwrap_or("Untitled Media").to_string();
    let duration = json_val["duration"].as_f64().map(|d| d as i64).unwrap_or(0);
    let thumbnail = json_val["thumbnail"].as_str().unwrap_or("").to_string();
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

    Ok(VideoInfo {
        id,
        title,
        duration,
        thumbnail,
        uploader,
        channel,
        description: None,
        webpage_url,
    })
}
