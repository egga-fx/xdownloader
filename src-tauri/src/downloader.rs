use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::binaries::find_binary;
use crate::db::Database;
use crate::models::{
    ActiveDownloadTask, DownloadRecord, SplitLocalRequest, SplitStreamRequest, TaskProgress,
    TimeRange, TrimStreamRequest, TrimVideoRequest,
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
        let platform_name = if url.contains("instagram.com") {
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

    // Template output filename (sanitized for Windows filesystem)
    let out_template = match custom_name.as_deref() {
        Some(name) if !name.trim().is_empty() => {
            let clean = sanitize_filename(name.trim());
            out_dir.join(format!("{}.%(ext)s", clean))
        }
        _ => out_dir.join("%(title)s [%(id)s].%(ext)s"),
    };

    let mut cmd = Command::new(&ytdlp_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.arg("--newline")
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("-o")
        .arg(out_template.to_string_lossy().to_string());

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
                cmd.arg("-f").arg("bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best");
                cmd.arg("-S").arg("res:2160,fps");
            }
            "1440p" => {
                cmd.arg("-f").arg("bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1440]+bestaudio/best");
                cmd.arg("-S").arg("res:1440,fps");
            }
            "1080p" => {
                cmd.arg("-f").arg("bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best");
                cmd.arg("-S").arg("res:1080,fps");
            }
            "720p" => {
                cmd.arg("-f").arg("bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best");
                cmd.arg("-S").arg("res:720,fps");
            }
            "480p" => {
                cmd.arg("-f").arg("bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best");
                cmd.arg("-S").arg("res:480,fps");
            }
            _ => {
                cmd.arg("-f").arg("bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best");
            }
        }
        cmd.arg("--merge-output-format").arg("mp4");
    }

    // Comprehensive Subtitles (manual + auto-generated AI captions)
    if download_subtitles {
        cmd.arg("--write-sub")
            .arg("--write-auto-sub")
            .arg("--sub-lang").arg("en,id,en.*,id.*")
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

    cmd.arg(&url);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
    let pid = child.id();
    process_mgr.register(task_id.clone(), pid);

    // Metadata resolution for the initial DB record
    let rec_title = custom_name.clone().or(title).unwrap_or_else(|| url.clone());
    let mut rec_thumb = thumbnail_url.unwrap_or_default();
    let rec_author = author.unwrap_or_default();
    let rec_duration = duration_sec.unwrap_or(0);

    // Fallback: extract YouTube thumbnail directly from video ID if empty
    if rec_thumb.is_empty() {
        if let Some(yt_id) = extract_youtube_id(&url) {
            rec_thumb = format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", yt_id);
        }
    }

    // Detect platform
    let platform = if url.contains("youtube.com") || url.contains("youtu.be") {
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

    let progress_regex = Regex::new(r"\[download\]\s+([0-9.]+)% of\s+~?([0-9.]+[A-Za-z]+)\s+at\s+([0-9.]+[A-Za-z/]+)\s+ETA\s+([0-9:]+)").unwrap();
    let merger_regex = Regex::new(r#"\[Merger\] Merging formats into "(?P<path>[^"]+)""#).unwrap();
    let destination_regex = Regex::new(r"\[(?:download|ExtractAudio)\] Destination:\s+(.+)").unwrap();
    let already_downloaded_regex = Regex::new(r"\[download\]\s+(.+)\s+has already been downloaded").unwrap();

    let stdout = child.stdout.take().unwrap();
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
            }

            if let Some(caps) = merger_regex.captures(&line) {
                downloaded_path = caps["path"].trim().to_string();
            } else if let Some(caps) = destination_regex.captures(&line) {
                downloaded_path = caps[1].trim().to_string();
            } else if let Some(caps) = already_downloaded_regex.captures(&line) {
                downloaded_path = caps[1].trim().to_string();
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Process wait failed: {}", e))?;
    process_mgr.remove(&task_id);

    if status.success() {
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

        let err_msg = format!("Download exited with code {:?}", status.code());
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

pub fn time_str_to_seconds(t: &str) -> i64 {
    let parts: Vec<&str> = t.trim().split(':').collect();
    match parts.len() {
        3 => {
            let h: i64 = parts[0].parse().unwrap_or(0);
            let m: i64 = parts[1].parse().unwrap_or(0);
            let s: f64 = parts[2].parse().unwrap_or(0.0);
            h * 3600 + m * 60 + s as i64
        }
        2 => {
            let m: i64 = parts[0].parse().unwrap_or(0);
            let s: f64 = parts[1].parse().unwrap_or(0.0);
            m * 60 + s as i64
        }
        1 => parts[0].parse::<f64>().unwrap_or(0.0) as i64,
        _ => 0,
    }
}

pub async fn split_local_video(
    app: AppHandle,
    db: Arc<Database>,
    req: SplitLocalRequest,
) -> Result<Vec<String>, String> {
    let in_path = PathBuf::from(&req.file_path);
    if !in_path.exists() {
        return Err(format!("Source video file does not exist: {}", req.file_path));
    }

    let stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video")
        .to_string();

    let ext = in_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4")
        .to_string();

    let base_parent = match req.output_folder {
        Some(ref d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => in_path.parent().unwrap_or(&PathBuf::from(".")).to_path_buf(),
    };

    let out_dir = if req.create_subfolder {
        base_parent.join(format!("{}_parts", sanitize_filename(&stem)))
    } else {
        base_parent
    };

    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let ffmpeg_path = find_binary("ffmpeg")
        .ok_or_else(|| "FFmpeg binary is not installed. Please setup engines first.".to_string())?;

    let mut created_paths: Vec<String> = Vec::new();
    let total_segments = req.segments.len();

    for (idx, seg) in req.segments.iter().enumerate() {
        let part_filename = format!("{}_part_{:02}.{}", sanitize_filename(&stem), seg.part_index, ext);
        let out_path = out_dir.join(&part_filename);
        let out_str = out_path.to_string_lossy().to_string();

        let mut cmd = Command::new(&ffmpeg_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.arg("-ss")
            .arg(&seg.start)
            .arg("-to")
            .arg(&seg.end)
            .arg("-i")
            .arg(&in_path);

        if req.precise_cut {
            cmd.arg("-c:v")
                .arg("libx264")
                .arg("-crf")
                .arg("18")
                .arg("-preset")
                .arg("fast")
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("192k");
        } else {
            cmd.arg("-c")
                .arg("copy")
                .arg("-avoid_negative_ts")
                .arg("make_zero");
        }

        cmd.arg("-y").arg(&out_path);

        let output = cmd.output().map_err(|e| format!("Failed to run FFmpeg: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg splitting failed on Part {}: {}", seg.part_index, stderr));
        }

        let file_size = std::fs::metadata(&out_path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);

        let start_sec = time_str_to_seconds(&seg.start);
        let end_sec = time_str_to_seconds(&seg.end);
        let part_duration = (end_sec - start_sec).max(1);

        let record_id = format!("split_{}_{:02}", chrono::Utc::now().timestamp_millis(), seg.part_index);
        let part_title = if let Some(ref l) = seg.label {
            if !l.trim().is_empty() {
                format!("{} ({})", stem, l.trim())
            } else {
                format!("{} (Part {:02})", stem, seg.part_index)
            }
        } else {
            format!("{} (Part {:02})", stem, seg.part_index)
        };

        let is_audio = ext == "mp3" || ext == "wav" || ext == "m4a" || ext == "flac" || ext == "opus";
        let record = DownloadRecord {
            id: record_id.clone(),
            platform: "local_split".to_string(),
            url: format!("file://{}", out_str),
            title: part_title,
            author: "Video Splitter".to_string(),
            duration_sec: part_duration,
            thumbnail_url: String::new(),
            format_type: if is_audio { "audio".to_string() } else { "video".to_string() },
            quality: if req.precise_cut { "precise".to_string() } else { "lossless".to_string() },
            file_path: out_str.clone(),
            file_size_bytes: file_size,
            status: "completed".to_string(),
            error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            time_range: Some(TimeRange {
                start: seg.start.clone(),
                end: seg.end.clone(),
            }),
            exists: true,
        };

        let _ = db.add_record(&record);

        let pct = ((idx + 1) as f64 / total_segments as f64) * 100.0;
        let _ = app.emit(
            "split-progress",
            serde_json::json!({
                "partIndex": seg.part_index,
                "totalParts": total_segments,
                "percent": pct,
                "filePath": out_str,
                "title": record.title,
                "status": "completed",
            }),
        );

        created_paths.push(out_str);
    }

    Ok(created_paths)
}

pub async fn split_stream_video(
    app: AppHandle,
    db: Arc<Database>,
    process_mgr: Arc<ProcessManager>,
    req: SplitStreamRequest,
) -> Result<Vec<String>, String> {
    let base_title = req.title.unwrap_or_else(|| "stream".to_string());
    let clean_title = sanitize_filename(&base_title);

    let base_dir = match req.output_folder {
        Some(ref d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => get_default_download_dir(),
    };

    let out_dir = if req.create_subfolder {
        base_dir.join(format!("{}_parts", clean_title))
    } else {
        base_dir
    };

    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let mut task_ids: Vec<String> = Vec::new();
    let total_segments = req.segments.len();

    for (idx, seg) in req.segments.iter().enumerate() {
        let task_id = format!("split_stream_{}_{:02}", chrono::Utc::now().timestamp_millis(), seg.part_index);
        let part_name = format!("{}_part_{:02}", clean_title, seg.part_index);
        let part_title = if let Some(ref l) = seg.label {
            if !l.trim().is_empty() {
                format!("{} ({})", base_title, l.trim())
            } else {
                format!("{} (Part {:02})", base_title, seg.part_index)
            }
        } else {
            format!("{} (Part {:02})", base_title, seg.part_index)
        };

        let start_sec = time_str_to_seconds(&seg.start);
        let end_sec = time_str_to_seconds(&seg.end);
        let part_duration = (end_sec - start_sec).max(1);

        task_ids.push(task_id.clone());

        let _ = app.emit(
            "split-progress",
            serde_json::json!({
                "partIndex": seg.part_index,
                "totalParts": total_segments,
                "percent": ((idx as f64) / total_segments as f64) * 100.0,
                "title": part_title,
                "status": "starting",
            }),
        );

        let dl_res = run_download(
            app.clone(),
            db.clone(),
            process_mgr.clone(),
            task_id,
            req.url.clone(),
            req.format_type.clone(),
            req.quality.clone(),
            Some(part_title),
            req.thumbnail_url.clone(),
            req.author.clone(),
            Some(part_duration),
            Some(part_name),
            Some(out_dir.to_string_lossy().to_string()),
            false,
            Some(TimeRange {
                start: seg.start.clone(),
                end: seg.end.clone(),
            }),
            None,
            None,
        )
        .await;

        if let Err(e) = dl_res {
            eprintln!("Warning: Failed to split part {}: {}", seg.part_index, e);
        }
    }

    Ok(task_ids)
}

pub fn format_seconds_to_timestamp(sec: f64) -> String {
    let total_secs = sec.max(0.0) as u64;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

pub async fn trim_local_video_exact(
    app: AppHandle,
    db: Arc<Database>,
    req: TrimVideoRequest,
) -> Result<String, String> {
    let in_path = PathBuf::from(&req.file_path);
    if !in_path.exists() {
        return Err(format!("Source video file does not exist: {}", req.file_path));
    }

    let stem = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video")
        .to_string();

    let clean_stem = sanitize_filename(&stem);
    let base_parent = match req.output_folder {
        Some(ref d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => in_path.parent().unwrap_or(&PathBuf::from(".")).to_path_buf(),
    };
    let _ = std::fs::create_dir_all(&base_parent);

    let ts = chrono::Utc::now().timestamp();
    let final_filename = match req.custom_name {
        Some(ref name) if !name.trim().is_empty() => {
            let clean = sanitize_filename(name.trim());
            format!("{}_trim_{}.mp4", clean, ts)
        }
        _ => format!("{}_trim_{}.mp4", clean_stem, ts),
    };

    let out_file = base_parent.join(&final_filename);
    let ffmpeg_path = find_binary("ffmpeg")
        .ok_or_else(|| "FFmpeg binary is not installed. Please setup engines first.".to_string())?;

    let start_sec = req.start_sec.max(0.0);
    let end_sec = req.end_sec.max(start_sec + 0.1);
    let duration = end_sec - start_sec;

    let start_ts = format!("{:.3}", start_sec);
    let to_ts = format!("{:.3}", end_sec);

    let mut cmd = Command::new(&ffmpeg_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    // Frame-Accurate Re-encode:
    // -ss before -i for fast seek, -to for precise end, re-encode with libx264 fast crf 22 + aac
    cmd.arg("-y")
        .arg("-ss")
        .arg(&start_ts)
        .arg("-to")
        .arg(&to_ts)
        .arg("-i")
        .arg(&in_path)
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("fast")
        .arg("-crf")
        .arg("22")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-movflags")
        .arg("+faststart")
        .arg(&out_file);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute FFmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg trim error: {}", stderr.lines().last().unwrap_or("Unknown error")));
    }

    let file_size = std::fs::metadata(&out_file)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let task_id = format!("trim_{}_{}", ts, &stem.chars().take(8).collect::<String>());
    let out_path_str = out_file.to_string_lossy().to_string();

    let record = DownloadRecord {
        id: task_id.clone(),
        platform: "local".to_string(),
        url: out_path_str.clone(),
        title: format!("{} (Trimmed)", stem),
        author: "xDownloader Studio".to_string(),
        duration_sec: duration.round() as i64,
        thumbnail_url: "".to_string(),
        format_type: "video".to_string(),
        quality: "1080p".to_string(),
        file_path: out_path_str.clone(),
        file_size_bytes: file_size,
        status: "completed".to_string(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        time_range: Some(TimeRange {
            start: format_seconds_to_timestamp(start_sec),
            end: format_seconds_to_timestamp(end_sec),
        }),
        exists: true,
    };

    let _ = db.add_record(&record);

    let _ = app.emit(
        "download-progress",
        ActiveDownloadTask {
            task_id,
            url: out_path_str.clone(),
            title: format!("{} (Trimmed)", stem),
            platform: "local".to_string(),
            format_type: "video".to_string(),
            quality: "1080p".to_string(),
            status: "completed".to_string(),
            progress: TaskProgress {
                percent: 100.0,
                speed_str: "Trimmed".to_string(),
                eta_str: "00:00".to_string(),
                downloaded_bytes: Some(file_size),
                total_bytes: Some(file_size),
            },
            error: None,
        },
    );

    Ok(out_path_str)
}

pub async fn trim_stream_video_exact(
    app: AppHandle,
    db: Arc<Database>,
    process_mgr: Arc<ProcessManager>,
    req: TrimStreamRequest,
) -> Result<String, String> {
    let ts = chrono::Utc::now().timestamp();
    let base_title = req.title.clone().unwrap_or_else(|| "Online Video".to_string());
    let clean_title = sanitize_filename(&base_title);

    let final_filename = match req.custom_name {
        Some(ref name) if !name.trim().is_empty() => {
            let clean = sanitize_filename(name.trim());
            format!("{}_trim_{}", clean, ts)
        }
        _ => format!("{}_trim_{}", clean_title, ts),
    };

    let start_sec = req.start_sec.max(0.0);
    let end_sec = req.end_sec.max(start_sec + 0.1);
    let duration = (end_sec - start_sec).round() as i64;

    let start_ts = format_seconds_to_timestamp(start_sec);
    let end_ts = format_seconds_to_timestamp(end_sec);

    let task_id = format!("trim_stream_{}_{}", ts, &clean_title.chars().take(8).collect::<String>());

    run_download(
        app,
        db,
        process_mgr,
        task_id.clone(),
        req.url,
        req.format_type.unwrap_or_else(|| "video".to_string()),
        req.quality.unwrap_or_else(|| "1080p".to_string()),
        Some(format!("{} (Trimmed)", base_title)),
        req.thumbnail_url,
        req.author,
        Some(duration),
        Some(final_filename),
        req.output_folder,
        false,
        Some(TimeRange {
            start: start_ts,
            end: end_ts,
        }),
        None,
        None,
    )
    .await?;

    Ok(task_id)
}


