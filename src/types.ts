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

export interface SplitSegment {
  partIndex: number;
  start: string;
  end: string;
  label?: string;
}

export interface SplitLocalRequest {
  filePath: string;
  segments: SplitSegment[];
  outputFolder?: string;
  preciseCut: boolean;
  createSubfolder: boolean;
}

export interface SplitStreamRequest {
  url: string;
  segments: SplitSegment[];
  formatType: string;
  quality: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
  outputFolder?: string;
  createSubfolder: boolean;
}

export interface SplitProgressEvent {
  partIndex: number;
  totalParts: number;
  percent: number;
  filePath?: string;
  title?: string;
  status: "starting" | "completed" | "error";
  error?: string;
}

export type SplitterSource =
  | {
      type: "online";
      url: string;
      info?: VideoInfo;
    }
  | {
      type: "local";
      record?: DownloadRecord;
      filePath?: string;
      title?: string;
      duration?: number;
      thumbnail?: string;
    };

export type TrimmerSource = SplitterSource;

export interface TrimVideoRequest {
  filePath: string;
  startSec: number;
  endSec: number;
  customName?: string;
  outputFolder?: string;
}

export interface TrimStreamRequest {
  url: string;
  startSec: number;
  endSec: number;
  customName?: string;
  outputFolder?: string;
  formatType?: string;
  quality?: string;
  title?: string;
  thumbnailUrl?: string;
  author?: string;
}


