import React, { useState, useEffect, useRef } from "react";
import {
  Settings,
  X,
  HardDrive,
  FolderSearch,
  FolderOpen,
  Check,
  RotateCcw,
  Sparkles,
  FileText,
  Video,
  Music,
  RefreshCw,
  ArrowUpCircle,
  Loader2,
  ChevronDown,
  Cpu,
  Info,
  Activity,
} from "lucide-react";
import { AppSettings, AppUpdateInfo, DownloaderQuality } from "../types";
import {
  isTauriEnvironment,
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  updateEngine,
  checkBinariesStatus,
  openLogsFolder,
} from "../lib/tauri-api";
import { LogViewerModal } from "./LogViewerModal";
import { getErrorMessage } from "../lib/utils";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  onPickFolder?: () => void;
  onOpenAbout?: () => void;
}

interface QualityOption {
  id: DownloaderQuality;
  label: string;
  badge: string;
  desc: string;
}

const VIDEO_QUALITIES: QualityOption[] = [
  { id: "1080p", label: "1080p Full HD", badge: "1080p", desc: "Standard recommended quality" },
  { id: "best", label: "Best Available", badge: "MAX", desc: "Highest resolution (4K/2K/1080p)" },
  { id: "1440p", label: "1440p 2K QHD", badge: "1440p", desc: "High-definition 2K video" },
  { id: "720p", label: "720p HD", badge: "720p", desc: "Faster download, smaller file size" },
  { id: "480p", label: "480p SD", badge: "480p", desc: "Standard definition for slow networks" },
  { id: "360p", label: "360p Low", badge: "360p", desc: "Minimal bandwidth consumption" },
];

const AUDIO_QUALITIES: QualityOption[] = [
  { id: "mp3", label: "MP3 Audio", badge: "320k", desc: "Universal audio format (320 kbps)" },
  { id: "m4a", label: "M4A Audio", badge: "AAC", desc: "High efficiency audio (AAC)" },
  { id: "wav", label: "WAV Lossless", badge: "PCM", desc: "Uncompressed studio audio" },
  { id: "flac", label: "FLAC Lossless", badge: "FLAC", desc: "Lossless compressed audio" },
];

interface QualityDropdownProps {
  label: string;
  icon: React.ReactNode;
  value: DownloaderQuality;
  options: QualityOption[];
  onChange: (val: DownloaderQuality) => void;
  accent: "blue" | "purple";
  caption: string;
}

const QualityDropdown: React.FC<QualityDropdownProps> = ({
  label,
  icon,
  value,
  options,
  onChange,
  accent,
  caption,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const isBlue = accent === "blue";

  return (
    <div className="flex flex-col gap-1.5 relative" ref={dropdownRef}>
      <label className="font-bold text-xs text-white flex items-center gap-1.5 select-none">
        {icon}
        <span>{label}</span>
      </label>

      {/* Custom Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full bg-[#18181b] border ${
          isOpen
            ? isBlue
              ? "border-blue-500 ring-2 ring-blue-500/20 bg-[#1f1f26]"
              : "border-purple-500 ring-2 ring-purple-500/20 bg-[#1f1f26]"
            : "border-[#27272a] hover:border-[#3f3f46] hover:bg-[#1f1f24]"
        } text-white rounded-xl px-3 py-2 flex items-center justify-between cursor-pointer transition-all duration-150 select-none text-left shadow-sm`}
      >
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className="font-bold text-xs text-white truncate">
            {selected.label}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border shrink-0 ${
              isBlue
                ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                : "bg-purple-500/15 text-purple-400 border-purple-500/30"
            }`}
          >
            {selected.badge}
          </span>
        </div>

        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
            isOpen
              ? isBlue
                ? "rotate-180 text-blue-400"
                : "rotate-180 text-purple-400"
              : "text-[#71717a]"
          }`}
        />
      </button>

      {/* Floating Popover Menu */}
      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-50 bg-[#18181b]/95 backdrop-blur-xl border border-[#27272a] rounded-xl shadow-2xl shadow-black/95 p-1.5 flex flex-col gap-1 max-h-64 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
          {options.map((opt) => {
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange(opt.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left cursor-pointer transition-all ${
                  isSelected
                    ? isBlue
                      ? "bg-blue-500/15 border border-blue-500/30 text-white shadow-sm"
                      : "bg-purple-500/15 border border-purple-500/30 text-white shadow-sm"
                    : "border border-transparent text-[#d4d4d8] hover:bg-[#27272a] hover:text-white"
                }`}
              >
                <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-bold text-xs truncate ${
                        isSelected
                          ? isBlue
                            ? "text-blue-400"
                            : "text-purple-400"
                          : "text-white"
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold border ${
                        isSelected
                          ? isBlue
                            ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                            : "bg-purple-500/20 text-purple-300 border-purple-500/40"
                          : "bg-[#27272a] text-[#a1a1aa] border-[#3f3f46]"
                      }`}
                    >
                      {opt.badge}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#71717a] truncate">
                    {opt.desc}
                  </span>
                </div>

                {isSelected && (
                  <Check
                    className={`w-4 h-4 shrink-0 ${
                      isBlue ? "text-blue-400" : "text-purple-400"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-[#71717a] select-none">
        {caption}
      </p>
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  settings,
  onSaveSettings,
  onPickFolder,
  onOpenAbout,
}) => {
  const [defaultVideoQuality, setDefaultVideoQuality] = useState<DownloaderQuality>("1080p");
  const [defaultAudioQuality, setDefaultAudioQuality] = useState<DownloaderQuality>("mp3");
  const [outputFolder, setOutputFolder] = useState<string>("");
  const [autoClipboardDetect, setAutoClipboardDetect] = useState<boolean>(true);
  const [downloadSubtitles, setDownloadSubtitles] = useState<boolean>(false);
  const [checkUpdatesOnStartup, setCheckUpdatesOnStartup] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  // Auto-Updater state
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateChecked, setUpdateChecked] = useState<boolean>(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState<boolean>(false);
  const [updateProgress, setUpdateProgress] = useState<number>(0);

  // Engine state
  const [engineVersion, setEngineVersion] = useState<string>("");
  const [updatingEngine, setUpdatingEngine] = useState<boolean>(false);
  const [engineStatusMsg, setEngineStatusMsg] = useState<string | null>(null);

  // Diagnostics & Logs modal state
  const [isLogViewerOpen, setIsLogViewerOpen] = useState<boolean>(false);

  const handleOpenLogsFolder = async () => {
    try {
      await openLogsFolder();
    } catch (err) {
      console.error("Failed to open logs folder:", err);
    }
  };

  useEffect(() => {
    if (open) {
      setDefaultVideoQuality(settings.defaultVideoQuality || "1080p");
      setDefaultAudioQuality(settings.defaultAudioQuality || "mp3");
      setOutputFolder(settings.outputFolder || "");
      setAutoClipboardDetect(settings.autoClipboardDetect ?? true);
      setDownloadSubtitles(settings.downloadSubtitles ?? false);
      setCheckUpdatesOnStartup(settings.checkUpdatesOnStartup ?? true);
      setUpdateChecked(false);
      setUpdateError(null);
      setEngineStatusMsg(null);

      // Check yt-dlp version
      checkBinariesStatus().then((st) => {
        if (st.ytdlp_installed && st.ytdlp_version) {
          setEngineVersion(st.ytdlp_version);
        }
      }).catch(() => {});
    }
  }, [open, settings]);

  if (!open) return null;

  const handleUpdateEngine = async () => {
    setUpdatingEngine(true);
    setEngineStatusMsg(null);
    try {
      const msg = await updateEngine();
      setEngineStatusMsg(msg);
      const st = await checkBinariesStatus();
      if (st.ytdlp_version) setEngineVersion(st.ytdlp_version);
    } catch (err: unknown) {
      setEngineStatusMsg(getErrorMessage(err) || "Failed to update engine");
    } finally {
      setUpdatingEngine(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    setUpdateChecked(false);
    try {
      const info = await checkForAppUpdate();
      setUpdateInfo(info);
      setUpdateChecked(true);
    } catch (err: unknown) {
      setUpdateError(getErrorMessage(err) || "Failed to check for updates");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    setUpdateError(null);
    try {
      await downloadAndInstallAppUpdate((pct) => setUpdateProgress(pct));
    } catch (err: unknown) {
      setUpdateError(getErrorMessage(err) || "Failed to download and apply update");
      setInstallingUpdate(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSettings({
        defaultVideoQuality,
        defaultAudioQuality,
        outputFolder,
        autoClipboardDetect,
        downloadSubtitles,
        checkUpdatesOnStartup,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDefaultVideoQuality("1080p");
    setDefaultAudioQuality("mp3");
    setAutoClipboardDetect(true);
    setDownloadSubtitles(false);
    setCheckUpdatesOnStartup(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-[#141418] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/80 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#27272a] flex items-center justify-between bg-[#18181b] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white">
                Settings
              </h3>
              <p className="text-[11px] text-[#71717a]">
                Configure default download quality, storage directory, and preferences
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#27272a] text-[#71717a] hover:text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex flex-col gap-6 text-xs text-[#d4d4d8]">
          {/* 1 & 2. DEFAULT QUALITIES (DROPDOWNS) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <QualityDropdown
              label="Default Video Quality"
              icon={<Video className="w-3.5 h-3.5 text-blue-400" />}
              value={defaultVideoQuality}
              options={VIDEO_QUALITIES}
              onChange={setDefaultVideoQuality}
              accent="blue"
              caption="Applied automatically for one-click downloads"
            />
            <QualityDropdown
              label="Default Audio Quality"
              icon={<Music className="w-3.5 h-3.5 text-purple-400" />}
              value={defaultAudioQuality}
              options={AUDIO_QUALITIES}
              onChange={setDefaultAudioQuality}
              accent="purple"
              caption="Used when extracting audio-only tracks"
            />
          </div>

          {/* 3. DESTINATION FOLDER (Desktop Tauri vs Web) */}
          <div className="flex flex-col gap-2.5">
            <label className="font-bold text-xs text-white flex items-center gap-2">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>Destination Folder</span>
            </label>
            {isTauriEnvironment() ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={outputFolder}
                  onChange={(e) => setOutputFolder(e.target.value)}
                  placeholder="C:\Users\...\Videos\xDownloader"
                  className="flex-grow bg-[#121215] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-blue-500"
                />
                {onPickFolder && (
                  <button
                    type="button"
                    onClick={onPickFolder}
                    className="px-3 py-2 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                    title="Browse Folder"
                  >
                    <FolderSearch className="w-3.5 h-3.5" />
                    <span>Browse</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#18181b] border border-[#27272a] text-[#a1a1aa] flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 text-[#71717a] shrink-0" />
                <span className="text-[11px]">
                  Browser Mode: Media files are downloaded directly to your browser's default Downloads folder.
                </span>
              </div>
            )}
          </div>

          {/* 4. PREFERENCES & TOGGLES */}
          <div className="flex flex-col gap-3 pt-2 border-t border-[#27272a]">
            {/* Auto Clipboard */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#18181b] border border-[#27272a]">
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Auto Clipboard Detection</span>
                </span>
                <span className="text-[11px] text-[#71717a]">
                  Automatically detects video links copied from YouTube, TikTok, IG, etc.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAutoClipboardDetect(!autoClipboardDetect)}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                  autoClipboardDetect ? "bg-blue-600" : "bg-[#27272a]"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 ${
                    autoClipboardDetect ? "left-5.5" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Subtitles */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#18181b] border border-[#27272a]">
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                  <span>Download Subtitles (.srt / .vtt)</span>
                </span>
                <span className="text-[11px] text-[#71717a]">
                  Extract English and Indonesian subtitles if available on video.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDownloadSubtitles(!downloadSubtitles)}
                className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                  downloadSubtitles ? "bg-blue-600" : "bg-[#27272a]"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 ${
                    downloadSubtitles ? "left-5.5" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            {/* 5. APP UPDATES */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-[#27272a]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Application Updates</span>
                </span>
                <span className="text-[11px] font-mono text-[#71717a]">
                  v{updateInfo?.currentVersion || "1.0.0"}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#18181b] border border-[#27272a] flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-xs text-white">xDownloader Desktop</p>
                    <p className="text-[11px] text-[#71717a]">
                      {updateChecked && updateInfo?.available
                        ? `Update available: v${updateInfo.version}`
                        : updateChecked
                        ? "You are running the latest version"
                        : "Check for new releases and updates"}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={checkingUpdate || installingUpdate}
                    onClick={handleCheckUpdate}
                    className="px-3 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {checkingUpdate ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span>Checking...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Check Updates</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Available Update Banner */}
                {updateInfo?.available && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-2 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                        <ArrowUpCircle className="w-4 h-4" />
                        <span>Version v{updateInfo.version} is ready to install</span>
                      </div>
                      <button
                        type="button"
                        disabled={installingUpdate}
                        onClick={handleInstallUpdate}
                        className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {installingUpdate ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Installing ({updateProgress}%)...</span>
                          </>
                        ) : (
                          <span>Update & Relaunch</span>
                        )}
                      </button>
                    </div>

                    {installingUpdate && (
                      <div className="w-full bg-[#141418] rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-1.5 transition-all duration-200"
                          style={{ width: `${updateProgress}%` }}
                        />
                      </div>
                    )}

                    {updateInfo.body && (
                      <p className="text-[11px] text-[#a1a1aa] whitespace-pre-line border-t border-emerald-500/20 pt-1.5">
                        {updateInfo.body}
                      </p>
                    )}
                  </div>
                )}

                {updateError && (
                  <p className="text-[11px] text-red-400">{updateError}</p>
                )}

                {/* Check on launch toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-[#27272a]/60">
                  <span className="text-[11px] text-[#71717a]">
                    Check for updates automatically on launch
                  </span>
                  <button
                    type="button"
                    onClick={() => setCheckUpdatesOnStartup(!checkUpdatesOnStartup)}
                    className={`w-9 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                      checkUpdatesOnStartup ? "bg-blue-600" : "bg-[#27272a]"
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                        checkUpdatesOnStartup ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* 6. MEDIA EXTRACTOR ENGINE (YT-DLP) */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-[#27272a]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Media Extractor Engine</span>
                </span>
                <span className="text-[11px] font-mono text-[#71717a]">
                  yt-dlp
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-between gap-3">
                <div className="min-w-0 pr-2">
                  <p className="font-bold text-xs text-white">yt-dlp Engine</p>
                  <p className="text-[11px] text-[#71717a] truncate">
                    {engineStatusMsg || engineVersion || "Core extractor for YouTube, TikTok, IG, X, and Pinterest"}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={updatingEngine}
                  onClick={handleUpdateEngine}
                  className="px-3 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 shrink-0"
                >
                  {updatingEngine ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Update Engine</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 7. DIAGNOSTICS & SYSTEM LOGS */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-[#27272a]">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  <span>Diagnostics & System Logs</span>
                </span>
                <span className="text-[11px] font-mono text-[#71717a]">
                  SQLite & File Sink
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#18181b] border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 pr-2">
                  <p className="font-bold text-xs text-white">Application Event Logs</p>
                  <p className="text-[11px] text-[#71717a]">
                    Review download traces, subprocess errors, and system events
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleOpenLogsFolder}
                    className="px-3 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Buka folder log aplikasi di file explorer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Buka Folder</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLogViewerOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm shadow-blue-600/30"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Lihat Log Aktivitas</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#18181b] border-t border-[#27272a] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-[#71717a] hover:text-white cursor-pointer transition-colors px-2 py-1 rounded hover:bg-[#27272a]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
            {onOpenAbout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAbout();
                }}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 cursor-pointer transition-colors px-2.5 py-1 rounded hover:bg-blue-500/10 font-semibold"
                title="About xDownloader, Contributors & Git Repository"
              >
                <Info className="w-3.5 h-3.5" />
                <span>About</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-lg shadow-blue-600/30"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? "Saving..." : "Save Settings"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-modal: Log Viewer */}
      <LogViewerModal
        open={isLogViewerOpen}
        onClose={() => setIsLogViewerOpen(false)}
      />
    </div>
  );
};
