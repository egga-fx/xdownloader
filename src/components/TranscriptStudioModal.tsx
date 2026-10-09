import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  UploadCloud,
  FileVideo,
  FileAudio,
  FileText,
  Play,
  Download,
  Copy,
  Check,
  Search,
  Sparkles,
  Sliders,
  Users,
  Mic,
  AlertCircle,
  Loader2,
  Settings as SettingsIcon,
  Save,
} from "lucide-react";
import {
  DownloadRecord,
  TranscriptionConfig,
  TranscriptionProgress,
} from "../types";
import {
  isTauriEnvironment,
  convertFileSrc,
  pickMediaFile,
  startTranscription,
  startTranscriptionForFile,
  cancelTranscription,
  onTranscriptionProgress,
  readSubtitleFile,
  saveSubtitleFile,
} from "../lib/tauri-api";

export interface StudioMediaInput {
  type: "file" | "url" | "subtitle";
  filePath?: string;
  url?: string;
  title?: string;
  record?: DownloadRecord;
}

interface TranscriptStudioModalProps {
  open: boolean;
  onClose: () => void;
  transcriptionConfig: TranscriptionConfig | null;
  onOpenSettings: () => void;
  initialMedia?: StudioMediaInput | null;
  onRefreshVault?: () => void;
}

interface ParsedCue {
  id: number;
  startSec: number;
  endSec: number;
  startTime: string;
  endTime: string;
  speaker?: string;
  text: string;
}

export const TranscriptStudioModal: React.FC<TranscriptStudioModalProps> = ({
  open,
  onClose,
  transcriptionConfig,
  onOpenSettings,
  initialMedia,
  onRefreshVault,
}) => {
  // Input state
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>("");
  const [mediaTitle, setMediaTitle] = useState<string>("");

  // Options
  const [diarize, setDiarize] = useState<boolean>(
    transcriptionConfig?.diarize ?? false
  );
  const [tagEvents, setTagEvents] = useState<boolean>(
    transcriptionConfig?.tagAudioEvents ?? false
  );
  const [maxChars, setMaxChars] = useState<number>(
    transcriptionConfig?.maxCharsPerLine ?? 42
  );
  const [langCode, setLangCode] = useState<string>(
    transcriptionConfig?.languageCode || ""
  );

  // Transcribing task state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Subtitle editor state
  const [rawSrt, setRawSrt] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"cues" | "srt" | "vtt" | "txt">(
    "cues"
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Media player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const isConfigured = transcriptionConfig?.keyStatus === "saved";

  // Preload initial media if supplied
  useEffect(() => {
    if (!open) return;

    if (initialMedia) {
      if (initialMedia.type === "file" && initialMedia.filePath) {
        setInputMode("file");
        setSelectedFile(initialMedia.filePath);
        setMediaTitle(
          initialMedia.title ||
            initialMedia.filePath.split(/[\\/]/).pop() ||
            "Media File"
        );
      } else if (initialMedia.type === "url" && initialMedia.url) {
        setInputMode("url");
        setInputUrl(initialMedia.url);
        setMediaTitle(initialMedia.title || "Online Video");
      } else if (initialMedia.type === "subtitle" && initialMedia.filePath) {
        // Direct subtitle file view/edit
        const subPath = initialMedia.filePath;
        readSubtitleFile(subPath)
          .then((content) => {
            setRawSrt(content);
            setSelectedFile(subPath);
            setMediaTitle(
              initialMedia.title ||
                subPath.split(/[\\/]/).pop() ||
                "Subtitle"
            );
          })
          .catch((err) => {
            console.error("Failed to load subtitle file:", err);
          });
      }
    }
  }, [open, initialMedia]);

  // Sync settings defaults
  useEffect(() => {
    if (transcriptionConfig) {
      setDiarize(transcriptionConfig.diarize);
      setTagEvents(transcriptionConfig.tagAudioEvents);
      setMaxChars(transcriptionConfig.maxCharsPerLine);
      setLangCode(transcriptionConfig.languageCode || "");
    }
  }, [transcriptionConfig]);

  // Listen for progress events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onTranscriptionProgress((p) => {
      if (activeTaskId && p.taskId === activeTaskId) {
        setProgress(p);
        if (p.stage === "completed") {
          setIsProcessing(false);
          if (p.srtPath) {
            readSubtitleFile(p.srtPath)
              .then((content) => {
                setRawSrt(content);
                if (onRefreshVault) onRefreshVault();
              })
              .catch(() => {});
          }
        } else if (p.stage === "error") {
          setIsProcessing(false);
          setLastError(p.error || p.message);
        } else if (p.stage === "cancelled") {
          setIsProcessing(false);
        }
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [activeTaskId, onRefreshVault]);

  // Keyboard shortcut ESC
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isProcessing) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isProcessing, onClose]);

  // Parse SRT into structured cues
  const cues: ParsedCue[] = useMemo(() => {
    if (!rawSrt.trim()) return [];
    const blocks = rawSrt.trim().split(/\r?\n\r?\n/);
    const parsed: ParsedCue[] = [];

    const toSecs = (ts: string) => {
      const parts = ts.trim().replace(",", ".").split(":");
      if (parts.length === 3) {
        return (
          parseFloat(parts[0]) * 3600 +
          parseFloat(parts[1]) * 60 +
          parseFloat(parts[2])
        );
      }
      return 0;
    };

    blocks.forEach((block, idx) => {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        // Time line
        const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
        if (timeLineIdx !== -1) {
          const timeParts = lines[timeLineIdx].split("-->");
          const startTime = timeParts[0]?.trim() || "00:00:00,000";
          const endTime = timeParts[1]?.trim() || "00:00:00,000";
          const textLines = lines.slice(timeLineIdx + 1);

          let fullText = textLines.join(" ");
          let speaker: string | undefined = undefined;

          // Check speaker tag [Speaker 1]:
          const speakerMatch = fullText.match(/^\[(Speaker\s*\w+)\]:\s*(.*)/i);
          if (speakerMatch) {
            speaker = speakerMatch[1];
            fullText = speakerMatch[2];
          }

          parsed.push({
            id: idx + 1,
            startSec: toSecs(startTime),
            endSec: toSecs(endTime),
            startTime,
            endTime,
            speaker,
            text: fullText,
          });
        }
      }
    });

    return parsed;
  }, [rawSrt]);

  // Filtered cues based on search query
  const filteredCues = useMemo(() => {
    if (!searchQuery.trim()) return cues;
    const q = searchQuery.toLowerCase();
    return cues.filter(
      (c) =>
        c.text.toLowerCase().includes(q) ||
        (c.speaker && c.speaker.toLowerCase().includes(q))
    );
  }, [cues, searchQuery]);

  // Derived VTT and TXT text
  const rawVtt = useMemo(() => {
    if (cues.length === 0) return "";
    let out = "WEBVTT\n\n";
    cues.forEach((c, i) => {
      const vttStart = c.startTime.replace(",", ".");
      const vttEnd = c.endTime.replace(",", ".");
      out += `${i + 1}\n${vttStart} --> ${vttEnd}\n${
        c.speaker ? `[${c.speaker}]: ` : ""
      }${c.text}\n\n`;
    });
    return out.trim();
  }, [cues]);

  const rawTxt = useMemo(() => {
    if (cues.length === 0) return "";
    let out = "";
    let lastSpeaker: string | undefined = undefined;

    cues.forEach((c) => {
      if (c.speaker && c.speaker !== lastSpeaker) {
        out += `\n\n[${c.speaker}]\n`;
        lastSpeaker = c.speaker;
      }
      out += `${c.text} `;
    });
    return out.trim();
  }, [cues]);

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Actions
  const handleSelectFile = async () => {
    const file = await pickMediaFile();
    if (file) {
      setSelectedFile(file);
      const name = file.split(/[\\/]/).pop() || "Media File";
      setMediaTitle(name);
    }
  };

  const handleStart = async () => {
    if (!isConfigured) {
      onOpenSettings();
      return;
    }

    setLastError(null);
    setIsProcessing(true);

    try {
      if (inputMode === "file") {
        if (!selectedFile) {
          throw new Error("Pilih berkas video atau audio terlebih dahulu.");
        }
        const taskId = await startTranscriptionForFile({
          filePath: selectedFile,
          languageCode: langCode.trim() || undefined,
          customName: mediaTitle.trim() || undefined,
        });
        setActiveTaskId(taskId);
      } else {
        if (!inputUrl.trim()) {
          throw new Error("Masukkan tautan URL video terlebih dahulu.");
        }
        const taskId = await startTranscription({
          url: inputUrl.trim(),
          languageCode: langCode.trim() || undefined,
          customName: mediaTitle.trim() || undefined,
        });
        setActiveTaskId(taskId);
      }
    } catch (err: unknown) {
      setIsProcessing(false);
      setLastError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancel = async () => {
    if (activeTaskId) {
      await cancelTranscription(activeTaskId);
      setIsProcessing(false);
      setActiveTaskId(null);
    }
  };

  const handleSeek = (timeSec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeSec;
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else if (audioRef.current) {
      audioRef.current.currentTime = timeSec;
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleCopy = (text: string, format: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  const handleDownloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveToDisk = async () => {
    if (selectedFile && rawSrt) {
      let targetPath = selectedFile;
      if (!targetPath.endsWith(".srt")) {
        const dotIdx = targetPath.lastIndexOf(".");
        targetPath =
          dotIdx !== -1
            ? `${targetPath.substring(0, dotIdx)}.srt`
            : `${targetPath}.srt`;
      }
      const ok = await saveSubtitleFile(targetPath, rawSrt);
      if (ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
        if (onRefreshVault) onRefreshVault();
      }
    }
  };

  const isVideo = selectedFile
    ? /\.(mp4|mkv|webm|mov|avi|flv)$/i.test(selectedFile)
    : false;
  const isAudio = selectedFile
    ? /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(selectedFile)
    : false;

  const mediaSrc = selectedFile
    ? isTauriEnvironment()
      ? convertFileSrc(selectedFile)
      : selectedFile
    : null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#09090b] text-[#f4f4f5] select-none font-sans overflow-hidden animate-in fade-in duration-200">
      {/* Top Header */}
      <header className="h-14 border-b border-[#27272a] bg-[#121215] px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Sparkles className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight">
                AI Transcript Studio
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30">
                ElevenLabs Scribe v2
              </span>
            </div>
            <p className="text-[11px] text-[#71717a]">
              Transkripsi video & audio otomatis, speaker diarization, dan editor subtitel
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Key status indicator */}
          {!isConfigured ? (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>API Key Belum Disetel</span>
            </button>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-medium">
              <Check className="w-3.5 h-3.5" />
              <span>Scribe Ready</span>
            </div>
          )}

          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-lg bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Pengaturan Transkripsi"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Tutup Studio (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Studio Workspace: 2-Panel Split */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* ================= LEFT PANEL: Media Input & Configuration ================= */}
        <div className="w-full md:w-[420px] lg:w-[460px] border-r border-[#27272a] bg-[#0e0e11] flex flex-col overflow-y-auto p-4 gap-4 shrink-0">
          {/* Input Source Switcher */}
          <div className="flex items-center gap-1 p-1 bg-[#18181b] border border-[#27272a] rounded-xl text-xs">
            <button
              onClick={() => setInputMode("file")}
              className={`flex-1 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                inputMode === "file"
                  ? "bg-blue-600 text-white shadow"
                  : "text-[#a1a1aa] hover:text-white"
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Berkas Lokal</span>
            </button>
            <button
              onClick={() => setInputMode("url")}
              className={`flex-1 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                inputMode === "url"
                  ? "bg-blue-600 text-white shadow"
                  : "text-[#a1a1aa] hover:text-white"
              }`}
            >
              <FileVideo className="w-3.5 h-3.5" />
              <span>Tautan Video</span>
            </button>
          </div>

          {/* Dropper / File Picker */}
          {inputMode === "file" ? (
            <div
              onClick={handleSelectFile}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  const file = e.dataTransfer.files[0];
                  // In electron/browser path is available on file
                  const path =
                    (file as unknown as { path?: string }).path || file.name;
                  setSelectedFile(path);
                  setMediaTitle(file.name);
                }
              }}
              className="p-5 border-2 border-dashed border-[#27272a] hover:border-blue-500/50 bg-[#121215] hover:bg-[#16161b] rounded-2xl flex flex-col items-center justify-center text-center gap-2.5 transition-all cursor-pointer group"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                  {selectedFile
                    ? "Ganti Berkas Media"
                    : "Tarik & Lepas Berkas Media ke Sini"}
                </p>
                <p className="text-[11px] text-[#71717a] mt-0.5">
                  Dukung MP4, MKV, WebM, MOV, MP3, WAV, M4A, AAC
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-[#a1a1aa]">
                Tautan Video / Media (YouTube, TikTok, Instagram, Threads, dll)
              </label>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#121215] border border-[#27272a] focus:border-blue-500 focus:outline-none text-xs text-white placeholder-[#52525b]"
              />
            </div>
          )}

          {/* Selected Media Preview Player */}
          {selectedFile && (
            <div className="p-3.5 rounded-xl bg-[#141418] border border-[#27272a] flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                  {isVideo ? (
                    <FileVideo className="w-4 h-4" />
                  ) : isAudio ? (
                    <FileAudio className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-white truncate">
                      {mediaTitle || selectedFile.split(/[\\/]/).pop()}
                    </p>
                    {duration > 0 && (
                      <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                        {formatTime(currentTime)} / {formatTime(duration)}
                        {isPlaying ? " • Playing" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[#71717a] font-mono truncate">
                    {selectedFile}
                  </p>
                </div>
              </div>

              {/* Media Player element */}
              {mediaSrc && (isVideo || isAudio) && (
                <div className="rounded-lg overflow-hidden bg-black/60 border border-[#27272a]">
                  {isVideo ? (
                    <video
                      ref={videoRef}
                      src={mediaSrc}
                      controls
                      className="w-full max-h-48 object-contain"
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onTimeUpdate={(e) =>
                        setCurrentTime(e.currentTarget.currentTime)
                      }
                      onLoadedMetadata={(e) =>
                        setDuration(e.currentTarget.duration)
                      }
                    />
                  ) : (
                    <div className="p-2.5 flex items-center gap-2">
                      <audio
                        ref={audioRef}
                        src={mediaSrc}
                        controls
                        className="w-full h-8"
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onTimeUpdate={(e) =>
                          setCurrentTime(e.currentTarget.currentTime)
                        }
                        onLoadedMetadata={(e) =>
                          setDuration(e.currentTarget.duration)
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Advanced Transcription Settings */}
          <div className="p-3.5 rounded-xl bg-[#121215] border border-[#27272a] flex flex-col gap-3">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-blue-400" />
              <span>Pengaturan Model & Format</span>
            </span>

            {/* Diarization Toggle */}
            <label className="flex items-center justify-between text-xs cursor-pointer group">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-[#71717a] group-hover:text-blue-400 transition-colors" />
                <span className="text-[#d4d4d8]">Speaker Diarization</span>
              </div>
              <input
                type="checkbox"
                checked={diarize}
                onChange={(e) => setDiarize(e.target.checked)}
                className="w-4 h-4 rounded border-[#3f3f46] text-blue-600 focus:ring-0 cursor-pointer"
              />
            </label>

            {/* Audio Events Toggle */}
            <label className="flex items-center justify-between text-xs cursor-pointer group">
              <div className="flex items-center gap-2">
                <Mic className="w-3.5 h-3.5 text-[#71717a] group-hover:text-blue-400 transition-colors" />
                <span className="text-[#d4d4d8]">Tandai Reaksi Audio ([applause])</span>
              </div>
              <input
                type="checkbox"
                checked={tagEvents}
                onChange={(e) => setTagEvents(e.target.checked)}
                className="w-4 h-4 rounded border-[#3f3f46] text-blue-600 focus:ring-0 cursor-pointer"
              />
            </label>

            {/* Max Characters Per Line */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-[#27272a]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#71717a]">Karakter per Baris</span>
                <span className="font-mono text-white font-bold">{maxChars}</span>
              </div>
              <input
                type="range"
                min={25}
                max={80}
                value={maxChars}
                onChange={(e) => setMaxChars(parseInt(e.target.value, 10))}
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>

            {/* Language Code */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-[#27272a]">
              <span className="text-[11px] text-[#71717a]">Kode Bahasa (Opsional)</span>
              <input
                type="text"
                value={langCode}
                onChange={(e) => setLangCode(e.target.value)}
                placeholder="Kosongkan untuk otomatis (atau misal: en, id, ja)"
                className="w-full px-3 py-1.5 rounded-lg bg-[#18181b] border border-[#27272a] text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Progress / Status display */}
          {isProcessing && progress && (
            <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/25 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-blue-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{progress.message}</span>
                </span>
                <span className="font-mono font-bold text-white">
                  {Math.round(progress.percent)}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[#27272a] overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {lastError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{lastError}</span>
            </div>
          )}

          {/* Action Button: Start / Cancel */}
          <div className="mt-auto pt-2">
            {isProcessing ? (
              <button
                type="button"
                onClick={handleCancel}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 transition-colors cursor-pointer"
              >
                Batalkan Proses Transkripsi
              </button>
            ) : (
              <button
                type="button"
                disabled={inputMode === "file" ? !selectedFile : !inputUrl.trim()}
                onClick={handleStart}
                className="w-full py-3 rounded-xl text-xs font-bold bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Mulai Transkripsi Sekarang</span>
              </button>
            )}
          </div>
        </div>

        {/* ================= RIGHT PANEL: Interactive Subtitle Editor & Export ================= */}
        <div className="flex-1 bg-[#09090b] flex flex-col overflow-hidden">
          {/* Subtitle Tabs & Search Toolbar */}
          <div className="h-12 border-b border-[#27272a] bg-[#121215] px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("cues")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "cues"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                Subtitel ({cues.length} Cues)
              </button>
              <button
                onClick={() => setActiveTab("srt")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "srt"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                SRT Mentah
              </button>
              <button
                onClick={() => setActiveTab("vtt")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "vtt"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                WebVTT
              </button>
              <button
                onClick={() => setActiveTab("txt")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === "txt"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                Teks Bacaan (TXT)
              </button>
            </div>

            {/* Search Input for Cues */}
            {activeTab === "cues" && (
              <div className="relative w-48 sm:w-60">
                <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari kata kunci cue..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#18181b] border border-[#27272a] focus:border-blue-500 focus:outline-none text-xs text-white placeholder-[#71717a]"
                />
              </div>
            )}
          </div>

          {/* Editor Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {cues.length === 0 && !rawSrt ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#71717a] gap-3">
                <div className="w-16 h-16 rounded-2xl bg-[#121215] border border-[#27272a] flex items-center justify-center text-[#52525b]">
                  <FileText className="w-8 h-8" />
                </div>
                <div className="max-w-md">
                  <h3 className="text-sm font-bold text-white mb-1">
                    Belum Ada Transkrip
                  </h3>
                  <p className="text-xs leading-relaxed">
                    Pilih berkas media lokal di panel kiri atau masukkan URL video, lalu klik{" "}
                    <span className="text-blue-400 font-semibold">Mulai Transkripsi</span> untuk menghasilkan teks subtitel otomatis.
                  </p>
                </div>
              </div>
            ) : activeTab === "cues" ? (
              <div className="flex flex-col gap-2 max-w-4xl mx-auto">
                {filteredCues.map((cue) => (
                  <div
                    key={cue.id}
                    className="p-3 rounded-xl bg-[#121215] border border-[#27272a] hover:border-[#3f3f46] transition-all flex flex-col gap-1.5 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#18181b] text-[#71717a]">
                          #{cue.id}
                        </span>

                        {cue.speaker && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400">
                            {cue.speaker}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSeek(cue.startSec)}
                          className="flex items-center gap-1 text-[11px] font-mono text-[#a1a1aa] hover:text-blue-400 cursor-pointer"
                          title="Lompat ke waktu ini pada pemutar"
                        >
                          <Play className="w-2.5 h-2.5" />
                          <span>{cue.startTime}</span>
                          <span>→</span>
                          <span>{cue.endTime}</span>
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-white leading-relaxed selection:bg-blue-500/30 pl-0.5">
                      {cue.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : activeTab === "srt" ? (
              <textarea
                value={rawSrt}
                onChange={(e) => setRawSrt(e.target.value)}
                className="w-full h-full bg-[#121215] border border-[#27272a] rounded-xl p-4 font-mono text-xs text-[#d4d4d8] focus:border-blue-500 focus:outline-none resize-none leading-relaxed"
              />
            ) : activeTab === "vtt" ? (
              <textarea
                value={rawVtt}
                readOnly
                className="w-full h-full bg-[#121215] border border-[#27272a] rounded-xl p-4 font-mono text-xs text-[#d4d4d8] focus:outline-none resize-none leading-relaxed"
              />
            ) : (
              <textarea
                value={rawTxt}
                readOnly
                className="w-full h-full bg-[#121215] border border-[#27272a] rounded-xl p-4 font-sans text-xs text-[#d4d4d8] focus:outline-none resize-none leading-relaxed"
              />
            )}
          </div>

          {/* Export Toolbar Footer */}
          {cues.length > 0 && (
            <footer className="h-14 border-t border-[#27272a] bg-[#121215] px-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#71717a]">
                  Total {cues.length} Cues ({rawTxt.split(/\s+/).length} Kata)
                </span>
                {savedSuccess && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>Disimpan ke Vault!</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(rawTxt, "txt")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#d4d4d8] hover:text-white transition-colors cursor-pointer"
                >
                  {copiedFormat === "txt" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Salin Teks</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadFile(rawSrt, `${mediaTitle || "transcript"}.srt`)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#d4d4d8] hover:text-white transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh .SRT</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadFile(rawVtt, `${mediaTitle || "transcript"}.vtt`)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#d4d4d8] hover:text-white transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh .VTT</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveToDisk}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Simpan ke Media Vault</span>
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
};
