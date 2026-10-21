export type DownloaderPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "x"
  | "pinterest"
  | "threads"
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
  status: "downloading" | "paused" | "completed" | "error";
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
  status: "downloading" | "paused" | "completed" | "error";
  progress: TaskProgress;
  error?: string;
}

export interface MediaItem {
  kind: "video" | "image";
  url: string;
  thumbnail: string;
  duration: number; // in seconds
  width?: number | null;
  height?: number | null;
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
  images?: string[];
  mediaItems?: MediaItem[];
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

/** `author_title` → `$author_name-$media_title.$ext` | `title_only` → `$media_title.$ext` */
export type VideoFilenameFormat = "author_title" | "title_only";
export type CarouselFilenameFormat = "folder_sequential" | "title_sequential";

export interface AppSettings {
  outputFolder: string;
  defaultVideoQuality: DownloaderQuality;
  defaultAudioQuality: DownloaderQuality;
  autoClipboardDetect: boolean;
  downloadSubtitles: boolean;
  checkUpdatesOnStartup?: boolean;
  desktopNotifications?: boolean;
  videoFilenameFormat?: VideoFilenameFormat;
  carouselFilenameFormat?: CarouselFilenameFormat;
}

export interface AppUpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  body?: string;
  date?: string;
  downloadUrl?: string;
  releaseUrl?: string;
}

export interface LogEntry {
  id: number;
  taskId?: string | null;
  level: "INFO" | "WARN" | "ERROR" | string;
  category: string;
  message: string;
  details?: string | null;
  createdAt: string;
}

export interface DownloadRequestParams {
  url: string;
  formatType: string;
  quality: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  durationSec?: number;
  customName?: string;
  outputFolder?: string;
  downloadSubtitles?: boolean;
  timeRange?: TimeRange;
  selectedIndices?: number[];
  imageUrls?: string[];
  mediaItems?: MediaItem[];
}

export type TranscriptionKeyStatus = "missing" | "saved" | "invalid";

export type TranscriptionStage =
  | "downloading_audio"
  | "uploading"
  | "transcribing"
  | "writing_files"
  | "completed"
  | "error"
  | "cancelled";

export interface TranscriptionConfig {
  provider: string;
  keyStatus: TranscriptionKeyStatus;
  apiKeyHint?: string | null;
  modelId: string;
  languageCode?: string | null;
  diarize: boolean;
  tagAudioEvents: boolean;
  maxCharsPerLine: number;
}

export interface TranscriptionProgress {
  taskId: string;
  stage: TranscriptionStage;
  percent: number;
  message: string;
  error?: string | null;
  srtPath?: string | null;
}
