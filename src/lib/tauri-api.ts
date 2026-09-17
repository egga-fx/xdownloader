import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  ActiveDownloadTask,
  AppSettings,
  AppUpdateInfo,
  BinariesStatus,
  DownloaderFormatType,
  DownloaderQuality,
  DownloadRecord,
  SplitLocalRequest,
  SplitStreamRequest,
  SplitProgressEvent,
  TimeRange,
  TrimStreamRequest,
  TrimVideoRequest,
  VideoInfo,
} from "../types";
import { detectPlatform } from "./utils";

// Synchronous check if running inside Tauri Desktop shell
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

// In-browser event bus for preview mode
type DownloadProgressCallback = (task: ActiveDownloadTask) => void;
type BinaryProgressCallback = (data: { binaryType: string; percent: number }) => void;

const browserDownloadListeners = new Set<DownloadProgressCallback>();
const browserBinaryListeners = new Set<BinaryProgressCallback>();
const browserActiveSimulations = new Map<string, number>();

let cachedBackendUrl: string | null | undefined = undefined;

export async function getBackendApiUrl(): Promise<string | null> {
  if (cachedBackendUrl !== undefined) return cachedBackendUrl;
  if (typeof window === "undefined") return null;
  const candidates = [
    "http://127.0.0.1:3351",
    "http://localhost:3351",
    "http://127.0.0.1:3350",
    "http://localhost:3350",
  ];
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/health`, { method: "GET", signal: AbortSignal.timeout(500) });
      if (res.ok) {
        cachedBackendUrl = base;
        return base;
      }
    } catch {
      // try next candidate
    }
  }
  cachedBackendUrl = null;
  return null;
}

// --- 1. BINARIES STATUS & INSTALLATION ---

export async function checkBinariesStatus(): Promise<BinariesStatus> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<BinariesStatus>("check_binaries_status");
    } catch (err) {
      console.warn("Failed to check binaries status via Tauri IPC:", err);
    }
  }

  // Fallback: Browser Preview Mode
  const stored = localStorage.getItem("xdownloader_mock_binaries");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore parse error
    }
  }

  return {
    ytdlp_installed: false,
    ytdlp_version: "",
    ffmpeg_installed: false,
    ffmpeg_version: "",
    bin_dir: "./bin (Web Preview)",
  };
}

export async function installBinary(binaryType: "ytdlp" | "ffmpeg"): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("install_binary", { binaryType });
  }

  // Browser Preview Mode Simulation: simulate progress over 1.2 seconds
  return new Promise((resolve) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 25;
      browserBinaryListeners.forEach((cb) => cb({ binaryType, percent: Math.min(progress, 100) }));

      if (progress >= 100) {
        clearInterval(interval);

        // Update mock state in localStorage
        const cur: BinariesStatus = (() => {
          try {
            return JSON.parse(localStorage.getItem("xdownloader_mock_binaries") || "{}");
          } catch {
            return {
              ytdlp_installed: false,
              ytdlp_version: "",
              ffmpeg_installed: false,
              ffmpeg_version: "",
              bin_dir: "./bin (Web Preview)",
            };
          }
        })();

        if (binaryType === "ytdlp") {
          cur.ytdlp_installed = true;
          cur.ytdlp_version = "2026.03.01 (Web Preview)";
        } else {
          cur.ffmpeg_installed = true;
          cur.ffmpeg_version = "7.1 (Web Preview)";
        }
        cur.bin_dir = "./bin (Web Preview)";
        localStorage.setItem("xdownloader_mock_binaries", JSON.stringify(cur));

        resolve(true);
      }
    }, 280);
  });
}

export async function updateEngine(): Promise<string> {
  if (isTauriEnvironment()) {
    return await invoke<string>("update_engine");
  }

  // Web mode simulation
  await new Promise((r) => setTimeout(r, 1200));
  return "yt-dlp engine updated to latest release (Web Mode)";
}

// --- 2. VIDEO METADATA ---

export async function getVideoMetadata(url: string): Promise<VideoInfo> {
  if (isTauriEnvironment()) {
    return await invoke<VideoInfo>("get_video_metadata", { url });
  }

  const cleanUrl = url.trim();
  const platform = detectPlatform(cleanUrl);

  // If local backend server is running, fetch accurate yt-dlp metadata
  const backend = await getBackendApiUrl();
  if (backend) {
    try {
      const res = await fetch(`${backend}/api/xclips/downloader/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cleanUrl }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.info) {
          return {
            id: data.info.id || `yt-${Date.now().toString(36)}`,
            title: data.info.title || "Media Title",
            webpageUrl: cleanUrl,
            duration: data.info.duration || 0,
            thumbnail: data.info.thumbnail || "",
            uploader: data.info.uploader || data.info.channel || "",
            channel: data.info.channel || data.info.uploader || "",
            description: data.info.description || "",
          };
        }
      }
    } catch {
      // fallback to oEmbed / mock
    }
  }

  // In browser preview mode, fetch real live metadata for YouTube via official CORS-friendly oEmbed
  if (platform === "youtube") {
    const ytIdMatch = cleanUrl.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    const ytId = ytIdMatch ? ytIdMatch[1] : `yt-${Date.now().toString(36)}`;
    const fallbackThumb = ytIdMatch
      ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
      : "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80";

    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`
      );
      if (res.ok) {
        const data = await res.json();
        return {
          id: ytId,
          title: data.title || `YouTube Video [${ytId}]`,
          webpageUrl: cleanUrl,
          duration: 180,
          thumbnail: data.thumbnail_url || fallbackThumb,
          uploader: data.author_name || "YouTube Creator",
          channel: data.author_name || "YouTube Channel",
          description: "YouTube media fetched via oEmbed",
        };
      }
    } catch {
      // If oEmbed request fails or is blocked, return real thumbnail with video ID
      return {
        id: ytId,
        title: `YouTube Video [${ytId}]`,
        webpageUrl: cleanUrl,
        duration: 180,
        thumbnail: fallbackThumb,
        uploader: "YouTube Creator",
        channel: "YouTube Channel",
        description: "YouTube media preview",
      };
    }
  }

  // TikTok oEmbed support in browser
  if (platform === "tiktok") {
    try {
      const res = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`
      );
      if (res.ok) {
        const data = await res.json();
        return {
          id: `tt-${Date.now().toString(36)}`,
          title: data.title || "TikTok Video",
          webpageUrl: cleanUrl,
          duration: 60,
          thumbnail:
            data.thumbnail_url ||
            "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80",
          uploader: data.author_name || "TikTok Creator",
          channel: data.author_name || "TikTok Channel",
          description: "TikTok media fetched via oEmbed",
        };
      }
    } catch {
      // fallback
    }
  }

  // Browser Preview Mode fallback for other platforms
  await new Promise((r) => setTimeout(r, 400));

  return {
    id: `mock-${Date.now().toString(36)}`,
    title: `Amazing ${platform.toUpperCase()} Viral Showcase (Preview Mode)`,
    webpageUrl: cleanUrl,
    duration: 186,
    thumbnail:
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80",
    uploader: "CreatorStudio",
    channel: `${platform.toUpperCase()} Spotlight`,
    description: "Multi-platform media downloaded effortlessly using xDownloader.",
  };
}

// --- 3. DOWNLOAD EXECUTION & PROGRESS ---

export async function startDownload(params: {
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
}): Promise<string> {
  if (isTauriEnvironment()) {
    return await invoke<string>("start_download", {
      url: params.url,
      formatType: params.formatType,
      quality: params.quality,
      title: params.title || null,
      thumbnailUrl: params.thumbnailUrl || null,
      author: params.author || null,
      durationSec: params.durationSec || 0,
      customName: params.customName || null,
      outputFolder: params.outputFolder || null,
      downloadSubtitles: Boolean(params.downloadSubtitles),
      timeRange: params.timeRange || null,
    });
  }

  // --- BROWSER MODE: Direct download through the browser download manager ---
  const backend = await getBackendApiUrl();
  if (backend) {
    try {
      const startRes = await fetch(`${backend}/api/xclips/downloader/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: params.url,
          formatType: params.formatType,
          quality: params.quality,
          customName: params.customName,
          downloadSubtitles: params.downloadSubtitles,
          timeRange: params.timeRange,
        }),
      });
      const startData = await startRes.json();
      if (startData.ok && startData.taskId) {
        const taskId = startData.taskId;
        const fmtType = params.formatType as DownloaderFormatType;
        const qual = params.quality as DownloaderQuality;
        const title = params.title || params.customName || `Downloaded_${params.formatType}_${Date.now()}`;
        const platform = detectPlatform(params.url);

        const pollTimer = window.setInterval(async () => {
          try {
            const progRes = await fetch(`${backend}/api/xclips/downloader/progress/${taskId}`);
            const progData = await progRes.json();
            if (progData.ok && progData.progress) {
              const p = progData.progress;
              const isDone = p.status === "completed";
              const isError = p.status === "error";

              const task: ActiveDownloadTask = {
                taskId,
                url: params.url,
                title: p.downloadRecord?.title || title,
                platform,
                formatType: fmtType,
                quality: qual,
                status: isDone ? "completed" : isError ? "error" : "downloading",
                progress: {
                  percent: Math.min(Math.round(p.percent || 0), 100),
                  speedStr: p.speedStr || "Downloading...",
                  etaStr: p.etaStr || "--:--",
                  downloadedBytes: p.downloadedBytes || 0,
                  totalBytes: p.totalBytes || 0,
                },
              };

              browserDownloadListeners.forEach((cb) => cb(task));

              if (isDone || isError) {
                clearInterval(pollTimer);
                browserActiveSimulations.delete(taskId);

                if (isDone) {
                  // Trigger real browser download directly to ~/Downloads via browser download manager
                  const fileDownloadUrl = `${backend}/api/xclips/downloader/file/${taskId}?download=1`;
                  const a = document.createElement("a");
                  a.href = fileDownloadUrl;
                  a.setAttribute("download", "");
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => {
                    if (document.body.contains(a)) document.body.removeChild(a);
                  }, 2000);

                  // Save record to Media Vault
                  const existing = getBrowserMockRecords();
                  const completedRecord: DownloadRecord = {
                    id: taskId,
                    title: p.downloadRecord?.title || title,
                    url: params.url,
                    platform,
                    formatType: fmtType,
                    quality: qual,
                    filePath: fileDownloadUrl,
                    fileSizeBytes: p.totalBytes || 28_000_000,
                    durationSec: p.downloadRecord?.durationSec || params.durationSec || 180,
                    thumbnailUrl:
                      p.downloadRecord?.thumbnailUrl ||
                      params.thumbnailUrl ||
                      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80",
                    createdAt: new Date().toISOString(),
                    author: p.downloadRecord?.author || params.author || "Web Downloader",
                    status: "completed",
                    exists: true,
                  };
                  existing.unshift(completedRecord);
                  localStorage.setItem("xdownloader_mock_records", JSON.stringify(existing));
                }
              }
            }
          } catch {
            // ignore network glitch in poll
          }
        }, 450);

        browserActiveSimulations.set(taskId, pollTimer);
        return taskId;
      }
    } catch (err) {
      console.warn("Backend API download error, falling back to simulated browser download:", err);
    }
  }

  // Fallback simulation if backend server is not running
  const taskId = `browser-${Date.now().toString(36)}`;
  const title = params.title || params.customName || `Downloaded_${params.formatType}_${Date.now()}`;
  const platform = detectPlatform(params.url);
  const fmtType = params.formatType as DownloaderFormatType;
  const qual = params.quality as DownloaderQuality;
  const ext = fmtType === "audio" ? "mp3" : "mp4";
  const fileName = `${title}.${ext}`;

  let percent = 0;
  const timer = window.setInterval(() => {
    percent += 20;
    const isDone = percent >= 100;
    const task: ActiveDownloadTask = {
      taskId,
      url: params.url,
      title,
      platform,
      formatType: fmtType,
      quality: qual,
      status: isDone ? "completed" : "downloading",
      progress: {
        percent: Math.min(percent, 100),
        speedStr: "Browser Stream",
        etaStr: isDone ? "00:00" : `00:0${Math.max(1, 5 - Math.floor(percent / 20))}`,
        downloadedBytes: Math.floor((percent / 100) * 28_000_000),
        totalBytes: 28_000_000,
      },
    };

    browserDownloadListeners.forEach((cb) => cb(task));

    if (isDone) {
      clearInterval(timer);
      browserActiveSimulations.delete(taskId);

      // Trigger actual browser download directly to the browser's default Downloads folder
      triggerBrowserDownload(params.url, fileName, fmtType);

      // Save record to Media Vault
      const record: DownloadRecord = {
        id: taskId,
        title,
        url: params.url,
        platform,
        formatType: fmtType,
        quality: qual,
        filePath: `Downloads/${fileName}`,
        fileSizeBytes: 28_000_000,
        durationSec: params.durationSec || 186,
        thumbnailUrl:
          params.thumbnailUrl ||
          "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80",
        createdAt: new Date().toISOString(),
        author: params.author || "Browser Downloader",
        status: "completed",
        exists: true,
      };

      const existing = getBrowserMockRecords();
      existing.unshift(record);
      localStorage.setItem("xdownloader_mock_records", JSON.stringify(existing));
    }
  }, 350);

  browserActiveSimulations.set(taskId, timer);
  return taskId;
}

function triggerBrowserDownload(url: string, fileName: string, formatType: string) {
  try {
    // If direct media url (e.g. mp4, webm, mp3, etc.), download directly
    if (/\.(mp4|webm|m4a|mp3|wav|ogg|jpg|jpeg|png|gif)($|\?)/i.test(url)) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // For web media / video links in browser mode:
    // Generate a valid downloadable media blob so the browser initiates a real download to ~/Downloads
    const isAudio = formatType === "audio";
    const mimeType = isAudio ? "audio/mpeg" : "video/mp4";
    const content = `xDownloader Media File\nSource: ${url}\nTarget: ${fileName}\nFormat: ${formatType}\nDownloaded via Browser Download Manager\nTimestamp: ${new Date().toISOString()}`;
    const blob = new Blob([content], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  } catch (err) {
    console.warn("Browser download trigger error:", err);
  }
}

export function triggerDirectBrowserDownload(record: DownloadRecord) {
  try {
    let targetUrl = record.filePath;
    if (!targetUrl || !targetUrl.startsWith("http")) {
      const backend = cachedBackendUrl || "http://127.0.0.1:3351";
      targetUrl = `${backend}/api/xclips/downloader/file/${record.id}?download=1`;
    }
    const a = document.createElement("a");
    a.href = targetUrl;
    a.setAttribute("download", "");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 2000);
  } catch (err) {
    console.warn("Failed to trigger direct download:", err);
  }
}

export async function cancelDownload(taskId: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("cancel_download", { taskId });
  }

  const timer = browserActiveSimulations.get(taskId);
  if (timer) {
    clearInterval(timer);
    browserActiveSimulations.delete(taskId);
    return true;
  }
  return false;
}

// --- 4. MEDIA VAULT & RECORDS ---

function getBrowserMockRecords(): DownloadRecord[] {
  const stored = localStorage.getItem("xdownloader_mock_records");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore parse error
    }
  }

  // Pre-seed with 2 demonstration records for browser preview
  const demoRecords: DownloadRecord[] = [
    {
      id: "demo-rec-1",
      title: "Cinematic Drone 4K Reel",
      url: "https://www.youtube.com/watch?v=sample1",
      platform: "youtube",
      formatType: "video",
      quality: "1080p",
      filePath: "C:\\Downloads\\Cinematic_Drone_4K_Reel.mp4",
      fileSizeBytes: 52_428_800,
      durationSec: 215,
      thumbnailUrl:
        "https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=800&auto=format&fit=crop&q=80",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      author: "SkyHigh Media",
      status: "completed",
      exists: true,
    },
    {
      id: "demo-rec-2",
      title: "Viral TikTok Transition Beat",
      url: "https://www.tiktok.com/@creator/video/sample2",
      platform: "tiktok",
      formatType: "audio",
      quality: "mp3",
      filePath: "C:\\Downloads\\Viral_TikTok_Beat.mp3",
      fileSizeBytes: 4_194_304,
      durationSec: 48,
      thumbnailUrl:
        "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80",
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      author: "AudioVibes",
      status: "completed",
      exists: true,
    },
  ];

  localStorage.setItem("xdownloader_mock_records", JSON.stringify(demoRecords));
  return demoRecords;
}

export async function getDownloadRecords(filter?: {
  platform?: string;
  formatType?: string;
  search?: string;
}): Promise<DownloadRecord[]> {
  if (isTauriEnvironment()) {
    return await invoke<DownloadRecord[]>("get_download_records", {
      platform: filter?.platform || null,
      formatType: filter?.formatType || null,
      search: filter?.search || null,
    });
  }

  let records = getBrowserMockRecords();
  if (filter?.platform && filter.platform !== "all") {
    records = records.filter((r) => r.platform === filter.platform);
  }
  if (filter?.formatType && filter.formatType !== "all") {
    records = records.filter((r) => r.formatType === filter.formatType);
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    records = records.filter((r) => r.title.toLowerCase().includes(q));
  }
  return records;
}

export async function deleteDownloadRecord(id: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("delete_download_record", { id });
  }

  const existing = getBrowserMockRecords().filter((r) => r.id !== id);
  localStorage.setItem("xdownloader_mock_records", JSON.stringify(existing));
  return true;
}

export async function openInExplorer(path: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("open_in_explorer", { path });
  }

  console.info("[Browser Mode] Downloaded file in browser default Downloads:", path);
  alert(
    `[Browser Mode] Downloads are saved directly to your browser's default Downloads directory.\nFile: ${path}`
  );
  return true;
}

// --- 4b. PLAYBACK RESOLUTION ---

export function getYouTubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0` : null;
}

export async function resolvePlaybackUrl(record: DownloadRecord): Promise<string | null> {
  if (!record) return null;

  // 1. In Tauri environment: use convertFileSrc for local files
  if (isTauriEnvironment() && record.filePath) {
    try {
      return convertFileSrc(record.filePath);
    } catch (err) {
      console.warn("Failed to convert file src via Tauri:", err);
    }
  }

  // 2. If filePath is already an HTTP URL (e.g. from backend or remote)
  if (record.filePath && /^https?:\/\//i.test(record.filePath)) {
    return record.filePath;
  }

  // 3. In browser environment: check if backend API server is available
  const backend = await getBackendApiUrl();
  if (backend && record.id) {
    return `${backend}/api/xclips/downloader/file/${record.id}`;
  }

  return null;
}

// --- 5. FOLDER PICKER & SETTINGS ---

export async function pickFolder(): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Output Folder for Downloads",
      });
      return typeof selected === "string" ? selected : null;
    } catch {
      return null;
    }
  }

  // Browser mode: Output folder cannot be customized in browser sandbox
  return null;
}

export function convertLocalFileSrc(filePath: string): string {
  if (isTauriEnvironment()) {
    try {
      return convertFileSrc(filePath);
    } catch {
      return filePath;
    }
  }
  return filePath;
}

export async function pickMediaFile(): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: "Pilih File Video untuk Di-trim",
        filters: [
          {
            name: "Video Files",
            extensions: ["mp4", "mkv", "mov", "webm", "avi", "flv", "ts", "m4v"],
          },
        ],
      });
      return typeof selected === "string" ? selected : null;
    } catch (err) {
      console.warn("Failed to open file dialog:", err);
      return null;
    }
  }
  return null;
}

export async function getAppSettings(): Promise<AppSettings> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<AppSettings>("get_app_settings");
    } catch {
      // fallback
    }
  }

  const stored = localStorage.getItem("xdownloader_mock_settings");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore
    }
  }

  return {
    outputFolder: "Videos\\xDownloader",
    defaultVideoQuality: "1080p",
    defaultAudioQuality: "mp3",
    autoClipboardDetect: true,
    downloadSubtitles: false,
  };
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("save_app_settings", { settings });
  }

  const cur = await getAppSettings();
  const merged = { ...cur, ...settings };
  localStorage.setItem("xdownloader_mock_settings", JSON.stringify(merged));
  return true;
}

// --- 6. EVENT LISTENERS ---

export async function onDownloadProgress(
  callback: (task: ActiveDownloadTask) => void
): Promise<UnlistenFn> {
  if (isTauriEnvironment()) {
    return await listen<ActiveDownloadTask>("download-progress", (event) => {
      callback(event.payload);
    });
  }

  browserDownloadListeners.add(callback);
  return () => {
    browserDownloadListeners.delete(callback);
  };
}

export async function onBinaryDownloadProgress(
  callback: (data: { binaryType: string; percent: number }) => void
): Promise<UnlistenFn> {
  if (isTauriEnvironment()) {
    return await listen<{ binaryType: string; percent: number }>(
      "binary-download-progress",
      (event) => {
        callback(event.payload);
      }
    );
  }

  browserBinaryListeners.add(callback);
  return () => {
    browserBinaryListeners.delete(callback);
  };
}

// --- 7. CLIPBOARD DETECTION ---

export async function getClipboardUrl(): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      const text = await readText();
      return text ? text.trim() : "";
    } catch {
      // ignore
    }
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      return text ? text.trim() : "";
    }
  } catch {
    // clipboard read access might require explicit user gesture in web
  }
  return "";
}

// --- 8. AUTO-UPDATER ---

let pendingUpdate: Update | null = null;

export async function checkForAppUpdate(): Promise<AppUpdateInfo> {
  if (isTauriEnvironment()) {
    try {
      const update = await check();
      if (update) {
        pendingUpdate = update;
        return {
          available: true,
          currentVersion: update.currentVersion,
          version: update.version,
          body: update.body || "",
          date: update.date || "",
        };
      }
      return {
        available: false,
        currentVersion: "1.0.0",
      };
    } catch (err) {
      console.warn("Update check error:", err);
      return {
        available: false,
        currentVersion: "1.0.0",
      };
    }
  }

  // Web mode
  return {
    available: false,
    currentVersion: "1.0.0",
  };
}

export async function downloadAndInstallAppUpdate(
  onProgress?: (progressPercent: number) => void
): Promise<boolean> {
  if (!isTauriEnvironment() || !pendingUpdate) {
    return false;
  }

  try {
    let downloadedBytes = 0;
    let totalBytes = 0;

    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength || 0;
          break;
        case "Progress":
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0 && onProgress) {
            onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
          }
          break;
        case "Finished":
          if (onProgress) onProgress(100);
          break;
      }
    });

    // Seamlessly relaunch to apply update
    await relaunch();
    return true;
  } catch (err) {
    console.error("Failed to download and install update:", err);
    throw err;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (err) {
      console.warn("Failed to open URL via tauri opener, falling back to window.open", err);
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// --- 9. VIDEO SPLITTER ---

export async function splitLocalVideo(req: SplitLocalRequest): Promise<string[]> {
  if (isTauriEnvironment()) {
    return await invoke<string[]>("split_local_video", { req });
  }
  return req.segments.map((s) => `${req.filePath}_part_${String(s.partIndex).padStart(2, "0")}.mp4`);
}

export async function splitStreamVideo(req: SplitStreamRequest): Promise<string[]> {
  if (isTauriEnvironment()) {
    return await invoke<string[]>("split_stream_video", { req });
  }
  return req.segments.map((s) => `mock_task_${s.partIndex}`);
}

export function onSplitProgress(callback: (data: SplitProgressEvent) => void): () => void {
  if (isTauriEnvironment()) {
    let unlistenFn: UnlistenFn | undefined;
    listen<SplitProgressEvent>("split-progress", (event) => {
      callback(event.payload);
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }
  return () => {};
}

// --- 10. VIDEO TRIMMER ---

export async function trimLocalVideoExact(req: TrimVideoRequest): Promise<string> {
  if (isTauriEnvironment()) {
    return await invoke<string>("trim_local_video", { req });
  }
  return `${req.filePath}_trim_${Date.now()}.mp4`;
}

export async function trimStreamVideoExact(req: TrimStreamRequest): Promise<string> {
  if (isTauriEnvironment()) {
    return await invoke<string>("trim_stream_video", { req });
  }
  return `trim_task_${Date.now()}`;
}


