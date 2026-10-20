use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRange {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub platform: String,
    pub url: String,
    pub title: String,
    pub author: String,
    pub duration_sec: i64,
    pub thumbnail_url: String,
    pub format_type: String,
    pub quality: String,
    pub file_path: String,
    pub file_size_bytes: i64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    pub time_range: Option<TimeRange>,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub percent: f64,
    pub speed_str: String,
    pub eta_str: String,
    pub downloaded_bytes: Option<i64>,
    pub total_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDownloadTask {
    pub task_id: String,
    pub url: String,
    pub title: String,
    pub platform: String,
    pub format_type: String,
    pub quality: String,
    pub status: String,
    pub progress: TaskProgress,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub kind: String,
    pub url: String,
    pub thumbnail: String,
    pub duration: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub duration: i64,
    pub thumbnail: String,
    pub uploader: String,
    pub channel: String,
    pub description: Option<String>,
    pub webpage_url: String,
    pub images: Option<Vec<String>>,
    pub media_items: Option<Vec<MediaItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinariesStatus {
    pub ytdlp_installed: bool,
    pub ytdlp_version: String,
    pub ytdlp_path: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_version: String,
    pub ffmpeg_path: Option<String>,
    pub bin_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub output_folder: String,
    #[serde(default = "default_video_quality")]
    pub default_video_quality: String,
    #[serde(default = "default_audio_quality")]
    pub default_audio_quality: String,
    #[serde(default = "default_true")]
    pub auto_clipboard_detect: bool,
    #[serde(default)]
    pub download_subtitles: bool,
    #[serde(default = "default_true")]
    pub check_updates_on_startup: bool,
    #[serde(default = "default_true")]
    pub desktop_notifications: bool,
    #[serde(default = "default_video_filename_format")]
    pub video_filename_format: String,
    #[serde(default = "default_carousel_filename_format")]
    pub carousel_filename_format: String,
}

fn default_true() -> bool {
    true
}

fn default_video_quality() -> String {
    "1080p".to_string()
}

fn default_audio_quality() -> String {
    "mp3".to_string()
}

fn default_video_filename_format() -> String {
    "source_channel_title".to_string()
}

fn default_carousel_filename_format() -> String {
    "folder_sequential".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            output_folder: String::new(),
            default_video_quality: "1080p".to_string(),
            default_audio_quality: "mp3".to_string(),
            auto_clipboard_detect: true,
            download_subtitles: false,
            check_updates_on_startup: true,
            desktop_notifications: true,
            video_filename_format: "source_channel_title".to_string(),
            carousel_filename_format: "folder_sequential".to_string(),
        }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub body: Option<String>,
    pub date: Option<String>,
    pub download_url: Option<String>,
    pub release_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: i64,
    pub task_id: String,
    pub level: String,
    pub category: String,
    pub message: String,
    pub details: Option<String>,
    pub created_at: String,
}

/// Transcription settings as seen by the UI. NEVER contains the API key itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionConfig {
    pub provider: String,
    /// "missing" | "saved" | "invalid"
    pub key_status: String,
    pub api_key_hint: Option<String>,
    pub model_id: String,
    pub language_code: Option<String>,
    pub diarize: bool,
    pub tag_audio_events: bool,
    pub max_chars_per_line: u32,
}

/// Progress event payload for `transcription-progress`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionProgress {
    pub task_id: String,
    /// "downloading_audio" | "uploading" | "transcribing" | "writing_files"
    /// | "completed" | "error" | "cancelled"
    pub stage: String,
    pub percent: f64,
    pub message: String,
    pub error: Option<String>,
    pub srt_path: Option<String>,
}



