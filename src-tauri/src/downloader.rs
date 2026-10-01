use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::binaries::find_binary;
use crate::db::Database;
use crate::models::{
    ActiveDownloadTask, DownloadRecord, TaskProgress, TimeRange,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct ProcessManager {
    children: Mutex<HashMap<String, u32>>, // taskId -> process PID
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            children: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, task_id: String, pid: u32) {
        if let Ok(mut map) = self.children.lock() {
            map.insert(task_id, pid);
        }
    }

    pub fn remove(&self, task_id: &str) {
        if let Ok(mut map) = self.children.lock() {
            map.remove(task_id);
        }
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        if let Ok(mut map) = self.children.lock() {
            if let Some(pid) = map.remove(task_id) {
                crate::logger::write_file_log("WARN", "PROCESS", task_id, &format!("Killed process PID: {}", pid));
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .creation_flags(CREATE_NO_WINDOW)
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
                return true;
            }
        }
        false
    }
}

pub fn get_default_download_dir() -> PathBuf {
    if let Some(user_videos) = dirs::video_dir() {
        let x_dir = user_videos.join("xDownloader");
        let _ = std::fs::create_dir_all(&x_dir);
        return x_dir;
    }
    if let Some(user_downloads) = dirs::download_dir() {
        let x_dir = user_downloads.join("xDownloader");
        let _ = std::fs::create_dir_all(&x_dir);
        return x_dir;
    }
    PathBuf::from("./downloads")
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

fn extract_youtube_id(url: &str) -> Option<String> {
    let re = Regex::new(r"(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)([a-zA-Z0-9_-]{11})").ok()?;
    let caps = re.captures(url)?;
    Some(caps[1].to_string())
}

pub async fn run_download(
    app: AppHandle,
    db: Arc<Database>,
    process_mgr: Arc<ProcessManager>,
    task_id: String,
    url: String,
    format_type: String,
    quality: String,
    title: Option<String>,
    thumbnail_url: Option<String>,
    author: Option<String>,
    duration_sec: Option<i64>,
    custom_name: Option<String>,
    output_folder: Option<String>,
    download_subtitles: bool,
    time_range: Option<TimeRange>,
    selected_indices: Option<Vec<usize>>,
    image_urls: Option<Vec<String>>,
) -> Result<(), String> {
    let out_dir = match output_folder {
        Some(ref f) if !f.trim().is_empty() => PathBuf::from(f),
        _ => get_default_download_dir(),
    };
    let _ = std::fs::create_dir_all(&out_dir);

    let _ = db.log_event(
        &task_id,
        "INFO",
        "DOWNLOAD",
        &format!("Initiating download: {} (format: {}, quality: {})", url, format_type, quality),
        None,
    );

    // 1. Direct Image Extraction Interceptor
    if format_type == "image" {
        let platform_name = if crate::image_extractor::is_threads_url(&url) {
            "threads"
        } else if url.contains("instagram.com") {
            "instagram"
        } else if url.contains("pinterest.com") || url.contains("pin.it") {
            "pinterest"
        } else if url.contains("tiktok.com") {
            "tiktok"
        } else if url.contains("twitter.com") || url.contains("x.com") {
            "x"
        } else {
            "web"
        };

        let bundle = if let Some(ref urls) = image_urls {
            if !urls.is_empty() {
                Some(crate::image_extractor::create_bundle_from_urls(
                    &task_id,
                    &url,
                    title.as_deref().unwrap_or("image"),
                    platform_name,
                    urls,
                ))
            } else {
                None
            }
        } else {
            None
        };

        let final_bundle = match bundle {
            Some(b) => Ok(b),
            None => crate::image_extractor::try_extract_image_media(&url).await,
        };

        if let Ok(b) = final_bundle {
            crate::image_extractor::download_image_bundle(
                &app,
                db,
                &task_id,
                &b,
                &out_dir,
                custom_name,
                selected_indices,
            )
            .await?;
            return Ok(());
        }
    }

    let ytdlp_path = match find_binary("yt-dlp") {
        Some(p) => p,
        None => {
            // Fallback: Check if image extraction works before failing
            if let Ok(bundle) = crate::image_extractor::try_extract_image_media(&url).await {
                crate::image_extractor::download_image_bundle(
                    &app,
                    db,
                    &task_id,
                    &bundle,
                    &out_dir,
                    custom_name,
                    selected_indices,
                )
                .await?;
                return Ok(());
            }
            return Err("yt-dlp binary is not installed".to_string());
        }
    };

    let ffmpeg_path = find_binary("ffmpeg");

    // Resolve direct download URL and metadata for platforms that require extraction preprocessing (Threads)
    let mut download_url = url.clone();
    let mut resolved_title = title.clone();
    let mut resolved_author = author.clone();
    let mut resolved_thumbnail = thumbnail_url.clone();
    let mut resolved_duration = duration_sec;

    if crate::image_extractor::is_threads_url(&url) {
        if let Ok(vinfo) = crate::image_extractor::extract_threads_post(&url).await {
            if let Some(ref direct_v_url) = vinfo.description {
                if !direct_v_url.is_empty() && direct_v_url.starts_with("http") {
                    download_url = direct_v_url.clone();
                }
            }
            if resolved_title.is_none() || resolved_title.as_deref() == Some(&url) {
                resolved_title = Some(vinfo.title.clone());
            }
            if resolved_author.is_none() {
                resolved_author = Some(vinfo.uploader.clone());
            }
            if resolved_thumbnail.is_none() || resolved_thumbnail.as_deref() == Some("") {
                resolved_thumbnail = Some(vinfo.thumbnail.clone());
            }
            if resolved_duration.is_none() || resolved_duration == Some(0) {
                resolved_duration = Some(vinfo.duration);
            }
        }
    }

    // Template output filename (sanitized for Windows filesystem)
    let out_template = match custom_name.as_deref() {
        Some(name) if !name.trim().is_empty() => {
            let clean = sanitize_filename(name.trim());
            out_dir.join(format!("{}.%(ext)s", clean))
        }
        _ => {
            if url.contains("instagram.com") {
                out_dir.join("%(upload_date>%Y%m%d_%H%M%S|upload_date)s_%(id)s.%(ext)s")
            } else if crate::image_extractor::is_threads_url(&url) {
                let name = resolved_title.as_deref().unwrap_or("threads_video");
                let clean = sanitize_filename(name);
                let safe_stem = if clean.chars().count() > 80 {
                    clean.chars().take(80).collect::<String>()
                } else {
                    clean
                };
                out_dir.join(format!("{}.%(ext)s", safe_stem))
            } else {
                out_dir.join("%(title)s [%(id)s].%(ext)s")
            }
        }
    };

    // Authoritative final file path detection via --print-to-file after_move:filepath
    let meta_file_path = std::env::temp_dir().join(format!("xdownloader_{}.meta", task_id));
    let _ = std::fs::remove_file(&meta_file_path);

    let mut cmd = Command::new(&ytdlp_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.current_dir(&out_dir);
    cmd.arg("--newline")
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("-o")
        .arg(out_template.to_string_lossy().to_string())
        .arg("--print-to-file")
        .arg("after_move:filepath")
        .arg(&meta_file_path);

    // Pass detected JavaScript runtime (Node/Bun/Deno) to solve YouTube extraction challenges without delay
    if let Some((runtime, path)) = crate::binaries::find_js_runtime() {
        cmd.arg("--js-runtimes").arg(format!("{}:{}", runtime, path.to_string_lossy()));
    }

    // High throughput connection optimizations for DASH & HLS video streams
    cmd.arg("--concurrent-fragments").arg("4")
        .arg("--retries").arg("10")
        .arg("--fragment-retries").arg("10");

    // Pass --ffmpeg-location so yt-dlp can reliably merge separate audio and video streams into a single mp4
    if let Some(ref ff_path) = ffmpeg_path {
        if ff_path.is_file() {
            if let Some(parent) = ff_path.parent() {
                cmd.arg("--ffmpeg-location").arg(parent);
            } else {
                cmd.arg("--ffmpeg-location").arg(ff_path);
            }
        } else {
            cmd.arg("--ffmpeg-location").arg(ff_path);
        }
    }

    // Quality args
    if format_type == "audio" {
        cmd.arg("-x");
        let audio_fmt = match quality.to_lowercase().as_str() {
            "m4a" => "m4a",
            "wav" => "wav",
            "flac" => "flac",
            "opus" => "opus",
            _ => "mp3",
        };
        cmd.arg("--audio-format").arg(audio_fmt);
        cmd.arg("--audio-quality").arg("0");
    } else {
        match quality.as_str() {
            "4k" | "2160p" => {
                cmd.arg("-f").arg("bestvideo[height<=2160][protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[height<=2160][protocol^=http]+bestaudio[protocol^=http]/bestvideo[height<=2160]+bestaudio/best");
                cmd.arg("-S").arg("res:2160,fps,proto:https,ext:mp4:m4a");
            }
            "1440p" => {
                cmd.arg("-f").arg("bestvideo[height<=1440][protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[height<=1440][protocol^=http]+bestaudio[protocol^=http]/bestvideo[height<=1440]+bestaudio/best");
                cmd.arg("-S").arg("res:1440,fps,proto:https,ext:mp4:m4a");
            }
            "1080p" => {
                cmd.arg("-f").arg("bestvideo[height<=1080][protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[height<=1080][protocol^=http]+bestaudio[protocol^=http]/bestvideo[height<=1080]+bestaudio/best");
                cmd.arg("-S").arg("res:1080,fps,proto:https,ext:mp4:m4a");
            }
            "720p" => {
                cmd.arg("-f").arg("bestvideo[height<=720][protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[height<=720][protocol^=http]+bestaudio[protocol^=http]/bestvideo[height<=720]+bestaudio/best");
                cmd.arg("-S").arg("res:720,fps,proto:https,ext:mp4:m4a");
            }
            "480p" => {
                cmd.arg("-f").arg("bestvideo[height<=480][protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[height<=480][protocol^=http]+bestaudio[protocol^=http]/bestvideo[height<=480]+bestaudio/best");
                cmd.arg("-S").arg("res:480,fps,proto:https,ext:mp4:m4a");
            }
            _ => {
                // "best" / Original HD: Download top native resolution without artificial cap, prioritizing direct HTTPS DASH streams
                cmd.arg("-f").arg("bestvideo[protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[protocol^=http]+bestaudio[protocol^=http]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best");
                cmd.arg("-S").arg("res,fps,proto:https,ext:mp4:m4a");
            }
        }
        cmd.arg("--merge-output-format").arg("mp4");
    }

    // Subtitles: only request manual sub tracks without wildcard auto-subs to prevent HTTP 429 rate-limiting
    if download_subtitles {
        cmd.arg("--write-sub")
            .arg("--sub-lang").arg("en,id")
            .arg("--convert-subs").arg("srt");
        if format_type == "video" {
            cmd.arg("--embed-subs");
        }
    }

    // Time range slicing (partial clip download)
    if let Some(ref tr) = time_range {
        let start = tr.start.trim();
        let end = tr.end.trim();
        if !start.is_empty() && !end.is_empty() && (start != "0" && start != "00:00:00" || !end.is_empty()) {
            cmd.arg("--download-sections").arg(format!("*{} - {}", start, end));
        }
    }

    cmd.arg(&download_url);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
    let pid = child.id();
    process_mgr.register(task_id.clone(), pid);

    // Metadata resolution for the initial DB record
    let rec_title = custom_name.clone().or(resolved_title).unwrap_or_else(|| url.clone());
    let mut rec_thumb = resolved_thumbnail.unwrap_or_default();
    let rec_author = resolved_author.unwrap_or_default();
    let rec_duration = resolved_duration.unwrap_or(0);

    // Fallback: extract YouTube thumbnail directly from video ID if empty
    if rec_thumb.is_empty() {
        if let Some(yt_id) = extract_youtube_id(&url) {
            rec_thumb = format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", yt_id);
        }
    }

    // Detect platform
    let platform = if crate::image_extractor::is_threads_url(&url) {
        "threads"
    } else if url.contains("youtube.com") || url.contains("youtu.be") {
        "youtube"
    } else if url.contains("tiktok.com") {
        "tiktok"
    } else if url.contains("instagram.com") {
        "instagram"
    } else if url.contains("twitter.com") || url.contains("x.com") {
        "x"
    } else if url.contains("pinterest.com") || url.contains("pin.it") {
        "pinterest"
    } else {
        "web_media"
    };

    // Initial record in DB
    let initial_record = DownloadRecord {
        id: task_id.clone(),
        platform: platform.to_string(),
        url: url.clone(),
        title: rec_title.clone(),
        author: rec_author.clone(),
        duration_sec: rec_duration,
        thumbnail_url: rec_thumb.clone(),
        format_type: format_type.clone(),
        quality: quality.clone(),
        file_path: String::new(),
        file_size_bytes: 0,
        status: "downloading".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range: time_range.clone(),
        exists: false,
    };
    let _ = db.add_record(&initial_record);

    // Emit initial active task progress immediately so UI does not remain stuck on "Connecting..."
    let startup_task = ActiveDownloadTask {
        task_id: task_id.clone(),
        url: url.clone(),
        title: initial_record.title.clone(),
        platform: initial_record.platform.clone(),
        format_type: format_type.clone(),
        quality: quality.clone(),
        status: "downloading".to_string(),
        progress: TaskProgress {
            percent: 0.5,
            speed_str: "Starting engine...".to_string(),
            eta_str: String::new(),
            downloaded_bytes: None,
            total_bytes: None,
        },
        error: None,
    };
    let _ = app.emit("download-progress", &startup_task);

    // Robust regex supporting space after '~' e.g. '[download] 5.2% of ~ 780.14MiB at 2.45MiB/s ETA 05:12'
    let progress_regex = Regex::new(
        r"\[download\]\s+([0-9.]+)%\s+of\s+~?\s*([0-9.]+[A-Za-z]+)\s+at\s+([0-9.]+[A-Za-z/]+|\S+)\s+ETA\s+([0-9:]+)"
    ).unwrap();
    let progress_simple_regex = Regex::new(
        r"\[download\]\s+([0-9.]+)%"
    ).unwrap();
    let merger_regex = Regex::new(r#"\[Merger\] Merging formats into "(?P<path>[^"]+)""#).unwrap();
    let destination_regex = Regex::new(r"\[(?:download|ExtractAudio)\] Destination:\s+(.+)").unwrap();
    let already_downloaded_regex = Regex::new(r"\[download\]\s+(.+)\s+has already been downloaded").unwrap();

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take();

    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines_clone = stderr_lines.clone();

    // Drain stderr in background thread to prevent pipe deadlock on Windows (4KB OS pipe buffer)
    let stderr_handle = std::thread::spawn(move || {
        if let Some(err_stream) = stderr {
            let r = BufReader::new(err_stream);
            for l in r.lines().flatten() {
                let trimmed = l.trim().to_string();
                if !trimmed.is_empty() {
                    if let Ok(mut lock) = stderr_lines_clone.lock() {
                        if lock.len() >= 50 {
                            lock.remove(0);
                        }
                        lock.push(trimmed);
                    }
                }
            }
        }
    });

    let reader = BufReader::new(stdout);

    let mut downloaded_path = String::new();

    for line_res in reader.lines() {
        if let Ok(line) = line_res {
            if let Some(caps) = progress_regex.captures(&line) {
                let percent: f64 = caps[1].parse().unwrap_or(0.0);
                let speed_str = caps[3].to_string();
                let eta_str = caps[4].to_string();

                let task_update = ActiveDownloadTask {
                    task_id: task_id.clone(),
                    url: url.clone(),
                    title: initial_record.title.clone(),
                    platform: initial_record.platform.clone(),
                    format_type: format_type.clone(),
                    quality: quality.clone(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent,
                        speed_str,
                        eta_str,
                        downloaded_bytes: None,
                        total_bytes: None,
                    },
                    error: None,
                };

                let _ = app.emit("download-progress", &task_update);
            } else if let Some(caps) = progress_simple_regex.captures(&line) {
                let percent: f64 = caps[1].parse().unwrap_or(0.0);
                let task_update = ActiveDownloadTask {
                    task_id: task_id.clone(),
                    url: url.clone(),
                    title: initial_record.title.clone(),
                    platform: initial_record.platform.clone(),
                    format_type: format_type.clone(),
                    quality: quality.clone(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent,
                        speed_str: "Downloading...".to_string(),
                        eta_str: String::new(),
                        downloaded_bytes: None,
                        total_bytes: None,
                    },
                    error: None,
                };
                let _ = app.emit("download-progress", &task_update);
            }

            if let Some(caps) = merger_regex.captures(&line) {
                downloaded_path = caps["path"].trim().to_string();
            } else if let Some(caps) = destination_regex.captures(&line) {
                downloaded_path = caps[1].trim().to_string();
                let _ = app.emit("download-progress", &ActiveDownloadTask {
                    task_id: task_id.clone(),
                    url: url.clone(),
                    title: initial_record.title.clone(),
                    platform: initial_record.platform.clone(),
                    format_type: format_type.clone(),
                    quality: quality.clone(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent: 1.0,
                        speed_str: "Receiving stream...".to_string(),
                        eta_str: String::new(),
                        downloaded_bytes: None,
                        total_bytes: None,
                    },
                    error: None,
                });
            } else if let Some(caps) = already_downloaded_regex.captures(&line) {
                downloaded_path = caps[1].trim().to_string();
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Process wait failed: {}", e))?;
    let _ = stderr_handle.join();
    process_mgr.remove(&task_id);

    if status.success() {
        // 1. Authoritative resolution: read exact path written by yt-dlp --print-to-file
        if meta_file_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&meta_file_path) {
                for line in content.lines() {
                    let candidate = line.trim();
                    if !candidate.is_empty() {
                        let pb = PathBuf::from(candidate);
                        if pb.exists() {
                            downloaded_path = pb.to_string_lossy().to_string();
                            break;
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(&meta_file_path);
        }

        // 2. Fallback: resolve relative path against out_dir if needed
        if downloaded_path.is_empty() || !Path::new(&downloaded_path).exists() {
            if !downloaded_path.is_empty() {
                let relative_candidate = out_dir.join(&downloaded_path);
                if relative_candidate.exists() {
                    downloaded_path = relative_candidate.to_string_lossy().to_string();
                }
            }
        }

        // 3. Fallback: locate by video ID or title if still unresolved
        if downloaded_path.is_empty() || !Path::new(&downloaded_path).exists() {
            if let Ok(entries) = std::fs::read_dir(&out_dir) {
                let mut matched_file: Option<PathBuf> = None;
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                        if ["mp4", "webm", "mkv", "mp3", "m4a", "wav", "flac"].contains(&ext.as_str()) {
                            let filename = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                            if let Some(ref custom) = custom_name {
                                if filename.contains(custom) {
                                    matched_file = Some(p);
                                    break;
                                }
                            } else if let Some(yt_id) = extract_youtube_id(&url) {
                                if filename.contains(&yt_id) {
                                    matched_file = Some(p);
                                    break;
                                }
                            }
                        }
                    }
                }
                if let Some(found) = matched_file {
                    downloaded_path = found.to_string_lossy().to_string();
                }
            }
        }

        let file_size = if !downloaded_path.is_empty() {
            std::fs::metadata(&downloaded_path).map(|m| m.len() as i64).unwrap_or(0)
        } else {
            0
        };

        let _ = db.update_record(
            &task_id,
            "completed",
            Some(&downloaded_path),
            Some(file_size),
            None,
        );

        let _ = db.log_event(
            &task_id,
            "INFO",
            "DOWNLOAD",
            &format!("Download completed: {}", downloaded_path),
            Some(&format!("fileSizeBytes: {}", file_size)),
        );

        let final_task = ActiveDownloadTask {
            task_id: task_id.clone(),
            url: url.clone(),
            title: initial_record.title,
            platform: initial_record.platform,
            format_type,
            quality,
            status: "completed".to_string(),
            progress: TaskProgress {
                percent: 100.0,
                speed_str: "Done".to_string(),
                eta_str: "00:00".to_string(),
                downloaded_bytes: Some(file_size),
                total_bytes: Some(file_size),
            },
            error: None,
        };
        let _ = app.emit("download-progress", &final_task);
        Ok(())
    } else {
        let _ = std::fs::remove_file(&meta_file_path);

        // Fallback: If yt-dlp failed (e.g. "No video formats found" on photo post), attempt native image extraction
        if format_type != "audio" {
            if let Ok(bundle) = crate::image_extractor::try_extract_image_media(&url).await {
                if crate::image_extractor::download_image_bundle(
                    &app,
                    db.clone(),
                    &task_id,
                    &bundle,
                    &out_dir,
                    custom_name.clone(),
                    selected_indices.clone(),
                )
                .await
                .is_ok()
                {
                    return Ok(());
                }
            }
        }

        let last_err_line = {
            let lock = stderr_lines.lock().ok();
            lock.and_then(|lines| {
                lines
                    .iter()
                    .rev()
                    .find(|l| l.contains("ERROR:") || l.contains("Error") || l.contains("HTTP Error"))
                    .cloned()
                    .or_else(|| lines.last().cloned())
            })
        };

        let err_msg = match last_err_line {
            Some(msg) => format!("{}: {}", status.code().map(|c| format!("Code {}", c)).unwrap_or_else(|| "Error".to_string()), msg),
            None => format!("Download exited with code {:?}", status.code()),
        };

        let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
        let _ = db.log_event(
            &task_id,
            "ERROR",
            "DOWNLOAD",
            &format!("Download failed for URL: {}. Reason: {}", url, err_msg),
            None,
        );

        let err_task = ActiveDownloadTask {
            task_id: task_id.clone(),
            url: url.clone(),
            title: initial_record.title,
            platform: initial_record.platform,
            format_type,
            quality,
            status: "error".to_string(),
            progress: TaskProgress {
                percent: 0.0,
                speed_str: "Failed".to_string(),
                eta_str: "--:--".to_string(),
                downloaded_bytes: None,
                total_bytes: None,
            },
            error: Some(err_msg.clone()),
        };
        let _ = app.emit("download-progress", &err_task);
        Err(err_msg)
    }
}



