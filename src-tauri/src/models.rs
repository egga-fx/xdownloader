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
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub duration: i64,
    pub thumbnail: String,
    pub uploader: String,
    pub channel: String,
    pub description: Option<String>,
    pub webpage_url: String,
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
    pub output_folder: String,
    pub default_video_quality: String,
    pub default_audio_quality: String,
    pub auto_clipboard_detect: bool,
    pub download_subtitles: bool,
    #[serde(default = "default_true")]
    pub check_updates_on_startup: bool,
}

fn default_true() -> bool {
    true
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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitSegment {
    pub part_index: u32,
    pub start: String,
    pub end: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitLocalRequest {
    pub file_path: String,
    pub segments: Vec<SplitSegment>,
    pub output_folder: Option<String>,
    pub precise_cut: bool,
    pub create_subfolder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitStreamRequest {
    pub url: String,
    pub segments: Vec<SplitSegment>,
    pub format_type: String,
    pub quality: String,
    pub title: Option<String>,
    pub thumbnail_url: Option<String>,
    pub author: Option<String>,
    pub output_folder: Option<String>,
    pub create_subfolder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimVideoRequest {
    pub file_path: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub custom_name: Option<String>,
    pub output_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimStreamRequest {
    pub url: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub custom_name: Option<String>,
    pub output_folder: Option<String>,
    pub format_type: Option<String>,
    pub quality: Option<String>,
    pub title: Option<String>,
    pub thumbnail_url: Option<String>,
    pub author: Option<String>,
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



