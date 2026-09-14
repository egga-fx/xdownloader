use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::binaries::find_binary;
use crate::db::Database;
use crate::models::{ActiveDownloadTask, DownloadRecord, TaskProgress, TimeRange};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct ProcessManager {
    children: Mutex<HashMap<String, u32>>, // taskId -> process PID
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
) -> Result<(), String> {
    let ytdlp_path = find_binary("yt-dlp")
        .ok_or_else(|| "yt-dlp binary is not installed".to_string())?;

    let ffmpeg_path = find_binary("ffmpeg");

    let out_dir = match output_folder {
        Some(dir) if !dir.trim().is_empty() => PathBuf::from(dir.trim()),
        _ => get_default_download_dir(),
    };
    let _ = std::fs::create_dir_all(&out_dir);

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
        let err_msg = format!("Download exited with code {:?}", status.code());
        let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));

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
