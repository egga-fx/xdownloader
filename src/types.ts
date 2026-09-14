export type DownloaderPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "x"
  | "pinterest"
  | "web_media"
  | "generic";

export type DownloaderFormatType = "video" | "audio" | "image" | "subtitle";

export type DownloaderQuality =
  | "best"
  | "4k"
  | "1440p"
  | "1080p"
  | "720p"
  | "480p"
  | "360p"
  | "mp3"
  | "m4a"
  | "wav"
  | "flac"
  | "srt"
  | "vtt";

export interface TimeRange {
  start: string;
  end: string;
}

export interface DownloadRecord {
  id: string;
  platform: DownloaderPlatform;
  url: string;
  title: string;
  author: string;
  durationSec: number;
  thumbnailUrl: string;
  formatType: DownloaderFormatType;
  quality: DownloaderQuality;
  filePath: string;
  fileSizeBytes: number;
  status: "downloading" | "completed" | "error";
  error?: string;
  createdAt: string;
  timeRange?: TimeRange;
  exists?: boolean;
}

export interface TaskProgress {
  percent: number;
  speedStr: string;
  etaStr: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface ActiveDownloadTask {
  taskId: string;
  url: string;
  title: string;
  platform: DownloaderPlatform;
  formatType: DownloaderFormatType;
  quality: DownloaderQuality;
  status: "downloading" | "completed" | "error";
  progress: TaskProgress;
  error?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  duration: number; // in seconds
  thumbnail: string;
  uploader: string;
  channel: string;
  description?: string;
  webpageUrl: string;
}

export interface BinariesStatus {
  ytdlp_installed: boolean;
  ytdlp_version: string;
  ytdlp_path?: string;
  ffmpeg_installed: boolean;
  ffmpeg_version: string;
  ffmpeg_path?: string;
  bin_dir: string;
}

export interface AppSettings {
  outputFolder: string;
  defaultVideoQuality: DownloaderQuality;
  defaultAudioQuality: DownloaderQuality;
  autoClipboardDetect: boolean;
  downloadSubtitles: boolean;
  checkUpdatesOnStartup?: boolean;
}

export interface AppUpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  body?: string;
  date?: string;
}

