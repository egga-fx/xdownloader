import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header";
import { UrlInputSection } from "./components/UrlInputSection";
import { MetadataPreviewCard } from "./components/MetadataPreviewCard";
import { MediaVaultDrawer } from "./components/MediaVaultDrawer";
import { BinarySetupModal } from "./components/BinarySetupModal";
import { MediaPreviewModal } from "./components/MediaPreviewModal";
import { SettingsModal } from "./components/SettingsModal";
import { AboutModal } from "./components/AboutModal";
import { UpdateModal } from "./components/UpdateModal";
import { TranscriptStudioModal, StudioMediaInput } from "./components/TranscriptStudioModal";
import {
  ActiveDownloadTask,
  AppSettings,
  BinariesStatus,
  DownloaderFormatType,
  DownloaderPlatform,
  DownloaderQuality,
  DownloadRecord,
  VideoInfo,
  AppUpdateInfo,
  TimeRange,
  TranscriptionConfig,
  TranscriptionProgress,
  MediaItem,
} from "./types";
import { detectPlatform, isSupportedMediaUrl, cleanMediaUrl, extractMultipleUrls, getErrorMessage, sanitizeTitle } from "./lib/utils";
import {
  checkBinariesStatus,
  checkForAppUpdate,
  deleteDownloadRecord,
  getAppSettings,
  getClipboardUrl,
  getDownloadRecords,
  getVideoMetadata,
  onDownloadProgress,
  openInExplorer,
  pickFolder,
  saveAppSettings,
  startDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  copyToClipboard,
  getTranscriptionConfig,
  startTranscription,
  cancelTranscription,
  onTranscriptionProgress,
} from "./lib/tauri-api";
import {
  ensureNotificationPermission,
  notifyDownloadCompleted,
  notifyDownloadFailed,
  notifyOutputFolderChanged,
} from "./lib/notifications";
import {
  Globe,
  CheckCircle,
} from "lucide-react";
import {
  YoutubeIcon,
  InstagramIcon,
  XIcon,
  TikTokIcon,
  PinterestIcon,
  ThreadsIcon,
} from "./lib/icons";

interface QueuedDownloadItem {
  id: string;
  targetUrl: string;
  formatType: DownloaderFormatType;
  quality: DownloaderQuality;
  customName?: string;
  outputFolder?: string;
  title: string;
  thumbnailUrl: string;
  author: string;
  durationSec: number;
  timeRange?: TimeRange;
  selectedIndices?: number[];
  imageUrls?: string[];
  mediaItems?: MediaItem[];
}

const MAX_CONCURRENT_DOWNLOADS = 2;

export function App() {
  // Input & Metadata State
  const [url, setUrl] = useState<string>("");
  const currentUrlRef = useRef<string>("");
  const [detectedPlatform, setDetectedPlatform] = useState<DownloaderPlatform>("generic");
  const [fetchingInfo, setFetchingInfo] = useState<boolean>(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Format & Quality Config
  const [formatType, setFormatType] = useState<DownloaderFormatType>("video");
  const [quality, setQuality] = useState<DownloaderQuality>("best");
  const [customName, setCustomName] = useState<string>("");

  // Media Vault & Tasks State
  const [vaultOpen, setVaultOpen] = useState<boolean>(false);
  const [activeTasks, setActiveTasks] = useState<Map<string, ActiveDownloadTask>>(new Map());
  const [downloadQueue, setDownloadQueue] = useState<QueuedDownloadItem[]>([]);
  const downloadQueueRef = useRef<QueuedDownloadItem[]>([]);
  downloadQueueRef.current = downloadQueue;
  const activeTasksRef = useRef<Map<string, ActiveDownloadTask>>(activeTasks);
  activeTasksRef.current = activeTasks;
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [loadingVault, setLoadingVault] = useState<boolean>(false);
  const [previewRecord, setPreviewRecord] = useState<DownloadRecord | null>(null);

  // Settings & Native Binaries
  const [outputFolder, setOutputFolder] = useState<string>("");
  const [binariesStatus, setBinariesStatus] = useState<BinariesStatus | null>(null);
  const [checkingBinaries, setCheckingBinaries] = useState<boolean>(true);
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"general" | "transcription">("general");
  const [aboutModalOpen, setAboutModalOpen] = useState<boolean>(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    outputFolder: "Videos\\xDownloader",
    defaultVideoQuality: "1080p",
    defaultAudioQuality: "mp3",
    autoClipboardDetect: true,
    downloadSubtitles: false,
    checkUpdatesOnStartup: true,
  });

  // AI Transcription state
  const [transcriptionConfig, setTranscriptionConfig] = useState<TranscriptionConfig | null>(null);
  const [activeTranscriptions, setActiveTranscriptions] = useState<Map<string, TranscriptionProgress>>(new Map());

  // Auto-Updater status
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [updateModalOpen, setUpdateModalOpen] = useState<boolean>(false);

  // Transcript Studio state
  const [transcriptStudioOpen, setTranscriptStudioOpen] = useState<boolean>(false);
  const [studioMediaInput, setStudioMediaInput] = useState<StudioMediaInput | null>(null);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. Initial Load: Binaries, Settings, Vault records & Updater check
  const loadInitialData = useCallback(async () => {
    setCheckingBinaries(true);
    try {
      const status = await checkBinariesStatus();
      setBinariesStatus(status);
      setCheckingBinaries(false);
      if (!status.ytdlp_installed || !status.ffmpeg_installed) {
        setSetupModalOpen(true);
      }

      const settings = await getAppSettings();
      setAppSettings(settings);
      if (settings.outputFolder) {
        setOutputFolder(settings.outputFolder);
      }
      if (settings.defaultVideoQuality) {
        setQuality(settings.defaultVideoQuality);
      } else {
        setQuality("best");
      }

      await loadRecords();

      // Check for application updates on startup
      if (settings.checkUpdatesOnStartup !== false) {
        setCheckingUpdate(true);
        checkForAppUpdate()
          .then((info) => {
            setAvailableUpdate(info);
            if (info.available) {
              showToast(`Update v${info.version} tersedia!`);
            }
          })
          .catch((err) => {
            console.debug("Update check failed/skipped:", err);
          })
          .finally(() => {
            setCheckingUpdate(false);
          });
      }

      // Check/request desktop notification permissions gracefully
      if (settings.desktopNotifications !== false) {
        ensureNotificationPermission().catch(() => {});
      }

      // Load transcription settings
      getTranscriptionConfig()
        .then((cfg) => setTranscriptionConfig(cfg))
        .catch((err) => console.error("Failed to load transcription config:", err));
    } catch (err) {
      console.error("Initial load error:", err);
      setCheckingBinaries(false);
    }
  }, []);

  const loadRecords = async () => {
    setLoadingVault(true);
    try {
      const recs = await getDownloadRecords();
      setRecords(recs);
    } catch (err) {
      console.error("Failed to load records:", err);
    } finally {
      setLoadingVault(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Completion deduplication guards
  const completedTaskIdsRef = useRef<Set<string>>(new Set());
  const failedTaskIdsRef = useRef<Set<string>>(new Set());
  const outputFolderRef = useRef<string>(outputFolder);
  outputFolderRef.current = outputFolder;

  // 2. Listen to real-time download progress events from Tauri Rust Core
  useEffect(() => {
    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;

    onDownloadProgress((task) => {
      // 1. Process side effects outside the state reducer with strict deduplication
      if (task.status === "completed") {
        if (!completedTaskIdsRef.current.has(task.taskId)) {
          completedTaskIdsRef.current.add(task.taskId);
          loadRecords();
          showToast(`Download finished: "${task.title}"`);
          notifyDownloadCompleted(task.title, outputFolderRef.current);
          setTimeout(dequeueAndStartNext, 150);
        }
      } else if (task.status === "error") {
        if (!failedTaskIdsRef.current.has(task.taskId)) {
          failedTaskIdsRef.current.add(task.taskId);
          loadRecords();
          showToast(`Download failed: "${task.title}"${task.error ? ` (${task.error})` : ""}`);
          notifyDownloadFailed(task.title, task.error);
          setTimeout(dequeueAndStartNext, 150);
        }
      }

      // 2. Pure state updater without any side effects
      setActiveTasks((prev) => {
        const next = new Map(prev);
        if (task.status === "completed" || task.status === "error") {
          next.delete(task.taskId);
        } else {
          next.set(task.taskId, task);
        }
        return next;
      });
    }).then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      isCancelled = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  // 2b. Listen to real-time transcription progress events
  useEffect(() => {
    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;

    onTranscriptionProgress((p) => {
      if (p.stage === "completed") {
        loadRecords();
        showToast(p.message || "Transkrip berhasil dibuat!");
        setActiveTranscriptions((prev) => {
          const next = new Map(prev);
          next.delete(p.taskId);
          return next;
        });
      } else if (p.stage === "error") {
        loadRecords();
        showToast(`Transkripsi gagal: ${p.error || p.message}`);
        setActiveTranscriptions((prev) => {
          const next = new Map(prev);
          next.delete(p.taskId);
          return next;
        });
      } else if (p.stage === "cancelled") {
        loadRecords();
        showToast("Transkripsi dibatalkan");
        setActiveTranscriptions((prev) => {
          const next = new Map(prev);
          next.delete(p.taskId);
          return next;
        });
      } else {
        setActiveTranscriptions((prev) => {
          const next = new Map(prev);
          next.set(p.taskId, p);
          return next;
        });
      }
    }).then((fn) => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      isCancelled = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  // 3. Handle URL Change & Auto-fetch Info
  const handleUrlChange = (newUrl: string) => {
    // If text contains a valid media URL (or multiple), extract the target media URL
    const extracted = extractMultipleUrls(newUrl);
    let target = newUrl.trim();
    if (extracted.length === 1) {
      target = extracted[0];
    } else if (extracted.length > 1) {
      target = extracted[0];
      showToast(`Detected ${extracted.length} media links. Displaying first link.`);
    }

    const clean = cleanMediaUrl(target);
    setUrl(clean);
    currentUrlRef.current = clean;
    setError(null);
    const platform = detectPlatform(clean);
    setDetectedPlatform(platform);

    // Immediately clear previous videoInfo so stale metadata doesn't linger
    setVideoInfo(null);
    setCustomName("");

    if (!clean.trim()) {
      return;
    }

    // Auto fetch metadata if supported platform
    if (isSupportedMediaUrl(clean)) {
      fetchMetadata(clean);
    }
  };

  const fetchMetadata = async (targetUrl: string) => {
    const cleanTarget = targetUrl.trim();
    setFetchingInfo(true);
    setError(null);
    try {
      const info = await getVideoMetadata(cleanTarget);
      // Ensure user hasn't changed url while request was in-flight
      if (currentUrlRef.current.trim() === cleanTarget) {
        setVideoInfo(info);
        const rawTitle = info.title.replace(/\s*\[Carousel:?\s*\d+\s*Images?\]/i, "").trim();
        const cleanTitle = sanitizeTitle(rawTitle);
        setCustomName(cleanTitle);
        if (info.description === "image") {
          setFormatType("image");
          setQuality("best");
        } else {
          setFormatType("video");
          setQuality((appSettings.defaultVideoQuality as DownloaderQuality) || "best");
        }
      }
    } catch (err: unknown) {
      if (currentUrlRef.current.trim() === cleanTarget) {
        setError(getErrorMessage(err) || "Failed to retrieve video information");
      }
    } finally {
      if (currentUrlRef.current.trim() === cleanTarget) {
        setFetchingInfo(false);
      }
    }
  };

  const handlePaste = async () => {
    try {
      const text = await getClipboardUrl();
      if (text) {
        handleUrlChange(text);
      }
    } catch {
      // clipboard access fallback
    }
  };

  // 4. Trigger Download
  const handleStartDownload = async (directUrl?: string, selectedIndices?: number[]) => {
    // Strictly prioritize:
    // 1. Explicit directUrl if provided
    // 2. The active input URL from the input box
    // 3. Fallback to videoInfo.webpageUrl if valid
    const currentInput = url.trim();
    const targetUrl = (
      directUrl?.trim() ||
      (currentInput && isSupportedMediaUrl(currentInput) ? currentInput : "") ||
      videoInfo?.webpageUrl ||
      currentInput
    ).trim();

    if (!targetUrl || !isSupportedMediaUrl(targetUrl)) {
      setError("Please provide a valid media URL");
      return;
    }

    // Visibly sync the input box with targetUrl if different
    if (url.trim() !== targetUrl) {
      setUrl(targetUrl);
      currentUrlRef.current = targetUrl;
      setDetectedPlatform(detectPlatform(targetUrl));
    }

    // Strictly ensure metadata belongs to this exact targetUrl
    let matchedInfo =
      videoInfo &&
      (videoInfo.webpageUrl === targetUrl ||
        (videoInfo.id && targetUrl.includes(videoInfo.id)))
        ? videoInfo
        : null;

    // If metadata has not been fetched yet for this targetUrl (e.g. Smart Download clicked immediately), fetch it now!
    if (!matchedInfo && isSupportedMediaUrl(targetUrl)) {
      try {
        const freshInfo = await getVideoMetadata(targetUrl);
        matchedInfo = freshInfo;
        if (currentUrlRef.current.trim() === targetUrl) {
          setVideoInfo(freshInfo);
          const rawFreshTitle = freshInfo.title.replace(/\s*\[Carousel:?\s*\d+\s*Images?\]/i, "").trim();
          const cleanFreshTitle = sanitizeTitle(rawFreshTitle);
          setCustomName(cleanFreshTitle);
          if (freshInfo.description === "image") {
            setFormatType("image");
            setQuality("best");
          } else {
            setFormatType("video");
            setQuality((appSettings.defaultVideoQuality as DownloaderQuality) || "best");
          }
        }
      } catch {
        // continue with fallback
      }
    }

    let finalThumb = matchedInfo?.thumbnail || "";
    if (!finalThumb) {
      const ytMatch = targetUrl.match(
        /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
      );
      if (ytMatch) {
        finalThumb = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
      }
    }

    const finalFormatType =
      matchedInfo?.description === "image"
        ? "image"
        : formatType === "image"
        ? "video"
        : formatType;

    if (finalFormatType === "subtitle") {
      return handleStartTranscription();
    }
    const finalQuality =
      matchedInfo?.description === "image"
        ? "best"
        : quality === "best"
        ? (appSettings.defaultVideoQuality as DownloaderQuality) || "1080p"
        : quality;

    const finalTitle = sanitizeTitle(customName) || sanitizeTitle(matchedInfo?.title) || targetUrl;
    const finalAuthor = matchedInfo?.uploader || matchedInfo?.channel || "";
    const finalDuration = matchedInfo?.duration || 0;

    const queuedItem: QueuedDownloadItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      targetUrl,
      formatType: finalFormatType,
      quality: finalQuality,
      customName: sanitizeTitle(customName) || (matchedInfo ? sanitizeTitle(matchedInfo.title) : undefined),
      outputFolder: outputFolder || undefined,
      title: finalTitle,
      thumbnailUrl: finalThumb,
      author: finalAuthor,
      durationSec: finalDuration,
      selectedIndices,
      imageUrls: matchedInfo?.images,
      mediaItems: matchedInfo?.mediaItems,
    };

    if (activeTasksRef.current.size >= MAX_CONCURRENT_DOWNLOADS) {
      setDownloadQueue((prev) => [...prev, queuedItem]);
      setVaultOpen(true);
      showToast(`Added to queue (#${downloadQueueRef.current.length + 1} in line)`);
    } else {
      executeDownloadTask(queuedItem);
    }
  };

  const dequeueAndStartNext = () => {
    if (downloadQueueRef.current.length > 0 && activeTasksRef.current.size < MAX_CONCURRENT_DOWNLOADS) {
      const nextItem = downloadQueueRef.current[0];
      setDownloadQueue((prev) => prev.slice(1));
      executeDownloadTask(nextItem);
    }
  };

  const executeDownloadTask = async (item: QueuedDownloadItem) => {
    try {
      setError(null);
      const effectiveQuality =
        item.formatType === "audio"
          ? (["mp3", "m4a", "wav", "flac"].includes(item.quality) ? item.quality : appSettings.defaultAudioQuality || "mp3")
          : (item.quality || appSettings.defaultVideoQuality || "1080p");

      const platform = detectPlatform(item.targetUrl);

      const taskId = await startDownload({
        url: item.targetUrl,
        formatType: item.formatType,
        quality: effectiveQuality,
        customName: item.customName,
        outputFolder: item.outputFolder || undefined,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        author: item.author,
        durationSec: item.durationSec,
        downloadSubtitles: Boolean(appSettings.downloadSubtitles),
        timeRange: item.timeRange,
        selectedIndices: item.selectedIndices,
        imageUrls: item.imageUrls,
        mediaItems: item.mediaItems,
      });

      // Optimistically add active task
      setActiveTasks((prev) => {
        const next = new Map(prev);
        next.set(taskId, {
          taskId,
          url: item.targetUrl,
          title: item.title,
          platform,
          formatType: item.formatType,
          quality: item.quality,
          status: "downloading",
          progress: { percent: 0, speedStr: "Starting...", etaStr: "--:--" },
        });
        return next;
      });

      // Automatically open Media Vault to show download progress
      setVaultOpen(true);
      showToast("Download started in Media Vault");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to start download process");
      setTimeout(dequeueAndStartNext, 200);
    }
  };

  // 5. Cancel active task (supports both download and transcription)
  const handleCancelTask = async (taskId: string) => {
    try {
      if (activeTranscriptions.has(taskId) || taskId.startsWith("tr_")) {
        await cancelTranscription(taskId);
        setActiveTranscriptions((prev) => {
          const next = new Map(prev);
          next.delete(taskId);
          return next;
        });
        showToast("Transkripsi dibatalkan");
      } else {
        await cancelDownload(taskId);
        setActiveTasks((prev) => {
          const next = new Map(prev);
          next.delete(taskId);
          return next;
        });
        showToast("Download cancelled");
      }
      setTimeout(dequeueAndStartNext, 200);
    } catch (err: unknown) {
      console.error("Failed to cancel task:", err);
    }
  };

  // 5b. Pause active task
  const handlePauseTask = async (taskId: string) => {
    try {
      await pauseDownload(taskId);
      setActiveTasks((prev) => {
        const next = new Map(prev);
        const task = next.get(taskId);
        if (task) {
          next.set(taskId, {
            ...task,
            status: "paused",
            progress: {
              ...task.progress,
              speedStr: "Paused",
              etaStr: "",
            },
          });
        }
        return next;
      });
      showToast("Download dijeda (Paused)");
    } catch (err: unknown) {
      console.error("Failed to pause task:", err);
      showToast("Gagal menjeda download");
    }
  };

  // 5c. Resume paused task
  const handleResumeTask = async (taskId: string) => {
    try {
      await resumeDownload(taskId);
      setActiveTasks((prev) => {
        const next = new Map(prev);
        const task = next.get(taskId);
        if (task) {
          next.set(taskId, {
            ...task,
            status: "downloading",
            progress: {
              ...task.progress,
              speedStr: "Resuming...",
            },
          });
        }
        return next;
      });
      showToast("Melanjutkan download...");
    } catch (err: unknown) {
      console.error("Failed to resume task:", err);
      showToast("Gagal melanjutkan download");
    }
  };

  // 6. Direct Delete for records
  const handleDeleteRecordDirectly = async (id: string, title?: string) => {
    try {
      const ok = await deleteDownloadRecord(id);
      if (ok) {
        setRecords((prev) => prev.filter((r) => r.id !== id));
        showToast(title ? `"${title}" removed from vault` : "Record removed from vault");
      }
    } catch (err) {
      console.error("Failed to delete record:", err);
    }
  };

  // 6b. Retry download for failed, error, or removed records
  const handleRetryRecord = async (record: DownloadRecord) => {
    try {
      // 1. Delete old failed/missing record from vault database
      await handleDeleteRecordDirectly(record.id, record.title);

      // 2. Trigger fresh download in background
      await handleStartDownload(record.url);
      setVaultOpen(true);
    } catch (err) {
      console.error("Failed to retry download:", err);
      showToast("Gagal memulai unduh ulang");
    }
  };

  // 7. Folder actions
  const handlePickFolder = async () => {
    try {
      const selected = await pickFolder();
      if (selected) {
        setOutputFolder(selected);
        const updated = { ...appSettings, outputFolder: selected };
        setAppSettings(updated);
        await saveAppSettings(updated);
        showToast(`Output folder set to: ${selected}`);
        notifyOutputFolderChanged(selected);
      }
    } catch (err) {
      console.error("Failed to pick or save folder:", err);
    }
  };

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      await saveAppSettings(newSettings);
      setAppSettings((prev) => ({ ...prev, ...newSettings }));
      if (newSettings.defaultVideoQuality) {
        setQuality(newSettings.defaultVideoQuality);
      }
      if (newSettings.outputFolder && newSettings.outputFolder !== outputFolder) {
        setOutputFolder(newSettings.outputFolder);
        notifyOutputFolderChanged(newSettings.outputFolder);
      }
      showToast("Settings saved successfully");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to save settings");
    }
  };

  const handleOpenFolder = async (record?: DownloadRecord) => {
    const target = record?.filePath || outputFolder || "";
    try {
      await openInExplorer(target);
    } catch {
      showToast("Could not open folder in File Explorer");
    }
  };

  const handleCopyPath = async (path: string) => {
    try {
      await copyToClipboard(path);
      showToast("File path copied to clipboard");
    } catch {
      // ignore
    }
  };

  const isDownloadingCurrentUrl = Array.from(activeTasks.values()).some(
    (t) => t.url === url && t.status === "downloading"
  );

  // 8. Trigger AI Video-to-SRT Transcription
  const handleStartTranscription = async () => {
    if (!transcriptionConfig || transcriptionConfig.keyStatus !== "saved") {
      setSettingsInitialSection("transcription");
      setSettingsModalOpen(true);
      showToast("Silakan atur ElevenLabs API Key di Pengaturan");
      return;
    }

    const currentInput = url.trim();
    const targetUrl = (
      (currentInput && isSupportedMediaUrl(currentInput) ? currentInput : "") ||
      videoInfo?.webpageUrl ||
      currentInput
    ).trim();

    if (!targetUrl || !isSupportedMediaUrl(targetUrl)) {
      setError("Masukkan tautan media yang valid untuk membuat transkrip");
      return;
    }

    try {
      setError(null);
      const taskId = await startTranscription({
        url: targetUrl,
        languageCode: transcriptionConfig.languageCode || undefined,
        customName: sanitizeTitle(customName) || (videoInfo ? sanitizeTitle(videoInfo.title) : undefined),
        outputFolder: outputFolder || undefined,
      });

      setActiveTranscriptions((prev) => {
        const next = new Map(prev);
        next.set(taskId, {
          taskId,
          stage: "downloading_audio",
          percent: 10,
          message: "Mengunduh audio untuk transkrip...",
        });
        return next;
      });

      setVaultOpen(true);
      showToast("Transkripsi dimulai di Media Vault");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Gagal memulai transkripsi");
      showToast("Gagal memulai transkripsi");
    }
  };

  const transcriptionTasks: ActiveDownloadTask[] = Array.from(activeTranscriptions.values()).map((t) => ({
    taskId: t.taskId,
    url: url || "",
    title: `${customName || videoInfo?.title || "Media"} [Transkrip SRT]`,
    platform: detectedPlatform,
    formatType: "audio" as DownloaderFormatType,
    quality: "mp3" as DownloaderQuality,
    status: t.stage === "completed" ? "completed" : t.stage === "error" ? "error" : "downloading",
    progress: {
      percent: t.percent,
      speedStr: t.message || "Memproses transkrip...",
      etaStr: "--:--",
    },
  }));

  const allActiveTasks = [...Array.from(activeTasks.values()), ...transcriptionTasks];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden select-none font-sans">
      {/* Top Header */}
      <Header
        outputFolder={outputFolder}
        onPickFolder={handlePickFolder}
        onOpenFolder={() => handleOpenFolder()}
        binariesStatus={binariesStatus}
        checkingBinaries={checkingBinaries}
        onOpenBinarySetup={() => setSetupModalOpen(true)}
        vaultOpen={vaultOpen}
        onToggleVault={() => setVaultOpen(!vaultOpen)}
        vaultCount={records.length}
        activeDownloadingCount={allActiveTasks.length}
        onOpenSettings={() => {
          setSettingsInitialSection("general");
          setSettingsModalOpen(true);
        }}
        onOpenAbout={() => setAboutModalOpen(true)}
        hasUpdate={!!availableUpdate?.available}
        updateInfo={availableUpdate}
        checkingUpdate={checkingUpdate}
        onOpenUpdateModal={() => setUpdateModalOpen(true)}
        onOpenTranscriptStudio={() => {
          setStudioMediaInput(null);
          setTranscriptStudioOpen(true);
        }}
      />

      {/* Main Content Area */}
      <main className="flex-grow overflow-y-auto flex flex-col items-center justify-start px-4 py-4 sm:py-6">
        <div className="w-full max-w-2xl flex flex-col items-center gap-4 sm:gap-5 my-auto">
          {/* Display Title with Kinetic Aurora & Ambient Flare */}
          <div className="relative text-center flex flex-col items-center select-none py-1 group">
            {/* Ambient Cosmic Flare Aura */}
            <div className="absolute -inset-x-16 -inset-y-10 bg-gradient-to-r from-blue-600/25 via-indigo-500/30 to-cyan-400/25 rounded-full title-glow-aura pointer-events-none group-hover:opacity-75 transition-opacity duration-700" />

            {/* Kinetic Aurora Wordmark */}
            <h1 className="relative text-4xl sm:text-5xl font-black tracking-tight title-animated-gradient cursor-default">
              xDownloader
            </h1>
          </div>

          {/* Floating Zero-Layer Input Section */}
          <UrlInputSection
            url={url}
            onUrlChange={handleUrlChange}
            detectedPlatform={detectedPlatform}
            fetchingInfo={fetchingInfo}
            hasMetadata={Boolean(videoInfo || fetchingInfo)}
            onStartDownload={(targetUrl) => handleStartDownload(targetUrl)}
            onPaste={handlePaste}
            error={error}
            autoClipboardDetect={appSettings.autoClipboardDetect}
          />

          {/* Metadata Preview & Settings Box */}
          {videoInfo && (
            <div className="w-full animate-in fade-in slide-in-from-top-3 duration-200">
              <MetadataPreviewCard
                info={videoInfo}
                formatType={formatType}
                setFormatType={setFormatType}
                quality={quality}
                setQuality={setQuality}
                customName={customName}
                setCustomName={setCustomName}
                onDownload={(selectedIndices) => handleStartDownload(videoInfo.webpageUrl || url, selectedIndices)}
                isDownloadingCurrentUrl={isDownloadingCurrentUrl}
                transcriptionReady={transcriptionConfig?.keyStatus === "saved"}
                transcriptionBlockReason={
                  transcriptionConfig?.keyStatus === "invalid"
                    ? "ElevenLabs API Key Tidak Valid"
                    : transcriptionConfig?.keyStatus === "missing"
                    ? "ElevenLabs API Key Belum Dikonfigurasi"
                    : null
                }
                isTranscribing={activeTranscriptions.size > 0}
                onTranscribe={handleStartTranscription}
                onOpenTranscriptionSettings={() => {
                  setSettingsInitialSection("transcription");
                  setSettingsModalOpen(true);
                }}
              />
            </div>
          )}

          {/* Supported Platforms (Grayscale Icons Only, No Hover Animation) */}
          <div className="flex items-center justify-center gap-4 text-[#71717a] grayscale opacity-45 select-none">
            <span title="YouTube">
              <YoutubeIcon className="w-4 h-4" />
            </span>
            <span title="TikTok">
              <TikTokIcon className="w-4 h-4" />
            </span>
            <span title="Instagram">
              <InstagramIcon className="w-4 h-4" />
            </span>
            <span title="Threads">
              <ThreadsIcon className="w-4 h-4" />
            </span>
            <span title="𝕏 (Twitter)">
              <XIcon className="w-4 h-4" />
            </span>
            <span title="Pinterest">
              <PinterestIcon className="w-4 h-4" />
            </span>
            <span title="Direct Web Media">
              <Globe className="w-4 h-4" />
            </span>
          </div>
        </div>
      </main>

      {/* Right Drawer: Media Vault */}
      <MediaVaultDrawer
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        activeTasks={allActiveTasks}
        onPauseTask={handlePauseTask}
        onResumeTask={handleResumeTask}
        onCancelTask={handleCancelTask}
        records={records}
        onRefresh={loadRecords}
        onSelectRecord={(rec) => setPreviewRecord(rec)}
        onOpenFolder={(rec) => handleOpenFolder(rec)}
        onCopyPath={handleCopyPath}
        onDeleteRecordDirectly={handleDeleteRecordDirectly}
        onRetryRecord={handleRetryRecord}
        onOpenTranscriptStudio={(rec) => {
          setStudioMediaInput({
            type: rec.formatType === "subtitle" ? "subtitle" : "file",
            filePath: rec.filePath,
            title: rec.title,
            record: rec,
          });
          setVaultOpen(false);
          setTranscriptStudioOpen(true);
        }}
        loading={loadingVault}
      />

      {/* Media Preview Player Modal */}
      <MediaPreviewModal
        record={previewRecord}
        onClose={() => setPreviewRecord(null)}
        onOpenFolder={(rec) => handleOpenFolder(rec)}
      />

      {/* Engine Setup Modal */}
      <BinarySetupModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        status={binariesStatus}
        checking={checkingBinaries}
        onRefresh={loadInitialData}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={appSettings}
        onSaveSettings={handleSaveSettings}
        onPickFolder={handlePickFolder}
        onOpenAbout={() => setAboutModalOpen(true)}
        initialUpdateInfo={availableUpdate}
        initialSection={settingsInitialSection}
        onTranscriptionConfigChange={(cfg) => setTranscriptionConfig(cfg)}
        onUpdateInfoChange={(info) => setAvailableUpdate(info)}
      />

      {/* About Application Modal */}
      <AboutModal
        open={aboutModalOpen}
        onClose={() => setAboutModalOpen(false)}
      />

      {/* App Update Modal */}
      <UpdateModal
        open={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        updateInfo={availableUpdate}
      />

      {/* AI Transcript Studio Fullscreen Modal */}
      <TranscriptStudioModal
        open={transcriptStudioOpen}
        onClose={() => {
          setTranscriptStudioOpen(false);
          setStudioMediaInput(null);
        }}
        transcriptionConfig={transcriptionConfig}
        onOpenSettings={() => {
          setSettingsInitialSection("transcription");
          setSettingsModalOpen(true);
        }}
        initialMedia={studioMediaInput}
        onRefreshVault={loadRecords}
      />

      {/* Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-[#18181b] border border-[#27272a] shadow-xl text-xs font-bold text-white flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
export default App;
