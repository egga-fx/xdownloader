use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::binaries::find_binary;
use crate::db::Database;
use crate::models::{
    ActiveDownloadTask, DownloadRecord, LiveStreamConfig, MediaItem, TaskProgress, TimeRange,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

static RE_WHITESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static RE_YOUTUBE_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)([a-zA-Z0-9_-]{11})").unwrap()
});
static RE_TIKTOK_VIDEO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/video/(\d+)").unwrap());
static RE_TIKTOK_PHOTO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/photo/(\d+)").unwrap());
static RE_USER_HANDLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@([^/?#]+)").unwrap());
static RE_INSTAGRAM_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)").unwrap());
static RE_INSTAGRAM_USER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"instagram\.com/([A-Za-z0-9_.]+)(?:/reel|/p|/tv)?").unwrap());
static RE_TWITTER_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/status/(\d+)").unwrap());
static RE_THREADS_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/post/([A-Za-z0-9_-]+)").unwrap());

static RE_PROGRESS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+([0-9.]+)%\s+of\s+~?\s*([0-9.]+[A-Za-z]+)\s+at\s+([0-9.]+[A-Za-z/]+|\S+)\s+ETA\s+([0-9:]+)").unwrap()
});
static RE_PROGRESS_SIMPLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+([0-9.]+)%").unwrap()
});
static RE_LIVE_PROGRESS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:[0-9]+:\s*)?\[download\]\s+([0-9.]+[A-Za-z]+)\s+at\s+([0-9.]+[A-Za-z/]+|\S+)(?:\s+\(([0-9:.]+)\))?(?:\s+\(frag\s+(\d+(?:/\d+)?)\))?").unwrap()
});
static RE_FFMPEG_PROGRESS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:size|Lsize)=\s*([0-9.]+[A-Za-z]+)\s+time=([0-9:.]+)\s+bitrate=\s*([0-9.]+[A-Za-z/]+|\S+)(?:\s+speed=\s*([0-9.]+x|\S+))?").unwrap()
});
static RE_WAIT_STREAM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[wait\]\s+Waiting for\s+([0-9:]+)").unwrap()
});
static RE_MERGER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\[Merger\] Merging formats into "(?P<path>[^"]+)""#).unwrap()
});
static RE_DESTINATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[(?:download|ExtractAudio)\] Destination:\s+(.+)").unwrap()
});
static RE_ALREADY_DOWNLOADED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+(.+)\s+has already been downloaded").unwrap()
});

#[derive(Clone)]
pub struct ProcessTaskInfo {
    pub pid: u32,
    pub out_dir: PathBuf,
    pub stem: String,
}

#[derive(Clone)]
pub struct DownloadTaskContext {
    pub task_id: String,
    pub url: String,
    pub format_type: String,
    pub quality: String,
    pub title: Option<String>,
    pub thumbnail_url: Option<String>,
    pub author: Option<String>,
    pub duration_sec: Option<i64>,
    pub custom_name: Option<String>,
    pub output_folder: Option<String>,
    pub download_subtitles: bool,
    pub time_range: Option<TimeRange>,
    pub selected_indices: Option<Vec<usize>>,
    pub image_urls: Option<Vec<String>>,
    pub media_items: Option<Vec<MediaItem>>,
    pub live_config: Option<LiveStreamConfig>,
    pub out_dir: PathBuf,
    pub raw_stem: String,
}

pub struct ProcessManager {
    children: Mutex<HashMap<String, ProcessTaskInfo>>,
    native_tasks: Mutex<HashMap<String, (tokio::task::AbortHandle, PathBuf, String)>>,
    contexts: Mutex<HashMap<String, DownloadTaskContext>>,
    paused: Mutex<HashMap<String, bool>>,
    stopped_live: Mutex<HashMap<String, bool>>,
    snapshots: Mutex<HashMap<String, ActiveDownloadTask>>,
    logs: Mutex<HashMap<String, Vec<String>>>,
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
            native_tasks: Mutex::new(HashMap::new()),
            contexts: Mutex::new(HashMap::new()),
            paused: Mutex::new(HashMap::new()),
            stopped_live: Mutex::new(HashMap::new()),
            snapshots: Mutex::new(HashMap::new()),
            logs: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, task_id: String, pid: u32, out_dir: PathBuf, stem: String) {
        if let Ok(mut map) = self.children.lock() {
            map.insert(task_id, ProcessTaskInfo { pid, out_dir, stem });
        }
    }

    pub fn register_native(&self, task_id: String, handle: tokio::task::AbortHandle, out_dir: PathBuf, stem: String) {
        if let Ok(mut map) = self.native_tasks.lock() {
            map.insert(task_id, (handle, out_dir, stem));
        }
    }

    pub fn register_context(&self, context: DownloadTaskContext) {
        if let Ok(mut map) = self.contexts.lock() {
            map.insert(context.task_id.clone(), context);
        }
    }

    pub fn get_context(&self, task_id: &str) -> Option<DownloadTaskContext> {
        self.contexts.lock().ok().and_then(|map| map.get(task_id).cloned())
    }

    pub fn remove_context(&self, task_id: &str) {
        if let Ok(mut map) = self.contexts.lock() {
            map.remove(task_id);
        }
    }

    pub fn update_active_task_snapshot(&self, task: &ActiveDownloadTask) {
        if let Ok(mut map) = self.snapshots.lock() {
            map.insert(task.task_id.clone(), task.clone());
        }
    }

    pub fn get_active_task_snapshot(&self, task_id: &str) -> Option<ActiveDownloadTask> {
        self.snapshots.lock().ok().and_then(|map| map.get(task_id).cloned())
    }

    pub fn append_log(&self, task_id: &str, line: &str) {
        let clean = line.trim();
        if clean.is_empty() {
            return;
        }
        if let Ok(mut map) = self.logs.lock() {
            let entry = map.entry(task_id.to_string()).or_insert_with(Vec::new);
            entry.push(clean.to_string());
            if entry.len() > 60 {
                entry.remove(0);
            }
        }
    }

    pub fn get_logs(&self, task_id: &str) -> Vec<String> {
        self.logs.lock().ok().and_then(|map| map.get(task_id).cloned()).unwrap_or_default()
    }

    pub fn is_paused(&self, task_id: &str) -> bool {
        self.paused.lock().ok().and_then(|map| map.get(task_id).copied()).unwrap_or(false)
    }

    pub fn unmark_paused(&self, task_id: &str) {
        if let Ok(mut map) = self.paused.lock() {
            map.remove(task_id);
        }
    }

    pub fn is_stopped_live(&self, task_id: &str) -> bool {
        self.stopped_live.lock().ok().and_then(|map| map.get(task_id).copied()).unwrap_or(false)
    }

    pub fn unmark_stopped_live(&self, task_id: &str) {
        if let Ok(mut map) = self.stopped_live.lock() {
            map.remove(task_id);
        }
    }

    /// Stops an active live stream recording and preserves `.part` / `.live_chat.json`
    /// so `run_download` can remux and finalize the video file onto disk.
    pub fn stop_live(&self, task_id: &str) -> bool {
        let mut stopped = false;
        if let Ok(mut map) = self.stopped_live.lock() {
            map.insert(task_id.to_string(), true);
        }

        if let Ok(mut map) = self.children.lock() {
            if let Some(info) = map.remove(task_id) {
                crate::logger::write_file_log(
                    "INFO",
                    "PROCESS",
                    task_id,
                    &format!("Stopping live recording process PID {} to finalize file", info.pid),
                );
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .creation_flags(CREATE_NO_WINDOW)
                        .args(["/F", "/T", "/PID", &info.pid.to_string()])
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("kill")
                        .args(["-2", &info.pid.to_string()])
                        .output();
                }
                stopped = true;
            }
        }
        stopped
    }

    pub fn remove(&self, task_id: &str) {
        if let Ok(mut map) = self.children.lock() {
            map.remove(task_id);
        }
        if let Ok(mut map) = self.native_tasks.lock() {
            map.remove(task_id);
        }
    }

    pub fn pause(&self, task_id: &str) -> bool {
        let mut paused_any = false;
        if let Ok(mut map) = self.paused.lock() {
            map.insert(task_id.to_string(), true);
        }

        if let Ok(mut map) = self.children.lock() {
            if let Some(info) = map.remove(task_id) {
                crate::logger::write_file_log("WARN", "PROCESS", task_id, &format!("Paused process PID: {}", info.pid));
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .creation_flags(CREATE_NO_WINDOW)
                        .args(["/F", "/T", "/PID", &info.pid.to_string()])
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("kill")
                        .args(["-9", &info.pid.to_string()])
                        .output();
                }
                // Partial files (.part / .ytdl) are intentionally preserved for resumption.
                paused_any = true;
            }
        }

        if let Ok(mut map) = self.native_tasks.lock() {
            if let Some((handle, _out_dir, _stem)) = map.remove(task_id) {
                crate::logger::write_file_log("WARN", "PROCESS", task_id, "Aborted native download task for pause");
                handle.abort();
                // Partial files are intentionally preserved for resumption.
                paused_any = true;
            }
        }

        paused_any
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        let mut cancelled = false;
        if let Ok(mut map) = self.children.lock() {
            if let Some(info) = map.remove(task_id) {
                crate::logger::write_file_log("WARN", "PROCESS", task_id, &format!("Killed process PID: {}", info.pid));
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .creation_flags(CREATE_NO_WINDOW)
                        .args(["/F", "/T", "/PID", &info.pid.to_string()])
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("kill")
                        .args(["-9", &info.pid.to_string()])
                        .output();
                }

                // Immediately clean up any partial artifacts (.part, .ytdl, .temp.*, .f*.mp4)
                cleanup_task_artifacts(&info.out_dir, Some(&info.stem));
                cancelled = true;
            }
        }

        if let Ok(mut map) = self.native_tasks.lock() {
            if let Some((handle, out_dir, stem)) = map.remove(task_id) {
                crate::logger::write_file_log("WARN", "PROCESS", task_id, "Aborted native download task for cancel");
                handle.abort();
                cleanup_task_artifacts(&out_dir, Some(&stem));
                cancelled = true;
            }
        }

        if let Some(ctx) = self.get_context(task_id) {
            cleanup_task_artifacts(&ctx.out_dir, Some(&ctx.raw_stem));
            cancelled = true;
        }

        self.remove_context(task_id);
        self.unmark_paused(task_id);
        self.unmark_stopped_live(task_id);
        if let Ok(mut map) = self.snapshots.lock() {
            map.remove(task_id);
        }

        cancelled
    }
}

pub fn cleanup_task_artifacts(dir: &Path, expected_stem: Option<&str>) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }
    let clean_stem = expected_stem.map(sanitize_filename);

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let name_lower = name.to_lowercase();

            let is_temp_extension = name_lower.ends_with(".part")
                || name_lower.ends_with(".ytdl")
                || name_lower.contains(".part-frag")
                || name_lower.contains(".temp.mp4")
                || name_lower.contains(".temp.mkv")
                || name_lower.contains(".temp.webm")
                || name_lower.contains(".temp.m4a");

            let matches_stem = if let Some(ref stem) = clean_stem {
                if !stem.is_empty() {
                    name.contains(stem.as_str())
                } else {
                    false
                }
            } else {
                false
            };

            // Critical B02 protection: Never delete the primary output file whose stem matches the expected stem!
            if let Some(ref stem) = clean_stem {
                let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                if file_stem == stem.as_str() {
                    continue;
                }
            }

            let is_format_fragment = matches_stem && {
                static FORMAT_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
                    Regex::new(r"\.f\d{1,5}\.(?:mp4|m4a|webm|mkv)$").unwrap()
                });
                FORMAT_RE.is_match(&name_lower)
            };

            if (matches_stem && (is_temp_extension || is_format_fragment)) || (clean_stem.is_none() && is_temp_extension) {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

pub fn sweep_orphaned_temp_files(dir: &Path) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let name_lower = name.to_lowercase();

            // General sweep of lingering temporary debris
            if name_lower.ends_with(".part")
                || name_lower.ends_with(".ytdl")
                || name_lower.contains(".part-frag")
                || name_lower.ends_with(".temp.mp4")
                || name_lower.ends_with(".temp.mkv")
                || name_lower.ends_with(".temp.webm")
                || name_lower.ends_with(".temp.m4a")
            {
                // Protect files that were modified within the last 24 hours (could be active or paused downloads)
                if let Ok(metadata) = p.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(elapsed) = modified.elapsed() {
                            if elapsed < std::time::Duration::from_secs(3600 * 24) {
                                continue;
                            }
                        }
                    }
                }
                let _ = std::fs::remove_file(&p);
            }
        }
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

pub fn sanitize_filename(name: &str) -> String {
    // 1. Replace control chars (code < 32, \n, \r, \t) and invalid Windows chars
    let sanitized: String = name
        .chars()
        .map(|c| {
            if (c as u32) < 32 {
                ' '
            } else {
                match c {
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
                    _ => c,
                }
            }
        })
        .collect();

    // 2. Collapse consecutive spaces
    let collapsed = RE_WHITESPACE.replace_all(&sanitized, " ").to_string();

    // 3. Trim leading/trailing whitespace, periods, and commas
    let trimmed = collapsed.trim().trim_matches(|c| c == '.' || c == ' ' || c == ',');

    // 4. Truncate unicode stem to max 80 chars cleanly at word boundary if long
    let char_count = trimmed.chars().count();
    let truncated: String = if char_count <= 80 {
        trimmed.to_string()
    } else {
        let first_80: String = trimmed.chars().take(80).collect();
        if let Some(last_space) = first_80.rfind(' ') {
            if last_space > 50 {
                first_80[..last_space].to_string()
            } else {
                first_80
            }
        } else {
            first_80
        }
    };
    let final_clean = truncated.trim().trim_matches(|c| c == '.' || c == ' ' || c == '-' || c == '_' || c == ',').to_string();

    if final_clean.is_empty() {
        "media_download".to_string()
    } else {
        final_clean
    }
}

/// Strips common media, audio, image, and subtitle extensions from custom filenames or stems.
pub fn strip_media_extension(name: &str) -> &str {
    let lower = name.to_lowercase();
    const EXTENSIONS: &[&str] = &[
        ".mp4", ".webm", ".mkv", ".mov", ".avi", ".flv", ".ts", ".m4v", ".wmv",
        ".mp3", ".m4a", ".wav", ".flac", ".aac", ".opus", ".ogg",
        ".jpg", ".jpeg", ".png", ".webp", ".gif",
        ".srt", ".vtt", ".txt",
    ];
    for ext in EXTENSIONS {
        if lower.ends_with(ext) {
            return &name[..name.len() - ext.len()];
        }
    }
    name
}

/// Normalizes intermediate or format-tagged download filenames emitted by yt-dlp into canonical output filenames.
/// Strips `.part`, `.ytdl`, and internal format tags like `.f137.mp4` -> `.mp4`.
pub fn clean_download_filename(filename: &str, default_ext: &str) -> String {
    let mut s = filename.trim();
    if let Some(stripped) = s.strip_suffix(".part") {
        s = stripped.trim();
    }
    if let Some(stripped) = s.strip_suffix(".ytdl") {
        s = stripped.trim();
    }

    // Handle yt-dlp format selectors e.g. "MyVideo-Author.f137.mp4" or "MyVideo-Author.f140.m4a"
    // Format IDs in yt-dlp are numeric (e.g. f137, f248) or format aliases (fba, fbv).
    if let Some(f_idx) = s.rfind(".f") {
        let after_dot = &s[f_idx + 2..];
        let starts_with_format_id = after_dot.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
            || after_dot.starts_with("ba")
            || after_dot.starts_with("bv");
        if starts_with_format_id {
            let format_id_len = after_dot.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').count();
            if format_id_len > 0 {
                let rest = &after_dot[format_id_len..];
                let stem = &s[..f_idx];
                let ext = if rest.starts_with('.') {
                    &rest[1..]
                } else {
                    default_ext
                };
                return format!("{}.{}", stem, ext);
            }
        }
    }

    let stem = strip_media_extension(s);
    let ext = std::path::Path::new(s)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .unwrap_or(default_ext);

    format!("{}.{}", stem, ext)
}

/// Extracts clean author or channel name from a standardized filename stem ($file_name-$author.$format).
pub fn extract_author_from_filename(filename: &str) -> Option<String> {
    let stem = strip_media_extension(filename);
    if let Some(idx) = stem.rfind('-') {
        let potential_author = stem[idx + 1..].trim();
        let clean = potential_author.trim_start_matches('@').trim();
        if !clean.is_empty()
            && !clean.eq_ignore_ascii_case("youtube")
            && !clean.eq_ignore_ascii_case("tiktok")
            && !clean.eq_ignore_ascii_case("instagram")
            && !clean.eq_ignore_ascii_case("web_media")
            && !clean.eq_ignore_ascii_case("unknown")
            && !clean.eq_ignore_ascii_case("na")
        {
            return Some(clean.to_string());
        }
    }
    None
}

/// Identifies whether a raw title string is an unparsed fallback URL or generic placeholder.
pub fn is_fallback_title(title: &str) -> bool {
    let trimmed = title.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("media")
        || trimmed.eq_ignore_ascii_case("media_download")
        || trimmed.eq_ignore_ascii_case("untitled media")
    {
        return true;
    }
    let lower = trimmed.to_lowercase();
    lower.starts_with("http")
        || lower.contains("://")
        || lower.contains("youtube.com")
        || lower.contains("youtu.be")
        || lower.contains("tiktok.com")
        || lower.contains("instagram.com")
        || lower.contains("twitter.com")
        || lower.contains("x.com")
        || lower.contains("pinterest.")
        || lower.contains("pin.it")
        || lower.contains("threads.net")
        || lower.contains("threads.com")
        || lower.starts_with("tiktok video")
        || lower.starts_with("youtube video")
        || lower.starts_with("youtube shorts")
        || lower.starts_with("instagram post")
        || lower.starts_with("x post")
        || lower.starts_with("threads post")
        || lower.starts_with("pinterest pin")
        || lower.starts_with("pinterest media")
}

/// Resolves author, channel, or platform source name in order of priority:
/// 1. TikTok: channel display name, then author/uploader, then "TikTok"
/// 2. YouTube: author/uploader_id (without @), then channel, then "YouTube"
/// 3. Other platforms: author, then channel, then platform source name
pub fn resolve_author_or_source(
    author: Option<&str>,
    channel: Option<&str>,
    platform: &str,
    url: &str,
) -> String {
    let plat_lower = platform.to_lowercase();
    let url_lower = url.to_lowercase();
    let is_tiktok = plat_lower == "tiktok" || url_lower.contains("tiktok.com");
    let is_youtube = plat_lower == "youtube" || url_lower.contains("youtube.com") || url_lower.contains("youtu.be");

    // TikTok: Prioritize channel display name, fallback to uploader/author
    if is_tiktok {
        let clean_channel = channel
            .map(|c| c.trim().trim_start_matches('@').trim())
            .filter(|c| !c.is_empty() && *c != "media_download" && !c.eq_ignore_ascii_case("unknown") && !c.eq_ignore_ascii_case("na"));
        if let Some(c) = clean_channel {
            return sanitize_filename(c).chars().take(40).collect::<String>().trim().to_string();
        }
    }

    let clean_author = author
        .map(|a| a.trim().trim_start_matches('@').trim())
        .filter(|a| !a.is_empty() && *a != "media_download" && !a.eq_ignore_ascii_case("unknown") && !a.eq_ignore_ascii_case("na"));
    if let Some(a) = clean_author {
        return sanitize_filename(a).chars().take(40).collect::<String>().trim().to_string();
    }

    let clean_channel = channel
        .map(|c| c.trim().trim_start_matches('@').trim())
        .filter(|c| !c.is_empty() && *c != "media_download" && !c.eq_ignore_ascii_case("unknown") && !c.eq_ignore_ascii_case("na"));
    if let Some(c) = clean_channel {
        return sanitize_filename(c).chars().take(40).collect::<String>().trim().to_string();
    }

    if is_youtube {
        "YouTube".to_string()
    } else if is_tiktok {
        "TikTok".to_string()
    } else if plat_lower == "instagram" || url_lower.contains("instagram.com") {
        "Instagram".to_string()
    } else if plat_lower == "x" || plat_lower == "twitter" || url_lower.contains("twitter.com") || url_lower.contains("x.com") {
        "X".to_string()
    } else if plat_lower == "threads" || url_lower.contains("threads.net") || url_lower.contains("threads.com") {
        "Threads".to_string()
    } else if plat_lower == "pinterest" || url_lower.contains("pinterest.") || url_lower.contains("pin.it") {
        "Pinterest".to_string()
    } else {
        if let Ok(parsed) = reqwest::Url::parse(url) {
            if let Some(host) = parsed.host_str() {
                let clean_host = host.trim_start_matches("www.");
                let parts: Vec<&str> = clean_host.split('.').collect();
                if !parts.is_empty() && !parts[0].is_empty() {
                    let mut chars = parts[0].chars();
                    let capitalized = match chars.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                    };
                    if !capitalized.is_empty() {
                        return sanitize_filename(&capitalized);
                    }
                }
            }
        }
        "WebMedia".to_string()
    }
}

/// Builds the output stem for single video/audio downloads following convention:
/// `$file_name-$author/channel/source_name`.
/// Falls back to `$file_name` when `title_only` is selected or when already deduplicated.
/// Appends a unique per-session suffix to a live recording stem so repeated recordings of the
/// same 24/7 stream never collide with (or get short-circuited by) an older file on disk.
/// Range captures also carry a timestamp, so re-capturing the same range stays unique.
pub fn append_live_recording_suffix(
    stem: &str,
    cfg: &LiveStreamConfig,
    now: chrono::DateTime<chrono::Local>,
) -> String {
    let ts = now.format("%Y-%m-%d %H-%M-%S").to_string();
    match (cfg.mode.as_str(), cfg.time_range.as_ref()) {
        ("capture_time_range", Some(tr)) => {
            let s = tr.start.trim().replace([':', ' '], "-");
            let e = tr.end.trim().replace([':', ' '], "-");
            format!("{} [Range {} - {}] [{}]", stem, s, e, ts)
        }
        _ => format!("{} [{}]", stem, ts),
    }
}

pub fn build_video_stem(author: Option<&str>, title: &str, filename_format: &str) -> String {
    let stripped_title = strip_media_extension(title);
    let clean_title = sanitize_filename(stripped_title);
    if filename_format == "title_only" {
        return clean_title;
    }

    let clean_author = author
        .map(|a| a.trim().trim_start_matches('@').trim())
        .filter(|a| !a.is_empty())
        .map(sanitize_filename)
        .filter(|a| a != "media_download" && !a.eq_ignore_ascii_case("unknown") && !a.eq_ignore_ascii_case("na"))
        .map(|a| a.chars().take(40).collect::<String>().trim().to_string());

    match clean_author {
        Some(author_name) if !author_name.is_empty() => {
            let author_lower = author_name.to_lowercase();
            let title_lower = clean_title.to_lowercase();
            // Deduplicate if title already ends with author (e.g. "Video Title - MrBeast")
            if title_lower.ends_with(&author_lower) {
                let remainder = &title_lower[..title_lower.len() - author_lower.len()];
                if remainder.is_empty()
                    || remainder.ends_with(' ')
                    || remainder.ends_with('-')
                    || remainder.ends_with('_')
                    || remainder.ends_with(':')
                {
                    return clean_title;
                }
            }
            // Deduplicate if title already begins with author (e.g. "MrBeast - I Built 100 Houses")
            if title_lower.starts_with(&author_lower) {
                let remainder = &title_lower[author_lower.len()..];
                if remainder.is_empty()
                    || remainder.starts_with(' ')
                    || remainder.starts_with('-')
                    || remainder.starts_with('_')
                    || remainder.starts_with(':')
                {
                    return clean_title;
                }
            }
            format!("{}-{}", clean_title, author_name)
        }
        _ => clean_title,
    }
}

pub fn get_fallback_media_title(url: &str, author: Option<&str>) -> String {
    let clean_url = url.trim();
    if clean_url.contains("tiktok.com") {
        let vid = RE_TIKTOK_VIDEO.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str());
        let photo_id = RE_TIKTOK_PHOTO.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str());
        let id = vid.or(photo_id);
        let user = author
            .map(|a| a.trim().trim_start_matches('@'))
            .filter(|a| !a.is_empty())
            .or_else(|| {
                RE_USER_HANDLE.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str())
            });
        match (id, user) {
            (Some(i), Some(u)) => format!("TikTok Video {}-{}", i, u),
            (Some(i), None) => format!("TikTok Video {}", i),
            (None, Some(u)) => format!("TikTok Post-{}", u),
            _ => "TikTok Video".to_string(),
        }
    } else if clean_url.contains("youtube.com") || clean_url.contains("youtu.be") {
        let is_shorts = clean_url.contains("/shorts/");
        if let Some(yt_id) = extract_youtube_id(clean_url) {
            let base = if is_shorts {
                format!("YouTube Shorts {}", yt_id)
            } else {
                format!("YouTube Video {}", yt_id)
            };
            if let Some(u) = author.map(|a| a.trim().trim_start_matches('@')).filter(|a| !a.is_empty()) {
                format!("{}-{}", base, u)
            } else {
                base
            }
        } else {
            "YouTube Video".to_string()
        }
    } else if clean_url.contains("instagram.com") {
        let code = RE_INSTAGRAM_CODE.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str());
        let user = author
            .map(|a| a.trim().trim_start_matches('@'))
            .filter(|a| !a.is_empty())
            .or_else(|| {
                RE_INSTAGRAM_USER.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str())
                    .filter(|u| !["p", "reel", "reels", "tv", "stories", "explore"].contains(u))
            });
        match (code, user) {
            (Some(c), Some(u)) => format!("Instagram Post {}-{}", c, u),
            (Some(c), None) => format!("Instagram Post {}", c),
            _ => "Instagram Media".to_string(),
        }
    } else if clean_url.contains("twitter.com") || clean_url.contains("x.com") {
        let id = RE_TWITTER_ID.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str());
        let user = author.map(|a| a.trim().trim_start_matches('@')).filter(|a| !a.is_empty());
        match (id, user) {
            (Some(pid), Some(u)) => format!("X Post {}-{}", pid, u),
            (Some(pid), None) => format!("X Post {}", pid),
            _ => "X Media".to_string(),
        }
    } else if clean_url.contains("threads.net") || clean_url.contains("threads.com") {
        let id = RE_THREADS_ID.captures(clean_url).and_then(|c| c.get(1)).map(|m| m.as_str());
        match id {
            Some(pid) => format!("Threads Post {}", pid),
            None => "Threads Media".to_string(),
        }
    } else if clean_url.contains("pinterest.") || clean_url.contains("pin.it") {
        "Pinterest Media".to_string()
    } else {
        "Media Download".to_string()
    }
}

/// Escapes literal `%` so yt-dlp does not interpret it as an output-template field.
fn escape_ytdlp_template(raw: &str) -> String {
    raw.replace('%', "%%")
}

pub fn generate_local_thumbnail(media_path: &Path, task_id: &str) -> Option<String> {
    if !media_path.exists() || !media_path.is_file() {
        return None;
    }

    let ext = media_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

    // Direct image: if it's already an image, use it directly
    if ["jpg", "jpeg", "png", "webp", "gif"].contains(&ext.as_str()) {
        return Some(media_path.to_string_lossy().to_string());
    }

    let thumb_dir = crate::db::get_thumbnails_dir();
    let safe_stem = sanitize_filename(task_id);
    let target = thumb_dir.join(format!("{}.jpg", safe_stem));

    if target.exists() && std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
        return Some(target.to_string_lossy().to_string());
    }

    let ffmpeg_bin = crate::binaries::find_binary("ffmpeg")?;

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if ["mp4", "webm", "mkv", "mov", "avi", "flv", "ts", "m4v", "wmv"].contains(&ext.as_str()) {
        // Try frame at 1s first
        let mut cmd = std::process::Command::new(&ffmpeg_bin);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.arg("-y")
            .arg("-ss").arg("00:00:01")
            .arg("-i").arg(media_path)
            .arg("-vframes").arg("1")
            .arg("-vf").arg("scale=640:-1")
            .arg("-q:v").arg("3")
            .arg(&target);

        let _ = cmd.output();

        if target.exists() && std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
            return Some(target.to_string_lossy().to_string());
        }

        // Fallback for short clips (<1 sec): frame at 0s
        let mut cmd_fallback = std::process::Command::new(&ffmpeg_bin);
        #[cfg(target_os = "windows")]
        cmd_fallback.creation_flags(CREATE_NO_WINDOW);

        cmd_fallback.arg("-y")
            .arg("-ss").arg("00:00:00")
            .arg("-i").arg(media_path)
            .arg("-vframes").arg("1")
            .arg("-vf").arg("scale=640:-1")
            .arg("-q:v").arg("3")
            .arg(&target);

        let _ = cmd_fallback.output();

        if target.exists() && std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
            return Some(target.to_string_lossy().to_string());
        }
    } else if ["mp3", "m4a", "flac", "wav", "aac", "ogg"].contains(&ext.as_str()) {
        // Extract embedded album art if any
        let mut cmd_audio = std::process::Command::new(&ffmpeg_bin);
        #[cfg(target_os = "windows")]
        cmd_audio.creation_flags(CREATE_NO_WINDOW);

        cmd_audio.arg("-y")
            .arg("-i").arg(media_path)
            .arg("-an")
            .arg("-vcodec").arg("copy")
            .arg(&target);

        let _ = cmd_audio.output();

        if target.exists() && std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
            return Some(target.to_string_lossy().to_string());
        }
    }

    None
}

fn extract_youtube_id(url: &str) -> Option<String> {
    let caps = RE_YOUTUBE_ID.captures(url)?;
    Some(caps[1].to_string())
}

/// Parses human-readable byte strings from yt-dlp / ffmpeg (e.g. "14.52MiB", "15360KiB", "1.2GiB") into raw bytes.
pub fn parse_size_to_bytes(size_str: &str) -> Option<i64> {
    let s = size_str.trim();
    let num_end = s
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(s.len());
    if num_end == 0 {
        return None;
    }
    let val: f64 = s[..num_end].parse().ok()?;
    let unit = s[num_end..].trim().to_lowercase();
    let mult: f64 = match unit.as_str() {
        "b" | "" => 1.0,
        "kib" | "kb" | "k" => 1024.0,
        "mib" | "mb" | "m" => 1024.0 * 1024.0,
        "gib" | "gb" | "g" => 1024.0 * 1024.0 * 1024.0,
        "tib" | "tb" | "t" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((val * mult) as i64)
}

/// Parses "HH:MM:SS(.ms)" or "MM:SS" into seconds.
pub fn parse_hhmmss_to_secs(ts: &str) -> Option<f64> {
    let parts: Vec<&str> = ts.trim().split(':').collect();
    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let s: f64 = parts[2].parse().ok()?;
            Some(h * 3600.0 + m * 60.0 + s)
        }
        2 => {
            let m: f64 = parts[0].parse().ok()?;
            let s: f64 = parts[1].parse().ok()?;
            Some(m * 60.0 + s)
        }
        1 => parts[0].parse().ok(),
        _ => None,
    }
}

/// Builds the exact yt-dlp CLI arguments for YouTube Live Stream recording across all 4 modes:
/// - `record_from_now`: Start capturing immediately (with optional duration or until stream ends)
/// - `rewind_live`: Rewind from start (`--live-from-start`)
/// - `capture_time_range`: Frame-accurate section slicing (`--download-sections` + `--force-keyframes-at-cuts`)
/// - `chat_replay`: Save live chat replay (`--write-subs --sub-langs live_chat --live-from-start`)
pub fn build_live_ytdlp_args(cfg: &LiveStreamConfig, quality: &str) -> Vec<String> {
    let mut args = Vec::<String>::new();

    // 1. Resolution & MP4 Container Compatibility (Reference #1)
    let fmt_selector = match quality {
        "4k" | "2160p" => "bestvideo[height<=2160]+bestaudio/best",
        "1440p" => "bestvideo[height<=1440]+bestaudio/best",
        "1080p" => "bestvideo[height<=1080]+bestaudio/best",
        "720p" => "bestvideo[height<=720]+bestaudio/best",
        "480p" => "bestvideo[height<=480]+bestaudio/best",
        "360p" => "bestvideo[height<=360]+bestaudio/best",
        _ => "bestvideo+bestaudio/best",
    };
    args.push("-f".to_string());
    args.push(fmt_selector.to_string());
    args.push("--merge-output-format".to_string());
    args.push("mp4".to_string());

    // 2. Mode-Specific Arguments
    match cfg.mode.as_str() {
        "rewind_live" => {
            args.push("--live-from-start".to_string());
            args.push("--hls-use-mpegts".to_string());
        }
        "capture_time_range" => {
            // JANGAN pakai --live-from-start di sini: format DASH live-from-start tidak mendukung
            // partial download ("This format cannot be partially downloaded"). Jalur HLS + ffmpeg
            // mendukung --download-sections, dengan offset relatif terhadap jendela DVR stream.
            args.push("--hls-use-mpegts".to_string());
            if let Some(ref tr) = cfg.time_range {
                let start = tr.start.trim();
                let end = tr.end.trim();
                if !start.is_empty() && !end.is_empty() {
                    args.push("--download-sections".to_string());
                    args.push(format!("*{}-{}", start, end));
                }
            }
            if cfg.force_keyframes {
                args.push("--force-keyframes-at-cuts".to_string());
            }
        }
        "chat_replay" => {
            args.push("--write-subs".to_string());
            args.push("--sub-langs".to_string());
            args.push("live_chat".to_string());
            args.push("--live-from-start".to_string());
            args.push("--hls-use-mpegts".to_string());
        }
        _ => {
            // Default: "record_from_now"
            args.push("--hls-use-mpegts".to_string());
            args.push("--downloader".to_string());
            args.push("ffmpeg".to_string());
            if let Some(dur) = cfg.duration_sec {
                if dur > 0 {
                    args.push("--downloader-args".to_string());
                    args.push(format!("ffmpeg_i:-t {}", dur));
                }
            }
        }
    }

    // 3. Save Live Chat Replay alongside Video when toggled on other modes (Reference #2)
    if cfg.download_chat && cfg.mode != "chat_replay" {
        args.push("--write-subs".to_string());
        args.push("--sub-langs".to_string());
        args.push("live_chat".to_string());
    }

    // 4. Idle Wait & Endless Reconnect for Upcoming & Flaky Streams (Reference #3)
    if cfg.wait_for_stream {
        let interval = cfg.wait_interval_sec.unwrap_or(600).max(10);
        args.push("--wait-for-video".to_string());
        args.push(interval.to_string());
    }
    if cfg.auto_reconnect {
        args.push("--retries".to_string());
        args.push("10".to_string());
        args.push("--fragment-retries".to_string());
        args.push("infinite".to_string());
    }

    args
}

/// Converts a yt-dlp `.live_chat.json` (JSON Lines) file into a standard SubRip `.srt` subtitle file
/// so clippers get both `.live_chat.json` and `.live_chat.srt` alongside their recorded video.
pub fn convert_live_chat_json_to_srt(out_dir: &Path, task_stem: &str) -> Option<PathBuf> {
    if !out_dir.exists() || !out_dir.is_dir() {
        return None;
    }

    let clean_stem = sanitize_filename(task_stem);
    let mut target_json: Option<PathBuf> = None;

    if let Ok(entries) = std::fs::read_dir(out_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if !clean_stem.is_empty() && !name.contains(&clean_stem) {
                continue;
            }
            if name.ends_with(".live_chat.json.part") {
                let renamed = p.with_file_name(name.trim_end_matches(".part"));
                if std::fs::rename(&p, &renamed).is_ok() {
                    target_json = Some(renamed);
                    break;
                } else {
                    target_json = Some(p);
                    break;
                }
            } else if name.ends_with(".live_chat.json") {
                target_json = Some(p);
                break;
            }
        }
    }

    let json_path = target_json?;
    let file = std::fs::File::open(&json_path).ok()?;
    let reader = std::io::BufReader::new(file);

    struct ChatEntry {
        offset_ms: i64,
        author: String,
        text: String,
    }

    let mut entries: Vec<ChatEntry> = Vec::new();
    let mut first_timestamp_usec: Option<i64> = None;

    use std::io::BufRead;
    for line_res in reader.lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let val: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // yt-dlp live_chat.json lines can either be direct `{ "replayChatItemAction": ... }`
        // or nested inside `response.continuationContents.liveChatContinuation.actions[]`
        let top_actions: Vec<&serde_json::Value> = if val.get("replayChatItemAction").is_some()
            || val.get("addChatItemAction").is_some()
        {
            vec![&val]
        } else if let Some(arr) = val
            .pointer("/response/continuationContents/liveChatContinuation/actions")
            .and_then(|a| a.as_array())
        {
            arr.iter().collect()
        } else {
            Vec::new()
        };

        for act in top_actions {
            let replay = act.get("replayChatItemAction");
            let explicit_offset_ms = replay
                .and_then(|r| r.get("videoOffsetTimeMsec"))
                .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64()))
                .or_else(|| {
                    act.get("videoOffsetTimeMsec").and_then(|v| {
                        v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64())
                    })
                });

            let inner_actions: Vec<&serde_json::Value> = if let Some(r) = replay {
                r.get("actions")
                    .and_then(|a| a.as_array())
                    .map(|a| a.iter().collect())
                    .unwrap_or_default()
            } else {
                vec![act]
            };

            for inner in inner_actions {
                let item = match inner.pointer("/addChatItemAction/item") {
                    Some(it) => it,
                    None => continue,
                };

                let (renderer, paid_prefix) = if let Some(txt_r) = item.get("liveChatTextMessageRenderer") {
                    (txt_r, None)
                } else if let Some(paid_r) = item.get("liveChatPaidMessageRenderer") {
                    let amt = paid_r
                        .pointer("/purchaseAmountText/simpleText")
                        .and_then(|s| s.as_str())
                        .unwrap_or("SuperChat");
                    (paid_r, Some(format!("[SuperChat {}] ", amt)))
                } else {
                    continue;
                };

                let author = renderer
                    .pointer("/authorName/simpleText")
                    .and_then(|s| s.as_str())
                    .unwrap_or("Viewer")
                    .to_string();

                let mut msg = String::new();
                if let Some(runs) = renderer.pointer("/message/runs").and_then(|r| r.as_array()) {
                    for run in runs {
                        if let Some(t) = run.get("text").and_then(|s| s.as_str()) {
                            msg.push_str(t);
                        } else if let Some(sc) = run
                            .pointer("/emoji/shortcuts/0")
                            .and_then(|s| s.as_str())
                        {
                            msg.push_str(sc);
                        }
                    }
                }
                let clean_msg = msg.trim();
                if clean_msg.is_empty() && paid_prefix.is_none() {
                    continue;
                }

                let offset_ms = if let Some(ms) = explicit_offset_ms {
                    ms.max(0)
                } else if let Some(ts_usec) = renderer
                    .get("timestampUsec")
                    .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64()))
                {
                    let base = *first_timestamp_usec.get_or_insert(ts_usec);
                    ((ts_usec - base) / 1000).max(0)
                } else {
                    0
                };

                let full_text = match paid_prefix {
                    Some(prefix) => format!("{}{}", prefix, clean_msg),
                    None => clean_msg.to_string(),
                };

                entries.push(ChatEntry {
                    offset_ms,
                    author,
                    text: full_text,
                });
            }
        }
    }

    if entries.is_empty() {
        return None;
    }

    entries.sort_by_key(|e| e.offset_ms);

    let mut srt_out = String::new();
    for (idx, entry) in entries.iter().enumerate() {
        let start_secs = (entry.offset_ms as f64) / 1000.0;
        let default_end_secs = start_secs + 3.5;
        let end_secs = if let Some(next) = entries.get(idx + 1) {
            let next_start = (next.offset_ms as f64) / 1000.0;
            if next_start > start_secs && next_start < default_end_secs {
                (next_start).max(start_secs + 0.5)
            } else {
                default_end_secs
            }
        } else {
            default_end_secs
        };

        srt_out.push_str(&format!(
            "{}\n{} --> {}\n[{}]: {}\n\n",
            idx + 1,
            crate::transcriber::format_srt_time(start_secs),
            crate::transcriber::format_srt_time(end_secs),
            entry.author,
            entry.text
        ));
    }

    let json_name = json_path.file_name().and_then(|s| s.to_str()).unwrap_or("live_chat.json");
    let srt_name = if let Some(stripped) = json_name.strip_suffix(".json") {
        format!("{}.srt", stripped)
    } else {
        format!("{}.live_chat.srt", clean_stem)
    };
    let srt_path = out_dir.join(srt_name);
    std::fs::write(&srt_path, srt_out.as_bytes()).ok()?;
    Some(srt_path)
}

/// Checks if a file starts with MPEG-TS sync byte (0x47) instead of standard ISO-BMFF (ftyp/moov/mdat).
pub fn is_mpegts_file(path: &Path) -> bool {
    if let Ok(mut file) = std::fs::File::open(path) {
        use std::io::Read;
        let mut buf = [0u8; 188];
        if let Ok(n) = file.read(&mut buf) {
            if n >= 8 {
                let has_ftyp = &buf[4..8] == b"ftyp";
                let is_ts_sync = buf[0] == 0x47;
                return is_ts_sync && !has_ftyp;
            }
        }
    }
    false
}

/// Losslessly remuxes a video file (e.g. MPEG-TS stream dump from HLS) into a faststart MP4 container
/// so HTML5 WebView2 and built-in media players can play and seek immediately without errors.
pub fn remux_to_faststart_mp4(input_path: &Path, ffmpeg_path: Option<&Path>) -> Result<PathBuf, String> {
    if !input_path.exists() || !input_path.is_file() {
        return Err("Input file does not exist".to_string());
    }

    let ff_bin = match ffmpeg_path {
        Some(ff) => if ff.is_dir() { ff.join("ffmpeg") } else { ff.to_path_buf() },
        None => match crate::binaries::find_binary("ffmpeg") {
            Some(p) => p,
            None => return Ok(input_path.to_path_buf()),
        },
    };

    let parent = input_path.parent().unwrap_or(Path::new("."));
    let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("live_recording");
    let temp_remuxed = parent.join(format!("{}.faststart_tmp.mp4", stem));

    let mut cmd = Command::new(&ff_bin);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .args(["-y", "-nostdin", "-fflags", "+genpts+igndts", "-avoid_negative_ts", "make_zero"])
        .arg("-i")
        .arg(input_path)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&temp_remuxed);

    let status = match cmd.status() {
        Ok(s) => s,
        Err(_) => return Ok(input_path.to_path_buf()),
    };

    if status.success() && temp_remuxed.exists() {
        if let Ok(meta) = std::fs::metadata(&temp_remuxed) {
            if meta.len() > 0 {
                // Retry loop for Windows file lock release
                for _ in 0..5 {
                    if std::fs::remove_file(input_path).is_ok() {
                        if std::fs::rename(&temp_remuxed, input_path).is_ok() {
                            return Ok(input_path.to_path_buf());
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(60));
                }
            }
        }
    }

    let _ = std::fs::remove_file(&temp_remuxed);
    Ok(input_path.to_path_buf())
}

/// Probes the exact media duration in seconds of a file on disk using ffprobe
pub fn probe_media_duration(file_path: &Path) -> Option<f64> {
    if !file_path.exists() || !file_path.is_file() {
        return None;
    }
    let ffprobe_bin = crate::binaries::find_binary("ffprobe").or_else(|| {
        crate::binaries::find_binary("ffmpeg").map(|p| {
            if p.is_dir() {
                p.join("ffprobe")
            } else {
                p.parent().unwrap_or(Path::new("")).join("ffprobe")
            }
        })
    })?;

    let mut cmd = Command::new(ffprobe_bin);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(file_path);

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    stdout_str.trim().parse::<f64>().ok().filter(|&d| d > 0.0)
}

/// Formats seconds into human-readable HH:MM:SS or MM:SS
pub fn format_seconds_to_hms(secs: f64) -> String {
    let s = secs.max(0.0).floor() as u64;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{:02}:{:02}", m, sec)
    }
}

/// Remuxes or finalizes `.part` live stream recordings when stopped by user ("Stop & Save")
/// or when a live stream ends with unmerged `.part` files on disk.
pub fn finalize_live_recording_artifacts(
    out_dir: &Path,
    task_stem: &str,
    ffmpeg_path: Option<&Path>,
) -> Option<PathBuf> {
    if !out_dir.exists() || !out_dir.is_dir() {
        return None;
    }

    // Brief sleep to let any terminated process release file descriptors on Windows
    std::thread::sleep(std::time::Duration::from_millis(200));

    let clean_stem = sanitize_filename(task_stem);
    let target_mp4 = out_dir.join(format!("{}.mp4", clean_stem));

    let mut video_parts: Vec<PathBuf> = Vec::new();
    let mut audio_parts: Vec<PathBuf> = Vec::new();
    let mut frag_debris: Vec<PathBuf> = Vec::new();

    let prefix_match: String = clean_stem.chars().take(24).collect();

    if let Ok(entries) = std::fs::read_dir(out_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let name_matches = clean_stem.is_empty()
                || name.contains(&clean_stem)
                || (!prefix_match.is_empty() && name.contains(&prefix_match));
            if !name_matches {
                continue;
            }
            let lower = name.to_lowercase();
            if lower.contains(".part-frag") {
                frag_debris.push(p);
                continue;
            }
            if lower.ends_with(".live_chat.json.part") || lower.ends_with(".ytdl") {
                continue;
            }
            if lower.ends_with(".part") {
                let is_audio = lower.contains(".f140.")
                    || lower.contains(".f251.")
                    || lower.contains(".f250.")
                    || lower.contains(".f249.")
                    || lower.contains(".f139.")
                    || lower.contains(".f233.")
                    || lower.contains(".f234.")
                    || lower.contains(".ba.")
                    || lower.contains(".m4a")
                    || lower.contains(".aac")
                    || lower.contains(".opus")
                    || lower.contains(".mp3")
                    || lower.contains(".audio");
                if is_audio {
                    audio_parts.push(p);
                } else {
                    video_parts.push(p);
                }
            }
        }
    }

    // If no part files exist, check if target_mp4 was already created and valid
    if video_parts.is_empty() && audio_parts.is_empty() {
        if target_mp4.exists() && std::fs::metadata(&target_mp4).map(|m| m.len() > 0).unwrap_or(false) {
            if is_mpegts_file(&target_mp4) {
                let _ = remux_to_faststart_mp4(&target_mp4, ffmpeg_path);
            }
            return Some(target_mp4);
        }
        return None;
    }

    // Sort by file size descending so the primary stream is first
    video_parts.sort_by(|a, b| {
        let len_b = std::fs::metadata(b).map(|m| m.len()).unwrap_or(0);
        let len_a = std::fs::metadata(a).map(|m| m.len()).unwrap_or(0);
        len_b.cmp(&len_a)
    });
    audio_parts.sort_by(|a, b| {
        let len_b = std::fs::metadata(b).map(|m| m.len()).unwrap_or(0);
        let len_a = std::fs::metadata(a).map(|m| m.len()).unwrap_or(0);
        len_b.cmp(&len_a)
    });

    for frag in frag_debris {
        let _ = std::fs::remove_file(frag);
    }

    if video_parts.is_empty() && audio_parts.is_empty() {
        return None;
    }

    if let Some(ff) = ffmpeg_path {
        let ff_bin = if ff.is_dir() { ff.join("ffmpeg") } else { ff.to_path_buf() };
        if let (Some(v_part), Some(a_part)) = (video_parts.first(), audio_parts.first()) {
            let mut cmd = Command::new(&ff_bin);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .args(["-nostdin", "-y", "-fflags", "+genpts+igndts", "-avoid_negative_ts", "make_zero"])
                .arg("-i")
                .arg(v_part)
                .arg("-i")
                .arg(a_part)
                .args(["-c", "copy", "-movflags", "+faststart"])
                .arg(&target_mp4);
            let _ = cmd.output();
        } else if let Some(v_part) = video_parts.first() {
            let mut cmd = Command::new(&ff_bin);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .args(["-nostdin", "-y", "-fflags", "+genpts+igndts", "-avoid_negative_ts", "make_zero"])
                .arg("-i")
                .arg(v_part)
                .args(["-c", "copy", "-movflags", "+faststart"])
                .arg(&target_mp4);
            let _ = cmd.output();
        }
    }

    // Fallback: if ffmpeg was unavailable or copy failed, rename the primary video .part directly
    if !target_mp4.exists() || std::fs::metadata(&target_mp4).map(|m| m.len() == 0).unwrap_or(true) {
        if let Some(v_part) = video_parts.first() {
            if std::fs::metadata(v_part).map(|m| m.len() > 0).unwrap_or(false) {
                for _ in 0..5 {
                    if std::fs::rename(v_part, &target_mp4).is_ok() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    }

    if target_mp4.exists() && std::fs::metadata(&target_mp4).map(|m| m.len() > 0).unwrap_or(false) {
        if is_mpegts_file(&target_mp4) {
            let _ = remux_to_faststart_mp4(&target_mp4, ffmpeg_path);
        }
        for vp in video_parts {
            let _ = std::fs::remove_file(vp);
        }
        for ap in audio_parts {
            let _ = std::fs::remove_file(ap);
        }
        Some(target_mp4)
    } else {
        None
    }
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
    media_items: Option<Vec<MediaItem>>,
    live_config: Option<LiveStreamConfig>,
) -> Result<(), String> {
    let out_dir = match output_folder {
        Some(ref f) if !f.trim().is_empty() => PathBuf::from(f),
        _ => get_default_download_dir(),
    };
    let _ = std::fs::create_dir_all(&out_dir);
    sweep_orphaned_temp_files(&out_dir);

    let _ = db.log_event(
        &task_id,
        "INFO",
        "DOWNLOAD",
        &format!("Initiating download: {} (format: {}, quality: {})", url, format_type, quality),
        None,
    );

    let is_threads = crate::image_extractor::is_threads_url(&url);

    // 0. Direct Multi-Media / MediaBundle Interceptor (e.g. Threads multi-video carousel, mixed albums)
    if let Some(ref items) = media_items {
        if !items.is_empty() && (items.len() > 1 || is_threads) {
            let platform_name = if is_threads {
                "threads"
            } else if url.contains("instagram.com") {
                "instagram"
            } else {
                "media"
            };

            let bundle = crate::image_extractor::create_media_bundle_from_items(
                &task_id,
                &url,
                title.as_deref().unwrap_or("media"),
                platform_name,
                author.as_deref().unwrap_or("creator"),
                items,
            );

            crate::image_extractor::download_media_bundle(
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
    }

    // 1. Direct Image Extraction Interceptor
    if format_type == "image" {
        let platform_name = if is_threads {
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

    // Resolve direct download URL and metadata for platforms that require extraction preprocessing (Threads)
    let mut download_url = url.clone();
    let mut resolved_title = title.clone();
    let mut resolved_author = author.clone();
    let mut resolved_thumbnail = thumbnail_url.clone();
    let mut resolved_duration = duration_sec;

    if is_threads {
        if let Ok(vinfo) = crate::image_extractor::extract_threads_post(&url).await {
            // If Threads post contains multiple media items (e.g. 3 videos), download directly as MediaBundle
            if let Some(ref items) = vinfo.media_items {
                if !items.is_empty() {
                    let bundle = crate::image_extractor::create_media_bundle_from_items(
                        &task_id,
                        &url,
                        vinfo.title.as_str(),
                        "threads",
                        vinfo.uploader.as_str(),
                        items,
                    );
                    crate::image_extractor::download_media_bundle(
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
            }

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

    // Detect platform early for filename formatting and initial record
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

    // Read AppSettings for video filename format preference ($author_name-$media_title by default)
    let settings = db.get_settings().unwrap_or_default();
    let has_explicit_custom_name = custom_name
        .as_deref()
        .map(|n| !n.trim().is_empty())
        .unwrap_or(false);

    let default_ext = match format_type.as_str() {
        "audio" => match quality.to_lowercase().as_str() {
            "m4a" => "m4a",
            "wav" => "wav",
            "flac" => "flac",
            _ => "mp3",
        },
        "subtitle" => "srt",
        "image" => "jpg",
        _ => "mp4",
    };

    let effective_author_or_source = resolve_author_or_source(
        resolved_author.as_deref(),
        None,
        platform,
        &url,
    );

    let is_fallback = resolved_title
        .as_deref()
        .map(is_fallback_title)
        .unwrap_or(true);

    let task_stem = if has_explicit_custom_name {
        let raw_custom = custom_name.as_deref().unwrap_or("").trim();
        let stripped = strip_media_extension(raw_custom);
        let clean = sanitize_filename(stripped);
        build_video_stem(
            Some(&effective_author_or_source),
            &clean,
            &settings.video_filename_format,
        )
    } else {
        let raw_title_stem = if crate::image_extractor::is_threads_url(&url) {
            resolved_title.as_deref().unwrap_or("threads_video").to_string()
        } else if !is_fallback {
            resolved_title.as_deref().unwrap_or("media").to_string()
        } else {
            get_fallback_media_title(&url, Some(&effective_author_or_source))
        };

        build_video_stem(
            Some(&effective_author_or_source),
            &raw_title_stem,
            &settings.video_filename_format,
        )
    };

    // Suffix unik ditambahkan SETELAH truncation 80 karakter agar tidak terpotong, dan selalu
    // diterapkan (judul live seperti "[LIVE] ..." tidak boleh membuat suffix dilewati).
    let task_stem = match live_config.as_ref() {
        Some(lcfg) => append_live_recording_suffix(&task_stem, lcfg, chrono::Local::now()),
        None => task_stem,
    };

    // When title is a generic fallback and user hasn't provided a custom name,
    // let yt-dlp generate the filename dynamically using actual post metadata
    let is_live_recording = live_config.is_some();
    let live_mode = live_config.as_ref().map(|c| c.mode.clone());
    let is_live_opt_flag = if is_live_recording { Some(true) } else { None };
    let target_live_duration_sec: Option<f64> = live_config.as_ref().and_then(|cfg| {
        if cfg.mode == "record_from_now" {
            cfg.duration_sec.filter(|&d| d > 0).map(|d| d as f64)
        } else if cfg.mode == "capture_time_range" {
            cfg.time_range.as_ref().and_then(|tr| {
                let s = parse_hhmmss_to_secs(&tr.start)?;
                let e = parse_hhmmss_to_secs(&tr.end)?;
                if e > s { Some(e - s) } else { None }
            })
        } else {
            None
        }
    });
    process_mgr.unmark_stopped_live(&task_id);

    let out_template = if is_fallback && !has_explicit_custom_name && !is_live_recording {
        let pattern = if platform == "tiktok" {
            "%(description|title).80s-%(channel|uploader)s.%(ext)s"
        } else if platform == "youtube" {
            "%(title).80s-%(uploader|channel)s.%(ext)s"
        } else {
            "%(title).80s-%(uploader|creator|channel)s.%(ext)s"
        };
        format!(
            "{}/{}",
            escape_ytdlp_template(&out_dir.to_string_lossy()),
            pattern
        )
    } else {
        format!(
            "{}.%(ext)s",
            escape_ytdlp_template(&out_dir.join(&task_stem).to_string_lossy())
        )
    };

    // Initial output filename with extension strictly matching convention: $file_name-$author/channel/source_name.$format
    let initial_file_name = format!("{}.{}", task_stem, default_ext);

    let mut rec_thumb = resolved_thumbnail.unwrap_or_default();
    let mut rec_duration = resolved_duration.unwrap_or(0);

    // Fallback: extract YouTube thumbnail directly from video ID if empty
    if rec_thumb.is_empty() {
        if let Some(yt_id) = extract_youtube_id(&url) {
            rec_thumb = format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", yt_id);
        }
    }

    // Initial record in DB (Only insert for non-live downloads;
    // live stream recordings only enter Media Vault history once stopped and saved!)
    let initial_record = DownloadRecord {
        id: task_id.clone(),
        platform: platform.to_string(),
        url: url.clone(),
        title: initial_file_name.clone(),
        author: effective_author_or_source.clone(),
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
    if !is_live_recording {
        let _ = db.add_record(&initial_record);
    }

    // Emit initial active task progress immediately so UI does not remain stuck on "Connecting..."
    let startup_speed_msg = if is_live_recording {
        if live_config.as_ref().map(|c| c.wait_for_stream).unwrap_or(false) {
            "Waiting for live stream...".to_string()
        } else {
            "Connecting to live stream...".to_string()
        }
    } else {
        "Starting engine...".to_string()
    };
    process_mgr.append_log(&task_id, &format!("Engine starting for '{}' [{}]", initial_record.title, quality));
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
            speed_str: startup_speed_msg,
            eta_str: if is_live_recording { "LIVE".to_string() } else { String::new() },
            downloaded_bytes: None,
            total_bytes: None,
            downloaded_duration_sec: None,
        },
        error: None,
        is_live_recording: is_live_opt_flag,
        live_mode: live_mode.clone(),
        current_step: Some(if is_live_recording { "Connecting to live stream...".to_string() } else { "Starting download engine...".to_string() }),
        recent_logs: Some(process_mgr.get_logs(&task_id)),
    };
    process_mgr.update_active_task_snapshot(&startup_task);
    let _ = app.emit("download-progress", &startup_task);

    let meta_file_path = std::env::temp_dir().join(format!("xdownloader_{}.meta", task_id));

    // Execution loop supporting transparent single retry for transient cold YouTube 403 / CDN handshake errors
    for attempt in 0..2 {
        if db.is_task_cancelled(&task_id) {
            cleanup_task_artifacts(&out_dir, Some(&task_stem));
            return Err("Download cancelled by user".to_string());
        }

        if db.is_task_paused(&task_id) || process_mgr.is_paused(&task_id) {
            let _ = db.log_event(&task_id, "INFO", "DOWNLOAD", "Download paused by user", None);
            return Ok(());
        }

        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            if db.is_task_cancelled(&task_id) {
                cleanup_task_artifacts(&out_dir, Some(&task_stem));
                return Err("Download cancelled by user".to_string());
            }

            if db.is_task_paused(&task_id) || process_mgr.is_paused(&task_id) {
                let _ = db.log_event(&task_id, "INFO", "DOWNLOAD", "Download paused by user", None);
                return Ok(());
            }

            let _ = db.log_event(
                &task_id,
                "WARN",
                "DOWNLOAD",
                &format!("Transient error encountered on initial run. Retrying with warm session (attempt {})...", attempt + 1),
                None,
            );

            process_mgr.append_log(&task_id, &format!("Re-establishing connection (attempt {})...", attempt + 1));
            let retry_task = ActiveDownloadTask {
                task_id: task_id.clone(),
                url: url.clone(),
                title: initial_record.title.clone(),
                platform: initial_record.platform.clone(),
                format_type: format_type.clone(),
                quality: quality.clone(),
                status: "downloading".to_string(),
                progress: TaskProgress {
                    percent: 1.0,
                    speed_str: "Retrying connection...".to_string(),
                    eta_str: String::new(),
                    downloaded_bytes: None,
                    total_bytes: None,
                    downloaded_duration_sec: None,
                },
                error: None,
                is_live_recording: is_live_opt_flag,
                live_mode: live_mode.clone(),
                current_step: Some(format!("Retrying connection (attempt {})...", attempt + 1)),
                recent_logs: Some(process_mgr.get_logs(&task_id)),
            };
            let _ = app.emit("download-progress", &retry_task);
        }

        let mut cmd = tokio::process::Command::new(&ytdlp_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.current_dir(&out_dir);
        cmd.arg("--newline")
            .arg("--no-playlist")
            .arg("--no-warnings")
            .arg("-o")
            .arg(&out_template)
            .arg("--print-to-file")
            .arg("after_move:filepath")
            .arg(&meta_file_path);

        // Pass detected JavaScript runtime (Node/Bun/Deno) to solve YouTube extraction challenges without delay
        if let Some((runtime, path)) = crate::binaries::find_js_runtime() {
            cmd.arg("--js-runtimes").arg(format!("{}:{}", runtime, path.to_string_lossy()));
        }

        // Multi-client fallback for YouTube VODs: bypasses SABR PO Token 403s on cold initial runs.
        // For live stream recordings, keep default web/mweb clients so --live-from-start and live_chat subtitles work properly.
        if !is_live_recording && (url.contains("youtube.com") || url.contains("youtu.be")) {
            if attempt == 0 {
                cmd.arg("--extractor-args").arg("youtube:player_client=default,ios,mweb");
            } else {
                cmd.arg("--extractor-args").arg("youtube:player_client=ios,mweb,web");
            }
        }

        // High throughput connection optimizations: multi-fragment concurrent downloads (2x - 5x faster)
        cmd.arg("--concurrent-fragments").arg("4")
            .arg("--socket-timeout").arg("30")
            .arg("--buffer-size").arg("256K")
            .arg("--no-mtime")
            .arg("--http-chunk-size").arg("10M");

        if !live_config.as_ref().map(|c| c.auto_reconnect).unwrap_or(false) {
            cmd.arg("--retries").arg("10")
                .arg("--fragment-retries").arg("10");
        }

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

        // Quality, format, and live stream recording args
        if let Some(ref lcfg) = live_config {
            let live_args = build_live_ytdlp_args(lcfg, &quality);
            cmd.args(&live_args);
        } else if format_type == "audio" {
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
            if platform == "tiktok" {
                // TikTok Audio: Prioritize extracting audio directly from the pre-muxed video stream so that creator voice/speech is preserved rather than downloading isolated catalog music
                cmd.arg("-f").arg("best[acodec!=none]/bestaudio/best");
            } else {
                // Prefer stable HTTPS direct streams with format fallback chain to prevent HTTP 403 SABR lockouts
                cmd.arg("-f").arg("bestaudio[protocol^=http][ext=m4a]/bestaudio[protocol^=http]/bestaudio/best");
                cmd.arg("-S").arg("proto:https,ext:m4a:webm");
            }
        } else if platform == "tiktok" {
            // TikTok Video: Prioritize pre-muxed containers with audio (h264/avc) to prevent yt-dlp from selecting audio-less bytevc1 (HEVC) streams and merging with raw catalog music (which wipes creator voiceover and makes music loud)
            match quality.as_str() {
                "1080p" => {
                    cmd.arg("-f").arg("bv*[height<=1080][acodec!=none][vcodec^=avc]/bv*[height<=1080][acodec!=none]/b[height<=1080]/best[height<=1080]/bv*[acodec!=none]/best/bestvideo+bestaudio");
                    cmd.arg("-S").arg("res:1080,fps,proto:https,ext:mp4:m4a");
                }
                "720p" => {
                    cmd.arg("-f").arg("bv*[height<=720][acodec!=none][vcodec^=avc]/bv*[height<=720][acodec!=none]/b[height<=720]/best[height<=720]/bv*[acodec!=none]/best/bestvideo+bestaudio");
                    cmd.arg("-S").arg("res:720,fps,proto:https,ext:mp4:m4a");
                }
                "480p" => {
                    cmd.arg("-f").arg("bv*[height<=480][acodec!=none][vcodec^=avc]/bv*[height<=480][acodec!=none]/b[height<=480]/best[height<=480]/bv*[acodec!=none]/best/bestvideo+bestaudio");
                    cmd.arg("-S").arg("res:480,fps,proto:https,ext:mp4:m4a");
                }
                "360p" => {
                    cmd.arg("-f").arg("bv*[height<=360][acodec!=none][vcodec^=avc]/bv*[height<=360][acodec!=none]/b[height<=360]/best[height<=360]/bv*[acodec!=none]/best/bestvideo+bestaudio");
                    cmd.arg("-S").arg("res:360,fps,proto:https,ext:mp4:m4a");
                }
                _ => {
                    // "best" / Original HD: prioritize pre-muxed container with audio
                    cmd.arg("-f").arg("bv*[acodec!=none][vcodec^=avc]/bv*[acodec!=none]/b/best/bestvideo+bestaudio");
                    cmd.arg("-S").arg("res,fps,proto:https,ext:mp4:m4a");
                }
            }
            cmd.arg("--merge-output-format").arg("mp4");
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
                "360p" => {
                    cmd.arg("-f").arg("bestvideo[height<=360][protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[height<=360][protocol^=http]+bestaudio[protocol^=http]/bestvideo[height<=360]+bestaudio/best");
                    cmd.arg("-S").arg("res:360,fps,proto:https,ext:mp4:m4a");
                }
                _ => {
                    // "best" / Original HD: Download top native resolution without artificial cap, prioritizing direct HTTPS DASH streams
                    cmd.arg("-f").arg("bestvideo[protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[protocol^=http]+bestaudio[protocol^=http]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best");
                    cmd.arg("-S").arg("res,fps,proto:https,ext:mp4:m4a");
                }
            }
            cmd.arg("--merge-output-format").arg("mp4");
        }

        // Standard VOD subtitles & time-range slicing when not in specialized live recording mode
        if !is_live_recording {
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
                    cmd.arg("--download-sections").arg(format!("*{}-{}", start, end));
                    cmd.arg("--force-keyframes-at-cuts");
                }
            }
        }

        cmd.arg(&download_url);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                if attempt == 0 {
                    continue;
                }
                return Err(format!("Failed to spawn yt-dlp: {}", e));
            }
        };

        let pid = child.id().unwrap_or(0);
        process_mgr.register(task_id.clone(), pid, out_dir.clone(), task_stem.clone());

        // Optional duration auto-stop watchdog for "record_from_now" when duration_sec > 0
        let duration_watchdog = if let Some(ref lcfg) = live_config {
            if lcfg.mode == "record_from_now" {
                if let Some(dur) = lcfg.duration_sec.filter(|&d| d > 0) {
                    let pm_clone = process_mgr.clone();
                    let tid_clone = task_id.clone();
                    Some(tokio::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs((dur as u64) + 3)).await;
                        let _ = pm_clone.stop_live(&tid_clone);
                    }))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        let stdout = child.stdout.take().ok_or("Failed to capture child stdout")?;
        let stderr = child.stderr.take();

        let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let stderr_lines_clone = stderr_lines.clone();

        let stderr_app = app.clone();
        let stderr_pm = process_mgr.clone();
        let stderr_tid = task_id.clone();
        let stderr_url = url.clone();
        let stderr_title = initial_record.title.clone();
        let stderr_platform = initial_record.platform.clone();
        let stderr_fmt = format_type.clone();
        let stderr_qual = quality.clone();
        let stderr_live_flag = is_live_opt_flag;
        let stderr_live_mode = live_mode.clone();
        let stderr_target_dur = target_live_duration_sec;

        // Drain stderr in background tokio task (splitting on both \r and \n to capture real-time ffmpeg live progress)
        let stderr_task = tokio::spawn(async move {
            if let Some(mut err_stream) = stderr {
                use tokio::io::AsyncReadExt;
                let mut buf = [0u8; 2048];
                let mut pending = String::new();
                let mut last_emit = std::time::Instant::now() - std::time::Duration::from_millis(250);

                while let Ok(n) = err_stream.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                    while let Some(pos) = pending.find(|c| c == '\r' || c == '\n') {
                        let segment: String = pending.drain(..pos).collect();
                        pending.drain(..1);
                        let trimmed = segment.trim().to_string();
                        if trimmed.is_empty() {
                            continue;
                        }

                        if let Some(caps) = RE_FFMPEG_PROGRESS.captures(&trimmed) {
                            if last_emit.elapsed() >= std::time::Duration::from_millis(250) {
                                last_emit = std::time::Instant::now();
                                let size_str = caps[1].trim();
                                let time_str = caps[2].trim();
                                let bitrate_str = caps[3].trim();
                                let downloaded_bytes = parse_size_to_bytes(size_str);
                                let elapsed_secs = parse_hhmmss_to_secs(time_str).unwrap_or(0.0);
                                let percent = if let Some(target_s) = stderr_target_dur {
                                    ((elapsed_secs / target_s) * 100.0).clamp(1.0, 99.0)
                                } else {
                                    50.0
                                };
                                let clean_time = time_str.split('.').next().unwrap_or(time_str);
                                let task_update = ActiveDownloadTask {
                                    task_id: stderr_tid.clone(),
                                    url: stderr_url.clone(),
                                    title: stderr_title.clone(),
                                    platform: stderr_platform.clone(),
                                    format_type: stderr_fmt.clone(),
                                    quality: stderr_qual.clone(),
                                    status: "downloading".to_string(),
                                    progress: TaskProgress {
                                        percent,
                                        speed_str: format!("{} • {}", size_str, bitrate_str),
                                        eta_str: format!("REC {}", clean_time),
                                        downloaded_bytes,
                                        total_bytes: None,
                                        downloaded_duration_sec: Some(elapsed_secs),
                                    },
                                    error: None,
                                    is_live_recording: stderr_live_flag,
                                    live_mode: stderr_live_mode.clone(),
                                    current_step: Some(format!("Recording stream chunks ({} • {})", size_str, clean_time)),
                                    recent_logs: Some(stderr_pm.get_logs(&stderr_tid)),
                                };
                                stderr_pm.update_active_task_snapshot(&task_update);
                                let _ = stderr_app.emit("download-progress", &task_update);
                            }
                        } else if let Ok(mut lock) = stderr_lines_clone.lock() {
                            stderr_pm.append_log(&stderr_tid, &trimmed);
                            if lock.len() >= 50 {
                                lock.remove(0);
                            }
                            lock.push(trimmed);
                        }
                    }
                }
                let final_trimmed = pending.trim().to_string();
                if !final_trimmed.is_empty() {
                    if let Ok(mut lock) = stderr_lines_clone.lock() {
                        if lock.len() >= 50 {
                            lock.remove(0);
                        }
                        lock.push(final_trimmed);
                    }
                }
            }
        });

        use tokio::io::AsyncBufReadExt;
        let mut reader = tokio::io::BufReader::new(stdout).lines();
        let mut downloaded_path = String::new();
        let mut current_title = initial_record.title.clone();
        let mut last_progress_emit = std::time::Instant::now() - std::time::Duration::from_millis(200);

        while let Ok(Some(line)) = reader.next_line().await {
            let mut path_detected = false;
            if let Some(caps) = RE_MERGER.captures(&line) {
                downloaded_path = caps["path"].trim().to_string();
                path_detected = true;
            } else if let Some(caps) = RE_DESTINATION.captures(&line) {
                let candidate = caps[1].trim().to_string();
                if !candidate.ends_with(".live_chat.json") {
                    downloaded_path = candidate;
                    path_detected = true;
                }
            } else if let Some(caps) = RE_ALREADY_DOWNLOADED.captures(&line) {
                downloaded_path = caps[1].trim().to_string();
                path_detected = true;
            }

            if path_detected && !downloaded_path.is_empty() {
                let candidate_name = Path::new(&downloaded_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let clean_name = clean_download_filename(candidate_name, &default_ext);
                if !clean_name.is_empty() && clean_name != current_title && !is_fallback_title(&clean_name) {
                    current_title = clean_name.clone();
                    let _ = db.update_record_title(&task_id, &current_title);
                    if let Some(inferred_author) = extract_author_from_filename(&current_title) {
                        if effective_author_or_source.is_empty()
                            || effective_author_or_source.eq_ignore_ascii_case("youtube")
                            || effective_author_or_source.eq_ignore_ascii_case("tiktok")
                            || effective_author_or_source.eq_ignore_ascii_case("web_media")
                        {
                            let _ = db.update_record_author(&task_id, &inferred_author);
                        }
                    }
                }
            }

            let clean_line = line.trim();
            if !clean_line.is_empty() {
                process_mgr.append_log(&task_id, clean_line);
            }

            if let Some(caps) = RE_PROGRESS.captures(&line) {
                let percent: f64 = caps[1].parse().unwrap_or(0.0);
                let speed_str = caps[3].to_string();
                let eta_str = caps[4].to_string();

                let should_emit = percent <= 0.0 || percent >= 100.0 || last_progress_emit.elapsed() >= std::time::Duration::from_millis(200);
                if should_emit {
                    last_progress_emit = std::time::Instant::now();
                    let task_update = ActiveDownloadTask {
                        task_id: task_id.clone(),
                        url: url.clone(),
                        title: current_title.clone(),
                        platform: initial_record.platform.clone(),
                        format_type: format_type.clone(),
                        quality: quality.clone(),
                        status: "downloading".to_string(),
                        progress: TaskProgress {
                            percent,
                            speed_str: speed_str.clone(),
                            eta_str,
                            downloaded_bytes: None,
                            total_bytes: None,
                            downloaded_duration_sec: None,
                        },
                        error: None,
                        is_live_recording: is_live_opt_flag,
                        live_mode: live_mode.clone(),
                        current_step: Some(format!("Downloading ({}% • {})", percent.round(), speed_str)),
                        recent_logs: Some(process_mgr.get_logs(&task_id)),
                    };

                    process_mgr.update_active_task_snapshot(&task_update);
                    let _ = app.emit("download-progress", &task_update);
                }
            } else if let Some(caps) = RE_LIVE_PROGRESS.captures(&line) {
                if last_progress_emit.elapsed() >= std::time::Duration::from_millis(200) {
                    last_progress_emit = std::time::Instant::now();
                    let size_str = caps[1].trim();
                    let speed_raw = caps[2].trim();
                    let elapsed_str = caps.get(3).map(|m| m.as_str().trim()).unwrap_or("00:00");
                    let frag_match = caps.get(4).map(|m| m.as_str());
                    let frag_str = frag_match.map(|f| format!("Frag #{}", f)).unwrap_or_default();
                    let downloaded_bytes = parse_size_to_bytes(size_str);
                    let mut elapsed_secs = parse_hhmmss_to_secs(elapsed_str).unwrap_or(0.0);
                    if elapsed_secs <= 0.0 {
                        if let Some(f_str) = frag_match {
                            let f_num = f_str.split('/').next().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                            if f_num > 0.0 {
                                elapsed_secs = f_num * 5.0;
                            }
                        }
                    }
                    let percent = if let Some(target_s) = target_live_duration_sec {
                        ((elapsed_secs / target_s) * 100.0).clamp(1.0, 99.0)
                    } else {
                        50.0
                    };
                    let clean_time = format_seconds_to_hms(elapsed_secs);
                    let eta_str = if frag_str.is_empty() {
                        format!("REC {}", clean_time)
                    } else {
                        format!("REC {} • {}", clean_time, frag_str)
                    };
                    let task_update = ActiveDownloadTask {
                        task_id: task_id.clone(),
                        url: url.clone(),
                        title: current_title.clone(),
                        platform: initial_record.platform.clone(),
                        format_type: format_type.clone(),
                        quality: quality.clone(),
                        status: "downloading".to_string(),
                        progress: TaskProgress {
                            percent,
                            speed_str: format!("{} ({})", speed_raw, size_str),
                            eta_str: eta_str.clone(),
                            downloaded_bytes,
                            total_bytes: None,
                            downloaded_duration_sec: Some(elapsed_secs),
                        },
                        error: None,
                        is_live_recording: Some(true),
                        live_mode: live_mode.clone(),
                        current_step: Some(format!("Capturing live stream ({})", eta_str)),
                        recent_logs: Some(process_mgr.get_logs(&task_id)),
                    };
                    process_mgr.update_active_task_snapshot(&task_update);
                    let _ = app.emit("download-progress", &task_update);
                }
            } else if RE_WAIT_STREAM.is_match(&line) {
                let wait_task = ActiveDownloadTask {
                    task_id: task_id.clone(),
                    url: url.clone(),
                    title: current_title.clone(),
                    platform: initial_record.platform.clone(),
                    format_type: format_type.clone(),
                    quality: quality.clone(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent: 2.0,
                        speed_str: "Waiting for stream to go live...".to_string(),
                        eta_str: "Polling...".to_string(),
                        downloaded_bytes: None,
                        total_bytes: None,
                        downloaded_duration_sec: None,
                    },
                    error: None,
                    is_live_recording: Some(true),
                    live_mode: live_mode.clone(),
                    current_step: Some("Waiting for broadcast to go live...".to_string()),
                    recent_logs: Some(process_mgr.get_logs(&task_id)),
                };
                process_mgr.update_active_task_snapshot(&wait_task);
                let _ = app.emit("download-progress", &wait_task);
            } else if let Some(caps) = RE_PROGRESS_SIMPLE.captures(&line) {
                let percent: f64 = caps[1].parse().unwrap_or(0.0);
                let should_emit = percent <= 0.0 || percent >= 100.0 || last_progress_emit.elapsed() >= std::time::Duration::from_millis(200);
                if should_emit {
                    last_progress_emit = std::time::Instant::now();
                    let task_update = ActiveDownloadTask {
                        task_id: task_id.clone(),
                        url: url.clone(),
                        title: current_title.clone(),
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
                            downloaded_duration_sec: None,
                        },
                        error: None,
                        is_live_recording: is_live_opt_flag,
                        live_mode: live_mode.clone(),
                        current_step: Some(format!("Downloading ({:.0}%)", percent)),
                        recent_logs: Some(process_mgr.get_logs(&task_id)),
                    };
                    process_mgr.update_active_task_snapshot(&task_update);
                    let _ = app.emit("download-progress", &task_update);
                }
            }

            if let Some(_caps) = RE_DESTINATION.captures(&line) {
                let receiving_task = ActiveDownloadTask {
                    task_id: task_id.clone(),
                    url: url.clone(),
                    title: current_title.clone(),
                    platform: initial_record.platform.clone(),
                    format_type: format_type.clone(),
                    quality: quality.clone(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent: 1.0,
                        speed_str: if is_live_recording { "Capturing live stream...".to_string() } else { "Receiving stream...".to_string() },
                        eta_str: if is_live_recording { "LIVE".to_string() } else { String::new() },
                        downloaded_bytes: None,
                        total_bytes: None,
                        downloaded_duration_sec: None,
                    },
                    error: None,
                    is_live_recording: is_live_opt_flag,
                    live_mode: live_mode.clone(),
                    current_step: Some(if is_live_recording { "Initializing live stream capture...".to_string() } else { "Receiving stream...".to_string() }),
                    recent_logs: Some(process_mgr.get_logs(&task_id)),
                };
                process_mgr.update_active_task_snapshot(&receiving_task);
                let _ = app.emit("download-progress", &receiving_task);
            }
        }

        let status = child.wait().await.map_err(|e| format!("Process wait failed: {}", e))?;
        if let Some(watchdog) = duration_watchdog {
            watchdog.abort();
        }
        let _ = stderr_task.await;
        process_mgr.remove(&task_id);

        if db.is_task_cancelled(&task_id) {
            process_mgr.unmark_stopped_live(&task_id);
            cleanup_task_artifacts(&out_dir, Some(&task_stem));
            return Err("Download cancelled by user".to_string());
        }

        if db.is_task_paused(&task_id) || process_mgr.is_paused(&task_id) {
            let _ = db.log_event(&task_id, "INFO", "DOWNLOAD", "Download process paused by user", None);
            return Ok(());
        }

        let stopped_live_by_user = process_mgr.is_stopped_live(&task_id);

        if status.success() || stopped_live_by_user {
            process_mgr.unmark_stopped_live(&task_id);

            if is_live_recording {
                let finalizing_task = ActiveDownloadTask {
                    task_id: task_id.clone(),
                    url: url.clone(),
                    title: current_title.clone(),
                    platform: initial_record.platform.clone(),
                    format_type: format_type.clone(),
                    quality: quality.clone(),
                    status: "downloading".to_string(),
                    progress: TaskProgress {
                        percent: 99.0,
                        speed_str: "Finalizing MP4 & Chat...".to_string(),
                        eta_str: "Saving".to_string(),
                        downloaded_bytes: None,
                        total_bytes: None,
                        downloaded_duration_sec: None,
                    },
                    error: None,
                    is_live_recording: Some(true),
                    live_mode: live_mode.clone(),
                    current_step: Some("Finalizing MP4 & Chat artifacts...".to_string()),
                    recent_logs: Some(process_mgr.get_logs(&task_id)),
                };
                process_mgr.update_active_task_snapshot(&finalizing_task);
                let _ = app.emit("download-progress", &finalizing_task);
            }

            // Convert .live_chat.json to .live_chat.srt when chat replay was requested
            let mut generated_chat_srt: Option<PathBuf> = None;
            if live_config.as_ref().map(|c| c.download_chat || c.mode == "chat_replay").unwrap_or(false) {
                generated_chat_srt = convert_live_chat_json_to_srt(&out_dir, &task_stem);
            }

            // 1. Authoritative resolution: read exact path written by yt-dlp --print-to-file
            if meta_file_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&meta_file_path) {
                    for line in content.lines() {
                        let candidate = line.trim();
                        if !candidate.is_empty() {
                            let pb = PathBuf::from(candidate);
                            if pb.exists() && pb.is_file() {
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
                    if relative_candidate.exists() && relative_candidate.is_file() {
                        downloaded_path = relative_candidate.to_string_lossy().to_string();
                    }
                }
            }

            // 2b. Live recording finalizer: if stopped early by user ("Stop & Save") or .part files remain, remux into playable MP4
            if is_live_recording && (downloaded_path.is_empty() || !Path::new(&downloaded_path).exists() || downloaded_path.ends_with(".part")) {
                if let Some(remuxed) = finalize_live_recording_artifacts(&out_dir, &task_stem, ffmpeg_path.as_deref()) {
                    downloaded_path = remuxed.to_string_lossy().to_string();
                }
            }

            // 3. Fallback: locate by task_stem or video ID if still unresolved
            if downloaded_path.is_empty() || !Path::new(&downloaded_path).exists() {
                if let Ok(entries) = std::fs::read_dir(&out_dir) {
                    let mut matched_file: Option<PathBuf> = None;
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_file() {
                            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                            if ["mp4", "webm", "mkv", "mp3", "m4a", "wav", "flac"].contains(&ext.as_str()) {
                                let filename = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                                if !task_stem.is_empty() && filename.contains(&task_stem) {
                                    matched_file = Some(p);
                                    break;
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

            // 3b. If chat_replay mode only produced a .live_chat.srt file, accept it as the output artifact
            if (downloaded_path.is_empty() || !Path::new(&downloaded_path).exists()) && is_live_recording {
                if let Some(ref srt_p) = generated_chat_srt {
                    if srt_p.exists() && srt_p.is_file() {
                        downloaded_path = srt_p.to_string_lossy().to_string();
                    }
                }
            }

            let is_valid_file = !downloaded_path.is_empty()
                && Path::new(&downloaded_path).is_file()
                && std::fs::metadata(&downloaded_path).map(|m| m.len() > 0).unwrap_or(false);

            if !is_valid_file {
                cleanup_task_artifacts(&out_dir, Some(&task_stem));
                if attempt == 0 && !stopped_live_by_user {
                    continue;
                }
                let err_msg = "Download finished, but output file was not found in destination folder.".to_string();
                let _ = db.update_record(&task_id, "error", None, None, Some(&err_msg));
                let _ = db.log_event(&task_id, "ERROR", "DOWNLOAD", &err_msg, None);

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
                        downloaded_duration_sec: None,
                    },
                    error: Some(err_msg.clone()),
                    is_live_recording: is_live_opt_flag,
                    live_mode: live_mode.clone(),
                    current_step: Some("Failed: output file not found".to_string()),
                    recent_logs: Some(process_mgr.get_logs(&task_id)),
                };
                let _ = app.emit("download-progress", &err_task);
                return Err(err_msg);
            }

            // Ensure live recordings and MPEG-TS stream dumps are cleanly remuxed to standard faststart MP4
            if is_live_recording || is_mpegts_file(Path::new(&downloaded_path)) {
                process_mgr.append_log(&task_id, "Optimizing live video container (faststart MP4)...");
                let _ = remux_to_faststart_mp4(Path::new(&downloaded_path), ffmpeg_path.as_deref());
            }

            let file_size = std::fs::metadata(&downloaded_path).map(|m| m.len() as i64).unwrap_or(0);

            // Determine the EXACT authoritative filename from disk
            let final_file_name = Path::new(&downloaded_path)
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| initial_file_name.clone());

            // Clean up any remaining partial artifacts now that final file is verified on disk
            let final_stem_for_cleanup = Path::new(&downloaded_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&task_stem);
            cleanup_task_artifacts(&out_dir, Some(final_stem_for_cleanup));

            // Extract reliable local thumbnail so Media Vault never has broken/missing thumbnails
            let local_thumb = generate_local_thumbnail(Path::new(&downloaded_path), &task_id);
            if let Some(ref thumb) = local_thumb {
                let _ = db.update_record_thumbnail(&task_id, thumb);
            }

            // Probe the exact downloaded media duration to store ground-truth in Media Vault
            if is_live_recording {
                if let Some(probed) = probe_media_duration(Path::new(&downloaded_path)) {
                    rec_duration = probed.round() as i64;
                }
            }

            // Authoritatively persist title, author, and completed path in SQLite database
            let mut resolved_final_author = effective_author_or_source.clone();
            if resolved_final_author.is_empty()
                || resolved_final_author.eq_ignore_ascii_case("youtube")
                || resolved_final_author.eq_ignore_ascii_case("tiktok")
                || resolved_final_author.eq_ignore_ascii_case("web_media")
            {
                if let Some(inferred_author) = extract_author_from_filename(&final_file_name) {
                    resolved_final_author = inferred_author;
                }
            }

            let completed_record = DownloadRecord {
                id: task_id.clone(),
                platform: initial_record.platform.clone(),
                url: url.clone(),
                title: final_file_name.clone(),
                author: resolved_final_author.clone(),
                duration_sec: rec_duration,
                thumbnail_url: local_thumb.clone().unwrap_or_else(|| rec_thumb.clone()),
                format_type: format_type.clone(),
                quality: quality.clone(),
                file_path: downloaded_path.clone(),
                file_size_bytes: file_size,
                status: "completed".to_string(),
                error: None,
                created_at: chrono::Utc::now().to_rfc3339(),
                time_range: time_range.clone(),
                exists: true,
            };
            let _ = db.add_record(&completed_record);

            let _ = db.log_event(
                &task_id,
                "INFO",
                "DOWNLOAD",
                &format!("Download completed: {}", downloaded_path),
                Some(&format!("fileSizeBytes: {}", file_size)),
            );
            process_mgr.append_log(&task_id, &format!("Saved file: {}", final_file_name));

            let final_task = ActiveDownloadTask {
                task_id: task_id.clone(),
                url: url.clone(),
                title: final_file_name,
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
                    downloaded_duration_sec: if is_live_recording { Some(rec_duration as f64) } else { None },
                },
                error: None,
                is_live_recording: is_live_opt_flag,
                live_mode: live_mode.clone(),
                current_step: Some("Completed".to_string()),
                recent_logs: Some(process_mgr.get_logs(&task_id)),
            };
            process_mgr.remove_context(&task_id);
            let _ = app.emit("download-progress", &final_task);
            return Ok(());
        } else {
            let _ = std::fs::remove_file(&meta_file_path);

            if db.is_task_paused(&task_id) || process_mgr.is_paused(&task_id) {
                let _ = db.log_event(&task_id, "INFO", "DOWNLOAD", "Subprocess halted due to user pause", None);
                return Ok(());
            }

            // Even if yt-dlp exited with non-zero code on a live stream (e.g. broadcaster abruptly ended stream),
            // check if a valid video or remuxable .part recording was captured before declaring failure!
            if is_live_recording {
                if live_config.as_ref().map(|c| c.download_chat || c.mode == "chat_replay").unwrap_or(false) {
                    let _ = convert_live_chat_json_to_srt(&out_dir, &task_stem);
                }
                if let Some(remuxed) = finalize_live_recording_artifacts(&out_dir, &task_stem, ffmpeg_path.as_deref()) {
                    if is_mpegts_file(&remuxed) {
                        let _ = remux_to_faststart_mp4(&remuxed, ffmpeg_path.as_deref());
                    }
                    if let Ok(meta) = std::fs::metadata(&remuxed) {
                        if meta.len() > 0 {
                            let file_size = meta.len() as i64;
                            let final_path_str = remuxed.to_string_lossy().to_string();
                            let final_file_name = remuxed
                                .file_name()
                                .and_then(|s| s.to_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| initial_file_name.clone());
                            cleanup_task_artifacts(&out_dir, Some(&task_stem));
                            let local_thumb = generate_local_thumbnail(&remuxed, &task_id);
                            if let Some(ref thumb) = local_thumb {
                                let _ = db.update_record_thumbnail(&task_id, thumb);
                            }
                            let probed_rec_duration = probe_media_duration(&remuxed)
                                .map(|d| d.round() as i64)
                                .unwrap_or(rec_duration);
                            let completed_record = DownloadRecord {
                                id: task_id.clone(),
                                platform: initial_record.platform.clone(),
                                url: url.clone(),
                                title: final_file_name.clone(),
                                author: initial_record.author.clone(),
                                duration_sec: probed_rec_duration,
                                thumbnail_url: local_thumb.clone().unwrap_or_else(|| rec_thumb.clone()),
                                format_type: format_type.clone(),
                                quality: quality.clone(),
                                file_path: final_path_str.clone(),
                                file_size_bytes: file_size,
                                status: "completed".to_string(),
                                error: None,
                                created_at: chrono::Utc::now().to_rfc3339(),
                                time_range: time_range.clone(),
                                exists: true,
                            };
                            let _ = db.add_record(&completed_record);
                            let final_task = ActiveDownloadTask {
                                task_id: task_id.clone(),
                                url: url.clone(),
                                title: final_file_name,
                                platform: initial_record.platform,
                                format_type,
                                quality,
                                status: "completed".to_string(),
                                progress: TaskProgress {
                                    percent: 100.0,
                                    speed_str: "Saved".to_string(),
                                    eta_str: "00:00".to_string(),
                                    downloaded_bytes: Some(file_size),
                                    total_bytes: Some(file_size),
                                    downloaded_duration_sec: Some(probed_rec_duration as f64),
                                },
                                error: None,
                                is_live_recording: Some(true),
                                live_mode: live_mode.clone(),
                                current_step: Some("Completed".to_string()),
                                recent_logs: Some(process_mgr.get_logs(&task_id)),
                            };
                            process_mgr.remove_context(&task_id);
                            let _ = app.emit("download-progress", &final_task);
                            return Ok(());
                        }
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

            let is_transient_error = last_err_line.as_ref().map(|l| {
                l.contains("403")
                    || l.contains("Forbidden")
                    || l.contains("Conversion failed")
                    || l.contains("HTTP Error")
                    || l.contains("Connection")
                    || l.contains("unable to download")
                    || l.contains("timed out")
            }).unwrap_or(false);

            if attempt == 0 && is_transient_error {
                cleanup_task_artifacts(&out_dir, Some(&task_stem));
                continue;
            }

            // Fallback: If yt-dlp failed (e.g. "No video formats found" on photo post), attempt native image extraction
            if format_type != "audio" && !is_live_recording {
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
                        cleanup_task_artifacts(&out_dir, Some(&task_stem));
                        return Ok(());
                    }
                }
            }

            // Reactive cleanup of any partial artifacts (.part, .ytdl, .temp.*, .f*.mp4)
            cleanup_task_artifacts(&out_dir, Some(&task_stem));

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
            process_mgr.append_log(&task_id, &format!("FAILURE: {}", err_msg));

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
                    downloaded_duration_sec: None,
                },
                error: Some(err_msg.clone()),
                is_live_recording: is_live_opt_flag,
                live_mode: live_mode.clone(),
                current_step: Some(format!("Error: {}", err_msg)),
                recent_logs: Some(process_mgr.get_logs(&task_id)),
            };
            let _ = app.emit("download-progress", &err_task);
            return Err(err_msg);
        }
    }

    let fallback_err = "Download process failed after multiple attempts.".to_string();
    let _ = db.update_record(&task_id, "error", None, None, Some(&fallback_err));
    Err(fallback_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_stem_uses_title_dash_author() {
        assert_eq!(
            build_video_stem(Some("MrBeast"), "I Built 100 Houses", "title_author"),
            "I Built 100 Houses-MrBeast"
        );
    }

    #[test]
    fn video_stem_legacy_format_value_maps_to_title_author() {
        assert_eq!(
            build_video_stem(Some("MrBeast"), "Video", "source_channel_title"),
            "Video-MrBeast"
        );
        assert_eq!(
            build_video_stem(Some("MrBeast"), "Video", "author_title"),
            "Video-MrBeast"
        );
    }

    #[test]
    fn video_stem_strips_at_prefix_and_illegal_chars() {
        assert_eq!(
            build_video_stem(Some("@creator"), "What? A/B: test", "title_author"),
            "What A B test-creator"
        );
    }

    #[test]
    fn video_stem_falls_back_to_title_when_author_missing() {
        assert_eq!(build_video_stem(None, "Clip", "title_author"), "Clip");
        assert_eq!(build_video_stem(Some("  "), "Clip", "title_author"), "Clip");
        assert_eq!(build_video_stem(Some("Unknown"), "Clip", "title_author"), "Clip");
        assert_eq!(build_video_stem(Some("@"), "Clip", "title_author"), "Clip");
    }

    #[test]
    fn video_stem_title_only_ignores_author() {
        assert_eq!(build_video_stem(Some("MrBeast"), "Clip", "title_only"), "Clip");
    }

    #[test]
    fn video_stem_caps_author_length() {
        let long_author = "a".repeat(100);
        let stem = build_video_stem(Some(&long_author), "T", "title_author");
        assert_eq!(stem, format!("T-{}", "a".repeat(40)));
    }

    #[test]
    fn ytdlp_template_escapes_percent() {
        assert_eq!(escape_ytdlp_template("100% Real"), "100%% Real");
    }

    #[test]
    fn video_stem_deduplicates_author_when_already_in_title() {
        assert_eq!(
            build_video_stem(Some("MrBeast"), "MrBeast - I Built 100 Houses", "title_author"),
            "MrBeast - I Built 100 Houses"
        );
        assert_eq!(
            build_video_stem(Some("Taylor Swift"), "Taylor Swift: Anti-Hero", "title_author"),
            "Taylor Swift Anti-Hero"
        );
        assert_eq!(
            build_video_stem(Some("IGN"), "IGN_Cyberpunk_Review", "title_author"),
            "IGN_Cyberpunk_Review"
        );
        assert_eq!(
            build_video_stem(Some("MrBeast"), "I Built 100 Houses - MrBeast", "title_author"),
            "I Built 100 Houses - MrBeast"
        );
    }

    #[test]
    fn test_get_fallback_media_title() {
        assert_eq!(
            get_fallback_media_title("https://www.tiktok.com/@yangviral_trending/video/76991337333", None),
            "TikTok Video 76991337333-yangviral_trending"
        );
        assert_eq!(
            get_fallback_media_title("https://www.youtube.com/watch?v=dQw4w9WgXcQ", Some("Rick Astley")),
            "YouTube Video dQw4w9WgXcQ-Rick Astley"
        );
        assert_eq!(
            get_fallback_media_title("https://www.youtube.com/shorts/abc12345678", None),
            "YouTube Shorts abc12345678"
        );
        assert_eq!(
            get_fallback_media_title("https://www.instagram.com/reel/DFxyz123/", Some("creator")),
            "Instagram Post DFxyz123-creator"
        );
    }

    #[test]
    fn strip_media_extension_removes_known_extensions() {
        assert_eq!(strip_media_extension("video.mp4"), "video");
        assert_eq!(strip_media_extension("clip.MKV"), "clip");
        assert_eq!(strip_media_extension("song.mp3"), "song");
        assert_eq!(strip_media_extension("photo.jpg"), "photo");
        assert_eq!(strip_media_extension("subtitles.srt"), "subtitles");
        assert_eq!(strip_media_extension("no_extension"), "no_extension");
        assert_eq!(strip_media_extension("my.complex.name.mp4"), "my.complex.name");
    }

    #[test]
    fn is_fallback_title_detects_urls_and_placeholders() {
        assert!(is_fallback_title("https://www.youtube.com/watch?v=123"));
        assert!(is_fallback_title("youtube.com/watch?v=123"));
        assert!(is_fallback_title("tiktok.com/@user/video/456"));
        assert!(is_fallback_title("Media"));
        assert!(is_fallback_title("media_download"));
        assert!(is_fallback_title("   "));
        assert!(!is_fallback_title("Never Gonna Give You Up"));
        assert!(!is_fallback_title("Rick Astley - Never Gonna Give You Up"));
    }

    #[test]
    fn test_cleanup_task_artifacts_protects_valid_files() {
        let temp_dir = std::env::temp_dir().join(format!("xd_test_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        let _ = std::fs::create_dir_all(&temp_dir);

        // Valid file: my.film.mp4 with stem my.film (was falsely deleted under B02 bug)
        let valid_file = temp_dir.join("my.film.mp4");
        std::fs::write(&valid_file, b"video content").unwrap();

        // Real fragment: my.film.f137.mp4 (should be deleted)
        let frag_file = temp_dir.join("my.film.f137.mp4");
        std::fs::write(&frag_file, b"fragment content").unwrap();

        // Real temp file: my.film.mp4.part (should be deleted)
        let part_file = temp_dir.join("my.film.mp4.part");
        std::fs::write(&part_file, b"part content").unwrap();

        cleanup_task_artifacts(&temp_dir, Some("my.film"));

        assert!(valid_file.exists(), "my.film.mp4 must NOT be deleted by cleanup!");
        assert!(!frag_file.exists(), "my.film.f137.mp4 must be deleted!");
        assert!(!part_file.exists(), "my.film.mp4.part must be deleted!");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_author_or_source() {
        assert_eq!(
            resolve_author_or_source(Some("@MrBeast"), None, "youtube", "https://youtube.com/watch?v=1"),
            "MrBeast"
        );
        assert_eq!(
            resolve_author_or_source(None, Some("Veritasium"), "youtube", "https://youtube.com/watch?v=1"),
            "Veritasium"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "youtube", "https://youtube.com/watch?v=1"),
            "YouTube"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "tiktok", "https://www.tiktok.com/@user/video/1"),
            "TikTok"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "instagram", "https://www.instagram.com/reel/1"),
            "Instagram"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "x", "https://x.com/status/1"),
            "X"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "threads", "https://threads.net/post/1"),
            "Threads"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "pinterest", "https://pinterest.com/pin/1"),
            "Pinterest"
        );
        assert_eq!(
            resolve_author_or_source(None, None, "web_media", "https://vimeo.com/12345"),
            "Vimeo"
        );
        // TikTok: Prioritize channel display name over handle
        assert_eq!(
            resolve_author_or_source(Some("indonesia_hariini"), Some("Indonesia Hari Ini??"), "tiktok", "https://tiktok.com/@indonesia_hariini/video/1"),
            "Indonesia Hari Ini"
        );
        // YouTube: Strip leading @ from uploader handle
        assert_eq!(
            resolve_author_or_source(Some("@jawed"), Some("jawed"), "youtube", "https://youtube.com/watch?v=1"),
            "jawed"
        );
    }

    #[test]
    fn test_output_filename_convention() {
        let author_or_source = resolve_author_or_source(Some("MrBeast"), None, "youtube", "https://youtube.com");
        let stem = build_video_stem(Some(&author_or_source), "I Built 100 Houses", "title_author");
        let filename = format!("{}.mp4", stem);
        assert_eq!(filename, "I Built 100 Houses-MrBeast.mp4");

        // Custom name
        let stem_custom = build_video_stem(Some(&author_or_source), "my_custom_clip", "title_author");
        let filename_custom = format!("{}.mp4", stem_custom);
        assert_eq!(filename_custom, "my_custom_clip-MrBeast.mp4");

        // Missing author falls back to channel or platform source name
        let fallback_source = resolve_author_or_source(None, None, "youtube", "https://youtube.com");
        let stem_fallback = build_video_stem(Some(&fallback_source), "Clip", "title_author");
        assert_eq!(format!("{}.mp4", stem_fallback), "Clip-YouTube.mp4");
    }

    #[test]
    fn test_clean_download_filename() {
        assert_eq!(
            clean_download_filename("MyVideo-Author.mp4", "mp4"),
            "MyVideo-Author.mp4"
        );
        assert_eq!(
            clean_download_filename("MyVideo-Author.f137.mp4", "mp4"),
            "MyVideo-Author.mp4"
        );
        assert_eq!(
            clean_download_filename("MyVideo-Author.f140.m4a.part", "m4a"),
            "MyVideo-Author.m4a"
        );
        assert_eq!(
            clean_download_filename("How I Run Capcut On Linux!-Fosslicious.f248.webm", "mp4"),
            "How I Run Capcut On Linux!-Fosslicious.webm"
        );
        assert_eq!(
            clean_download_filename("Spider-Man.Far.From.Home.mp4", "mp4"),
            "Spider-Man.Far.From.Home.mp4"
        );
        assert_eq!(
            clean_download_filename("My.favorite.film.mp4", "mp4"),
            "My.favorite.film.mp4"
        );
    }

    #[test]
    fn test_extract_author_from_filename() {
        assert_eq!(
            extract_author_from_filename("How I Run Capcut On Linux!-Fosslicious.mp4"),
            Some("Fosslicious".to_string())
        );
        assert_eq!(
            extract_author_from_filename("How I Run Capcut On Linux!-@Fosslicious.mp4"),
            Some("Fosslicious".to_string())
        );
        assert_eq!(
            extract_author_from_filename("Menteri ESDM...-Indonesia Hari Ini.mp4"),
            Some("Indonesia Hari Ini".to_string())
        );
        assert_eq!(
            extract_author_from_filename("My Video-YouTube.mp4"),
            None
        );
    }

    #[test]
    fn test_build_live_ytdlp_args_modes() {
        // 1. Record from now with 1080p and 300s duration
        let cfg_now = LiveStreamConfig {
            mode: "record_from_now".to_string(),
            duration_sec: Some(300),
            time_range: None,
            download_chat: false,
            wait_for_stream: false,
            wait_interval_sec: None,
            auto_reconnect: true,
            force_keyframes: true,
        };
        let args_now = build_live_ytdlp_args(&cfg_now, "1080p");
        assert!(args_now.contains(&"bestvideo[height<=1080]+bestaudio/best".to_string()));
        assert!(args_now.contains(&"--merge-output-format".to_string()));
        assert!(args_now.contains(&"mp4".to_string()));
        assert!(args_now.contains(&"--hls-use-mpegts".to_string()));
        assert!(args_now.contains(&"ffmpeg_i:-t 300".to_string()));
        assert!(args_now.contains(&"--retries".to_string()));
        assert!(args_now.contains(&"infinite".to_string()));

        // 2. Rewind Live Stream (--live-from-start) with wait-for-video
        let cfg_rewind = LiveStreamConfig {
            mode: "rewind_live".to_string(),
            duration_sec: None,
            time_range: None,
            download_chat: true,
            wait_for_stream: true,
            wait_interval_sec: Some(600),
            auto_reconnect: true,
            force_keyframes: false,
        };
        let args_rewind = build_live_ytdlp_args(&cfg_rewind, "1080p");
        assert!(args_rewind.contains(&"--live-from-start".to_string()));
        assert!(args_rewind.contains(&"--write-subs".to_string()));
        assert!(args_rewind.contains(&"live_chat".to_string()));
        assert!(args_rewind.contains(&"--wait-for-video".to_string()));
        assert!(args_rewind.contains(&"600".to_string()));

        // 3. Capture time range (--download-sections "*01:30:00-02:00:00" --force-keyframes-at-cuts)
        let cfg_range = LiveStreamConfig {
            mode: "capture_time_range".to_string(),
            duration_sec: None,
            time_range: Some(TimeRange {
                start: "01:30:00".to_string(),
                end: "02:00:00".to_string(),
            }),
            download_chat: false,
            wait_for_stream: false,
            wait_interval_sec: None,
            auto_reconnect: false,
            force_keyframes: true,
        };
        let args_range = build_live_ytdlp_args(&cfg_range, "1080p");
        // Regression guard: --live-from-start + --download-sections fails on YouTube live (DASH cannot be partially downloaded)
        assert!(!args_range.contains(&"--live-from-start".to_string()));
        assert!(args_range.contains(&"--hls-use-mpegts".to_string()));
        assert!(args_range.contains(&"--download-sections".to_string()));
        assert!(args_range.contains(&"*01:30:00-02:00:00".to_string()));
        assert!(args_range.contains(&"--force-keyframes-at-cuts".to_string()));

        // 4. Download chat replay (--write-subs --sub-langs live_chat --live-from-start)
        let cfg_chat = LiveStreamConfig {
            mode: "chat_replay".to_string(),
            duration_sec: None,
            time_range: None,
            download_chat: true,
            wait_for_stream: false,
            wait_interval_sec: None,
            auto_reconnect: false,
            force_keyframes: false,
        };
        let args_chat = build_live_ytdlp_args(&cfg_chat, "720p");
        assert!(args_chat.contains(&"bestvideo[height<=720]+bestaudio/best".to_string()));
        assert!(args_chat.contains(&"--write-subs".to_string()));
        assert!(args_chat.contains(&"--sub-langs".to_string()));
        assert!(args_chat.contains(&"live_chat".to_string()));
        assert!(args_chat.contains(&"--live-from-start".to_string()));
    }

    #[test]
    fn test_live_progress_regex_and_parsers() {
        assert_eq!(parse_size_to_bytes("10MiB"), Some(10 * 1024 * 1024));
        assert_eq!(parse_size_to_bytes("1024KiB"), Some(1024 * 1024));
        assert_eq!(parse_hhmmss_to_secs("01:30:00"), Some(5400.0));
        assert_eq!(parse_hhmmss_to_secs("02:05"), Some(125.0));

        let ytdlp_line = "[download]   18.45MiB at    3.12MiB/s (00:01:42) (frag 34)";
        let caps = RE_LIVE_PROGRESS.captures(ytdlp_line).expect("Should match yt-dlp live progress");
        assert_eq!(&caps[1], "18.45MiB");
        assert_eq!(&caps[2], "3.12MiB/s");
        assert_eq!(caps.get(3).map(|m| m.as_str()), Some("00:01:42"));
        assert_eq!(caps.get(4).map(|m| m.as_str()), Some("34"));

        let ff_line = "frame= 1820 fps= 30 q=-1.0 size=   24576KiB time=00:01:00.66 bitrate=3318.4kbits/s speed=1.00x";
        let ff_caps = RE_FFMPEG_PROGRESS.captures(ff_line).expect("Should match ffmpeg live progress");
        assert_eq!(&ff_caps[1], "24576KiB");
        assert_eq!(&ff_caps[2], "00:01:00.66");
        assert_eq!(&ff_caps[3], "3318.4kbits/s");
    }

    #[test]
    fn test_convert_live_chat_json_to_srt_and_finalize_artifacts() {
        let temp_dir = std::env::temp_dir().join(format!(
            "xd_live_test_{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = std::fs::create_dir_all(&temp_dir);

        let chat_jsonl = r#"{"replayChatItemAction":{"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"message":{"runs":[{"text":"Hello live stream!"}]},"authorName":{"simpleText":"Alice"}}}}}],"videoOffsetTimeMsec":"5000"}}
{"replayChatItemAction":{"actions":[{"addChatItemAction":{"item":{"liveChatPaidMessageRenderer":{"purchaseAmountText":{"simpleText":"$10.00"},"message":{"runs":[{"text":"Great broadcast!"}]},"authorName":{"simpleText":"Bob"}}}}}],"videoOffsetTimeMsec":"12500"}}"#;

        let json_file = temp_dir.join("MyStream-Creator.live_chat.json");
        std::fs::write(&json_file, chat_jsonl).unwrap();

        let srt_path = convert_live_chat_json_to_srt(&temp_dir, "MyStream-Creator")
            .expect("Should convert .live_chat.json to .live_chat.srt");
        assert!(srt_path.exists());
        let srt_content = std::fs::read_to_string(&srt_path).unwrap();
        assert!(srt_content.contains("00:00:05,000 --> 00:00:08,500"));
        assert!(srt_content.contains("[Alice]: Hello live stream!"));
        assert!(srt_content.contains("[Bob]: [SuperChat $10.00] Great broadcast!"));

        // Test finalize_live_recording_artifacts fallback rename on .part file
        let part_file = temp_dir.join("MyStream-Creator.mp4.part");
        let frag_file = temp_dir.join("MyStream-Creator.mp4.part-Frag12");
        std::fs::write(&part_file, b"fake mpegts stream bytes").unwrap();
        std::fs::write(&frag_file, b"debris").unwrap();

        let finalized = finalize_live_recording_artifacts(&temp_dir, "MyStream-Creator", None)
            .expect("Should finalize .part into .mp4");
        assert_eq!(finalized, temp_dir.join("MyStream-Creator.mp4"));
        assert!(finalized.exists());
        assert!(!frag_file.exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_is_mpegts_file_detection() {
        let temp_dir = std::env::temp_dir().join(format!("test_ts_detect_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // 1. MPEG-TS stream (starts with 0x47, length >= 8, no 'ftyp' at 4..8)
        let ts_file = temp_dir.join("stream.ts");
        let mut ts_data = vec![0u8; 188];
        ts_data[0] = 0x47;
        ts_data[1] = 0x1f;
        std::fs::write(&ts_file, &ts_data).unwrap();
        assert!(is_mpegts_file(&ts_file));

        // 2. Real ISO-BMFF MP4 file (has 'ftyp' at bytes 4..8)
        let mp4_file = temp_dir.join("video.mp4");
        let mut mp4_data = vec![0u8; 188];
        mp4_data[0] = 0x00;
        mp4_data[1] = 0x00;
        mp4_data[2] = 0x00;
        mp4_data[3] = 0x20;
        mp4_data[4..8].copy_from_slice(b"ftyp");
        std::fs::write(&mp4_file, &mp4_data).unwrap();
        assert!(!is_mpegts_file(&mp4_file));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}



