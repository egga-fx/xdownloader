import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header";
import { UrlInputSection } from "./components/UrlInputSection";
import { MetadataPreviewCard } from "./components/MetadataPreviewCard";
import { MediaVaultDrawer } from "./components/MediaVaultDrawer";
import { BinarySetupModal } from "./components/BinarySetupModal";
import { MediaPreviewModal } from "./components/MediaPreviewModal";
import { SettingsModal } from "./components/SettingsModal";
import { AboutModal } from "./components/AboutModal";
import { VideoSplitterModal } from "./components/VideoSplitterModal";
import { VideoTrimmerModal } from "./components/VideoTrimmerModal";
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
  SplitterSource,
  TrimmerSource,
} from "./types";
import { detectPlatform, isSupportedMediaUrl, cleanMediaUrl, extractMultipleUrls, getErrorMessage } from "./lib/utils";
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
  cancelDownload,
} from "./lib/tauri-api";
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
  const [quality, setQuality] = useState<DownloaderQuality>("1080p");
  const [customName, setCustomName] = useState<string>("");
  const [timeRange, setTimeRange] = useState<TimeRange | undefined>(undefined);

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
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [aboutModalOpen, setAboutModalOpen] = useState<boolean>(false);
  const [splitterModalOpen, setSplitterModalOpen] = useState<boolean>(false);
  const [splitterSource, setSplitterSource] = useState<SplitterSource | null>(null);
  const [trimmerModalOpen, setTrimmerModalOpen] = useState<boolean>(false);
  const [trimmerSource, setTrimmerSource] = useState<TrimmerSource | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    outputFolder: "Videos\\xDownloader",
    defaultVideoQuality: "1080p",
    defaultAudioQuality: "mp3",
    autoClipboardDetect: true,
    downloadSubtitles: false,
    checkUpdatesOnStartup: true,
  });

  // Auto-Updater status
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleOpenTrimmer = (src?: TrimmerSource) => {
    if (src) {
      setTrimmerSource(src);
    } else if (videoInfo) {
      setTrimmerSource({
        type: "online",
        url: videoInfo.webpageUrl || url,
        info: videoInfo,
      });
    } else if (url.trim()) {
      setTrimmerSource({
        type: "online",
        url: url.trim(),
      });
    } else {
      setTrimmerSource(null);
    }
    setTrimmerModalOpen(true);
  };

  const handleOpenSplitter = (src?: SplitterSource) => {
    if (src) {
      setSplitterSource(src);
    } else if (videoInfo) {
      setSplitterSource({
        type: "online",
        url: videoInfo.webpageUrl || url,
        info: videoInfo,
      });
    } else if (url.trim()) {
      setSplitterSource({
        type: "online",
        url: url.trim(),
      });
    } else {
      setSplitterSource(null);
    }
    setSplitterModalOpen(true);
  };

  // 1. Initial Load: Binaries, Settings, Vault records & Updater check
  const loadInitialData = useCallback(async () => {
    try {
      const status = await checkBinariesStatus();
      setBinariesStatus(status);
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
      }

      await loadRecords();

      // Check for application updates on startup if enabled
      if (settings.checkUpdatesOnStartup !== false) {
        checkForAppUpdate()
          .then((info) => {
            if (info.available) {
              setAvailableUpdate(info);
              showToast(`Update v${info.version} available!`);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Initial load error:", err);
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

  // 2. Listen to real-time download progress events from Tauri Rust Core
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onDownloadProgress((task) => {
      setActiveTasks((prev) => {
        const next = new Map(prev);
        if (task.status === "completed" || task.status === "error") {
          // If completed, refresh records from SQLite
          loadRecords();
          if (task.status === "completed") {
            showToast(`Download finished: "${task.title}"`);
          }
          next.delete(task.taskId);
          // Auto-trigger next item from queue if slots available
          setTimeout(dequeueAndStartNext, 150);
        } else {
          next.set(task.taskId, task);
        }
        return next;
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 3. Handle URL Change & Auto-fetch Info
  const handleUrlChange = (newUrl: string) => {
    const multiUrls = extractMultipleUrls(newUrl);
    if (multiUrls.length > 1) {
      // Multiple URLs pasted at once! Queue all of them sequentially
      setUrl("");
      showToast(`Batch queued: ${multiUrls.length} videos`);
      for (const itemUrl of multiUrls) {
        handleStartDownload(itemUrl);
      }
      return;
    }

    const clean = cleanMediaUrl(newUrl);
    setUrl(clean);
    currentUrlRef.current = clean;
    setError(null);
    const platform = detectPlatform(clean);
    setDetectedPlatform(platform);

    // Immediately clear previous videoInfo so stale metadata doesn't linger
    setVideoInfo(null);
    setCustomName("");
    setTimeRange(undefined);

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
        setCustomName(info.title);
        if (info.description === "image") {
          setFormatType("image");
          setQuality("best");
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
  const handleStartDownload = async (directUrl?: string) => {
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
          setCustomName(freshInfo.title);
          if (freshInfo.description === "image") {
            setFormatType("image");
            setQuality("best");
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

    const finalFormatType = matchedInfo?.description === "image" ? "image" : formatType;
    const finalQuality = matchedInfo?.description === "image" ? "best" : quality;

    const finalTitle = customName || matchedInfo?.title || targetUrl;
    const finalAuthor = matchedInfo?.uploader || matchedInfo?.channel || "";
    const finalDuration = matchedInfo?.duration || 0;

    const queuedItem: QueuedDownloadItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      targetUrl,
      formatType: finalFormatType,
      quality: finalQuality,
      customName: customName || (matchedInfo ? matchedInfo.title : undefined),
      outputFolder: outputFolder || undefined,
      title: finalTitle,
      thumbnailUrl: finalThumb,
      author: finalAuthor,
      durationSec: finalDuration,
      timeRange: finalFormatType === "image" ? undefined : timeRange,
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

  // 5. Cancel active task
  const handleCancelTask = async (taskId: string) => {
    try {
      await cancelDownload(taskId);
      setActiveTasks((prev) => {
        const next = new Map(prev);
        next.delete(taskId);
        return next;
      });
      showToast("Download cancelled");
      setTimeout(dequeueAndStartNext, 200);
    } catch (err: unknown) {
      console.error("Failed to cancel task:", err);
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

  // 7. Folder actions
  const handlePickFolder = async () => {
    const selected = await pickFolder();
    if (selected) {
      setOutputFolder(selected);
      await saveAppSettings({ outputFolder: selected });
      setAppSettings((prev) => ({ ...prev, outputFolder: selected }));
      showToast(`Output folder set to: ${selected}`);
    }
  };

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      await saveAppSettings(newSettings);
      setAppSettings((prev) => ({ ...prev, ...newSettings }));
      if (newSettings.defaultVideoQuality) {
        setQuality(newSettings.defaultVideoQuality);
      }
      if (newSettings.outputFolder) {
        setOutputFolder(newSettings.outputFolder);
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
      await navigator.clipboard.writeText(path);
      showToast("File path copied to clipboard");
    } catch {
      // ignore
    }
  };

  const isDownloadingCurrentUrl = Array.from(activeTasks.values()).some(
    (t) => t.url === url && t.status === "downloading"
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden select-none font-sans">
      {/* Top Header */}
      <Header
        outputFolder={outputFolder}
        onPickFolder={handlePickFolder}
        onOpenFolder={() => handleOpenFolder()}
        binariesStatus={binariesStatus}
        onOpenBinarySetup={() => setSetupModalOpen(true)}
        vaultOpen={vaultOpen}
        onToggleVault={() => setVaultOpen(!vaultOpen)}
        vaultCount={records.length}
        activeDownloadingCount={activeTasks.size}
        onOpenSplitter={() => handleOpenSplitter()}
        onOpenTrimmer={() => handleOpenTrimmer()}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenAbout={() => setAboutModalOpen(true)}
        hasUpdate={!!availableUpdate?.available}
      />

      {/* Main Content Area */}
      <main className="flex-grow overflow-y-auto flex flex-col items-center justify-start px-4 py-8 sm:py-12">
        <div className="w-full max-w-3xl flex flex-col items-center gap-6 my-auto">
          {/* Display Title with Kinetic Aurora & Ambient Flare */}
          <div className="relative text-center flex flex-col items-center select-none py-2 group">
            {/* Ambient Cosmic Flare Aura */}
            <div className="absolute -inset-x-16 -inset-y-10 bg-gradient-to-r from-blue-600/25 via-indigo-500/30 to-cyan-400/25 rounded-full title-glow-aura pointer-events-none group-hover:opacity-75 transition-opacity duration-700" />

            {/* Kinetic Aurora Wordmark */}
            <h1 className="relative text-5xl sm:text-6xl font-black tracking-tight title-animated-gradient cursor-default">
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
                timeRange={timeRange}
                setTimeRange={setTimeRange}
                onDownload={() => handleStartDownload(videoInfo.webpageUrl || url)}
                onOpenSplitter={() => handleOpenTrimmer()}
                onOpenTrimmer={() => handleOpenTrimmer()}
                isDownloadingCurrentUrl={isDownloadingCurrentUrl}
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
        activeTasks={Array.from(activeTasks.values())}
        onCancelTask={handleCancelTask}
        records={records}
        onRefresh={loadRecords}
        onSelectRecord={(rec) => setPreviewRecord(rec)}
        onOpenFolder={(rec) => handleOpenFolder(rec)}
        onCopyPath={handleCopyPath}
        onDeleteRecordDirectly={handleDeleteRecordDirectly}
        onSplitRecord={(rec) =>
          handleOpenTrimmer({
            type: "local",
            record: rec,
            filePath: rec.filePath,
            title: rec.title,
            duration: rec.durationSec,
            thumbnail: rec.thumbnailUrl,
          })
        }
        loading={loadingVault}
      />

      {/* Media Preview Player Modal */}
      <MediaPreviewModal
        record={previewRecord}
        onClose={() => setPreviewRecord(null)}
        onOpenFolder={(rec) => handleOpenFolder(rec)}
        onOpenTrimmer={(rec) =>
          handleOpenTrimmer({
            type: "local",
            record: rec,
            filePath: rec.filePath,
            title: rec.title,
            duration: rec.durationSec,
            thumbnail: rec.thumbnailUrl,
          })
        }
      />

      {/* Video Trimmer Modal */}
      <VideoTrimmerModal
        open={trimmerModalOpen}
        onClose={() => setTrimmerModalOpen(false)}
        source={trimmerSource}
        outputFolder={outputFolder}
        onSuccess={() => {
          loadRecords();
          showToast("Video trimmed successfully!");
        }}
      />

      {/* Video Splitter Modal */}
      <VideoSplitterModal
        open={splitterModalOpen}
        onClose={() => setSplitterModalOpen(false)}
        source={splitterSource}
        outputFolder={outputFolder}
        onSuccess={() => {
          loadRecords();
          showToast("Video split successfully!");
        }}
      />

      {/* Engine Setup Modal */}
      <BinarySetupModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        status={binariesStatus}
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
      />

      {/* About Application Modal */}
      <AboutModal
        open={aboutModalOpen}
        onClose={() => setAboutModalOpen(false)}
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
