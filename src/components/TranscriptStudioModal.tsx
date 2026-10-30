import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  X,
  UploadCloud,
  FileVideo,
  FileAudio,
  FileText,
  Play,
  Pause,
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
  CheckCircle2,
  Edit2,
  Volume2,
  VolumeX,
  ArrowDown,
  RotateCcw,
  HelpCircle,
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

const STUDIO_STAGES: { id: string; label: string; step: number; desc: string }[] = [
  { id: "downloading_audio", label: "Extract Audio", step: 1, desc: "Extracting audio stream" },
  { id: "uploading", label: "Cloud Upload", step: 2, desc: "Secure audio chunk transfer" },
  { id: "transcribing", label: "AI Scribe v2", step: 3, desc: "Neural speech transcription" },
  { id: "writing_files", label: "Save SRT", step: 4, desc: "Writing formatted subtitles" },
];

function getStudioStageIndex(stage?: string): number {
  switch (stage) {
    case "downloading_audio":
      return 0;
    case "uploading":
      return 1;
    case "transcribing":
      return 2;
    case "writing_files":
      return 3;
    case "completed":
      return 4;
    default:
      return 0;
  }
}

const SPEAKER_COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  "0": { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  "1": { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  "2": { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30" },
  "3": { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
  "4": { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/30" },
  "5": { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/30" },
};

function getSpeakerStyle(speaker?: string) {
  if (!speaker) return SPEAKER_COLOR_MAP["0"];
  const numMatch = speaker.match(/\d+/);
  if (numMatch) {
    const key = String(parseInt(numMatch[0], 10) % 6);
    return SPEAKER_COLOR_MAP[key] || SPEAKER_COLOR_MAP["0"];
  }
  let sum = 0;
  for (let i = 0; i < speaker.length; i++) {
    sum += speaker.charCodeAt(i);
  }
  const key = String(sum % 6);
  return SPEAKER_COLOR_MAP[key] || SPEAKER_COLOR_MAP["0"];
}

const QUICK_LANGUAGES = [
  { code: "", label: "Auto" },
  { code: "en", label: "EN" },
  { code: "id", label: "ID" },
  { code: "es", label: "ES" },
  { code: "ja", label: "JA" },
  { code: "zh", label: "ZH" },
  { code: "de", label: "DE" },
  { code: "fr", label: "FR" },
];

const PLAYBACK_RATES = [1, 1.25, 1.5, 2];

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

function serializeCuesToSrt(cuesList: ParsedCue[]): string {
  return cuesList
    .map((c, idx) => {
      const cueNum = idx + 1;
      const speakerPrefix = c.speaker ? `[${c.speaker}]: ` : "";
      return `${cueNum}\n${c.startTime} --> ${c.endTime}\n${speakerPrefix}${c.text.trim()}`;
    })
    .join("\n\n");
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
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

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
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);

  // Inline cue editing state
  const [editingCueId, setEditingCueId] = useState<number | null>(null);
  const [editCueText, setEditCueText] = useState<string>("");
  const [editCueSpeaker, setEditCueSpeaker] = useState<string>("");

  // Media player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeCueRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
        if (timeLineIdx !== -1) {
          const timeParts = lines[timeLineIdx].split("-->");
          const startTime = timeParts[0]?.trim() || "00:00:00,000";
          const endTime = timeParts[1]?.trim() || "00:00:00,000";
          const textLines = lines.slice(timeLineIdx + 1);

          let fullText = textLines.join(" ");
          let speaker: string | undefined = undefined;

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

  // Currently active cue matching media player time
  const activeCue = useMemo(() => {
    if (cues.length === 0) return null;
    return cues.find(
      (c) => currentTime >= c.startSec && currentTime < c.endSec
    ) || null;
  }, [cues, currentTime]);

  // Auto-scroll active cue into view
  useEffect(() => {
    if (autoScroll && activeCue && activeTab === "cues") {
      activeCueRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeCue, autoScroll, activeTab]);

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

  // Stats calculation
  const wordCount = useMemo(() => {
    if (!rawTxt) return 0;
    return rawTxt.split(/\s+/).filter(Boolean).length;
  }, [rawTxt]);

  const uniqueSpeakers = useMemo(() => {
    const set = new Set<string>();
    cues.forEach((c) => {
      if (c.speaker) set.add(c.speaker);
    });
    return Array.from(set);
  }, [cues]);

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Play/pause controls
  const togglePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    } else if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  // Keyboard shortcut handler: Space, Esc, /
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      if (e.key === "Escape" && !isProcessing) {
        if (editingCueId !== null) {
          setEditingCueId(null);
        } else {
          onClose();
        }
      } else if (e.code === "Space" && !isInput) {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === "/" && !isInput && activeTab === "cues") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isProcessing, onClose, togglePlayPause, editingCueId, activeTab]);

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
          throw new Error("Please select a video or audio file first.");
        }
        const taskId = await startTranscriptionForFile({
          filePath: selectedFile,
          languageCode: langCode.trim() || undefined,
          customName: mediaTitle.trim() || undefined,
        });
        setActiveTaskId(taskId);
      } else {
        if (!inputUrl.trim()) {
          throw new Error("Please enter a video URL first.");
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

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
    if (audioRef.current) audioRef.current.muted = next;
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

  // Cue Editing Handlers
  const handleStartEditCue = (cue: ParsedCue) => {
    setEditingCueId(cue.id);
    setEditCueText(cue.text);
    setEditCueSpeaker(cue.speaker || "");
  };

  const handleSaveEditCue = () => {
    if (editingCueId === null) return;
    const updated = cues.map((c) => {
      if (c.id === editingCueId) {
        return {
          ...c,
          text: editCueText.trim(),
          speaker: editCueSpeaker.trim() || undefined,
        };
      }
      return c;
    });
    setRawSrt(serializeCuesToSrt(updated));
    setEditingCueId(null);
  };

  const handleCancelEditCue = () => {
    setEditingCueId(null);
    setEditCueText("");
    setEditCueSpeaker("");
  };

  // Text formatter for audio events & search highlighting
  const renderFormattedCueText = (text: string) => {
    const audioEventRegex = /(\[[a-zA-Z\s_\-]+\])/g;
    const segments = text.split(audioEventRegex);

    return segments.map((seg, sIdx) => {
      if (seg.startsWith("[") && seg.endsWith("]")) {
        return (
          <span
            key={sIdx}
            className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded-md bg-zinc-800/90 border border-zinc-700/60 text-[10px] text-zinc-300 italic font-mono select-none"
          >
            <Mic className="w-2.5 h-2.5 text-blue-400" />
            <span>{seg.slice(1, -1)}</span>
          </span>
        );
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim();
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matchRegex = new RegExp(`(${escaped})`, "gi");
        const parts = seg.split(matchRegex);

        return (
          <React.Fragment key={sIdx}>
            {parts.map((p, pIdx) => {
              if (p.toLowerCase() === q.toLowerCase()) {
                return (
                  <mark
                    key={pIdx}
                    className="bg-amber-500/30 text-amber-200 px-1 py-0.5 rounded font-medium"
                  >
                    {p}
                  </mark>
                );
              }
              return p;
            })}
          </React.Fragment>
        );
      }

      return <React.Fragment key={sIdx}>{seg}</React.Fragment>;
    });
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
              Automated video & audio transcription, speaker diarization, and interactive subtitle editor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Key status indicator */}
          {!isConfigured ? (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>API Key Not Configured</span>
            </button>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-medium">
              <Check className="w-3.5 h-3.5" />
              <span>Scribe Ready</span>
            </div>
          )}

          {/* Keyboard Shortcuts Hint */}
          <div className="relative">
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                showShortcuts
                  ? "bg-[#27272a] text-white border-[#3f3f46]"
                  : "bg-[#18181b] hover:bg-[#27272a] border-[#27272a] text-[#a1a1aa] hover:text-white"
              }`}
              title="Keyboard Shortcuts"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {showShortcuts && (
              <div className="absolute right-0 top-10 w-64 p-3 bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl z-50 text-xs flex flex-col gap-2 animate-in fade-in zoom-in-95">
                <p className="font-bold text-white text-[11px] uppercase tracking-wider text-[#a1a1aa]">
                  Studio Shortcuts
                </p>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Play / Pause</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-[10px]">
                    Space
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Focus Search</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-[10px]">
                    /
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Close Studio</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-[10px]">
                    Esc
                  </kbd>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-lg bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Transcription Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Close Studio (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Studio Workspace: 2-Panel Split */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* ================= LEFT PANEL: Media Input & Configuration ================= */}
        <div className="w-full md:w-[400px] lg:w-[440px] border-r border-[#27272a] bg-[#0e0e11] flex flex-col overflow-y-auto p-4 gap-4 shrink-0">
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
              <span>Local File</span>
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
              <span>Video URL</span>
            </button>
          </div>

          {/* Dropper / File Picker */}
          {inputMode === "file" ? (
            <div
              onClick={handleSelectFile}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  const file = e.dataTransfer.files[0];
                  const path =
                    (file as unknown as { path?: string }).path || file.name;
                  setSelectedFile(path);
                  setMediaTitle(file.name);
                }
              }}
              className={`p-5 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center gap-2.5 transition-all cursor-pointer group ${
                isDraggingOver
                  ? "border-blue-500 bg-blue-500/10 scale-99"
                  : "border-[#27272a] hover:border-blue-500/50 bg-[#121215] hover:bg-[#16161b]"
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                  {selectedFile
                    ? "Change Media File"
                    : "Drag & Drop Media File Here"}
                </p>
                <p className="text-[11px] text-[#71717a] mt-0.5">
                  Supports MP4, MKV, WebM, MOV, MP3, WAV, M4A, AAC
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-[#a1a1aa]">
                Video / Media URL (YouTube, TikTok, Instagram, Threads, etc.)
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

          {/* Selected Media Preview & Synchronized Audio/Video Player */}
          {selectedFile && (
            <div className="p-3.5 rounded-xl bg-[#141418] border border-[#27272a] flex flex-col gap-3">
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
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[#71717a] font-mono truncate">
                    {selectedFile}
                  </p>
                </div>
              </div>

              {/* Native Media element with player controls */}
              {mediaSrc && (isVideo || isAudio) && (
                <div className="rounded-xl overflow-hidden bg-black/80 border border-[#27272a] flex flex-col">
                  {isVideo ? (
                    <video
                      ref={videoRef}
                      src={mediaSrc}
                      className="w-full max-h-44 object-contain bg-black"
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
                    <audio
                      ref={audioRef}
                      src={mediaSrc}
                      className="hidden"
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onTimeUpdate={(e) =>
                        setCurrentTime(e.currentTarget.currentTime)
                      }
                      onLoadedMetadata={(e) =>
                        setDuration(e.currentTarget.duration)
                      }
                    />
                  )}

                  {/* Compact Custom Playback Controller */}
                  <div className="p-2.5 bg-[#18181b]/95 border-t border-[#27272a] flex flex-col gap-2">
                    {/* Scrub bar */}
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      step={0.1}
                      value={currentTime}
                      onChange={(e) => handleSeek(parseFloat(e.target.value))}
                      className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                    />

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={togglePlayPause}
                          className="w-7 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-colors cursor-pointer shadow-sm"
                          title="Play / Pause (Space)"
                        >
                          {isPlaying ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSeek(0)}
                          className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
                          title="Restart media"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>

                        <button
                          type="button"
                          onClick={toggleMute}
                          className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
                          title={isMuted ? "Unmute" : "Mute"}
                        >
                          {isMuted ? (
                            <VolumeX className="w-3.5 h-3.5 text-red-400" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <span className="text-[11px] font-mono text-zinc-300 ml-1">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                      </div>

                      {/* Playback rate speed pills */}
                      <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800 text-[10px]">
                        {PLAYBACK_RATES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => handleRateChange(r)}
                            className={`px-1.5 py-0.5 rounded font-mono font-bold transition-colors cursor-pointer ${
                              playbackRate === r
                                ? "bg-blue-600 text-white"
                                : "text-zinc-400 hover:text-white"
                            }`}
                          >
                            {r}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Model & Format Settings */}
          <div className="p-3.5 rounded-xl bg-[#121215] border border-[#27272a] flex flex-col gap-3">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-blue-400" />
              <span>Model & Formatting Options</span>
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
                <span className="text-[#d4d4d8]">Tag Audio Events ([applause], [music])</span>
              </div>
              <input
                type="checkbox"
                checked={tagEvents}
                onChange={(e) => setTagEvents(e.target.checked)}
                className="w-4 h-4 rounded border-[#3f3f46] text-blue-600 focus:ring-0 cursor-pointer"
              />
            </label>

            {/* Max Characters Per Line */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-[#27272a]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#71717a]">Line Limit (Characters per Line)</span>
                <span className="font-mono text-white font-bold bg-[#18181b] px-2 py-0.5 rounded border border-[#27272a]">
                  {maxChars} chars
                </span>
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

            {/* Language Selection */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[#27272a]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#71717a]">Spoken Language</span>
                <span className="text-[10px] text-zinc-500">Auto or ISO Code</span>
              </div>

              {/* Quick Language Pills */}
              <div className="flex flex-wrap gap-1">
                {QUICK_LANGUAGES.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setLangCode(item.code)}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                      langCode === item.code
                        ? "bg-blue-600 border-blue-500 text-white font-bold shadow-sm"
                        : "bg-[#18181b] border-[#27272a] text-zinc-400 hover:text-white hover:border-[#3f3f46]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={langCode}
                onChange={(e) => setLangCode(e.target.value)}
                placeholder="Custom ISO code (e.g. en, id, ja, fr)"
                className="w-full px-3 py-1.5 rounded-lg bg-[#18181b] border border-[#27272a] text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Progress / Status display */}
          {isProcessing && (
            <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/30 shadow-lg shadow-purple-950/20 flex flex-col gap-2.5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-purple-300 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                  <span className="truncate">{progress?.message || "Transcribing speech..."}</span>
                </span>
                <span className="font-mono font-bold text-white shrink-0">
                  {Math.round(progress?.percent ?? 10)}%
                </span>
              </div>

              {/* 4-Stage Mini Stepper */}
              <div className="grid grid-cols-4 gap-1.5 py-1">
                {STUDIO_STAGES.map((s, idx) => {
                  const currentIdx = getStudioStageIndex(progress?.stage || "downloading_audio");
                  const isDone = currentIdx > idx;
                  const isCurrent = currentIdx === idx;
                  return (
                    <div
                      key={s.id}
                      className={`p-1.5 rounded-lg border text-[10px] flex flex-col gap-0.5 transition-all ${
                        isDone
                          ? "bg-purple-950/40 border-purple-500/40 text-purple-300"
                          : isCurrent
                          ? "bg-purple-500/20 border-purple-500/60 text-white font-bold shadow-sm shadow-purple-500/20"
                          : "bg-zinc-900/40 border-zinc-800/60 text-zinc-500"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono opacity-70">0{s.step}</span>
                        {isDone ? (
                          <CheckCircle2 className="w-3 h-3 text-purple-400" />
                        ) : isCurrent ? (
                          <Loader2 className="w-3 h-3 text-purple-300 animate-spin" />
                        ) : (
                          <span className="w-1 h-1 rounded-full bg-zinc-700" />
                        )}
                      </div>
                      <span className="truncate">{s.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
                <div
                  className="h-full bg-gradient-to-r from-purple-600 via-indigo-500 to-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(progress?.percent ?? 10, 5)}%` }}
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
                Cancel Transcription Process
              </button>
            ) : (
              <button
                type="button"
                disabled={inputMode === "file" ? !selectedFile : !inputUrl.trim()}
                onClick={handleStart}
                className="w-full py-3 rounded-xl text-xs font-bold bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Start Transcription</span>
              </button>
            )}
          </div>
        </div>

        {/* ================= RIGHT PANEL: Interactive Subtitle Editor & Export ================= */}
        <div className="flex-1 bg-[#09090b] flex flex-col overflow-hidden">
          {/* Subtitle Tabs & Search Toolbar */}
          <div className="h-12 border-b border-[#27272a] bg-[#121215] px-4 flex items-center justify-between shrink-0 gap-3">
            <div className="flex items-center gap-1 overflow-x-auto">
              <button
                onClick={() => setActiveTab("cues")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === "cues"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                Subtitles ({cues.length})
              </button>
              <button
                onClick={() => setActiveTab("srt")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === "srt"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                Raw SRT
              </button>
              <button
                onClick={() => setActiveTab("vtt")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === "vtt"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                WebVTT
              </button>
              <button
                onClick={() => setActiveTab("txt")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === "txt"
                    ? "bg-[#27272a] text-white"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                Plain Text
              </button>
            </div>

            {/* Right Tools: Auto-Scroll & Search */}
            <div className="flex items-center gap-2 shrink-0">
              {activeTab === "cues" && cues.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    autoScroll
                      ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                      : "bg-[#18181b] border-[#27272a] text-zinc-500 hover:text-zinc-300"
                  }`}
                  title="Toggle automatic scrolling with media playback"
                >
                  <ArrowDown className="w-3 h-3" />
                  <span className="hidden sm:inline">Auto-Scroll</span>
                </button>
              )}

              {activeTab === "cues" && (
                <div className="relative w-44 sm:w-60">
                  <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-2.5" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search keywords or speakers..."
                    className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-[#18181b] border border-[#27272a] focus:border-blue-500 focus:outline-none text-xs text-white placeholder-[#71717a]"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Search Result Counter Banner */}
          {activeTab === "cues" && searchQuery.trim() && (
            <div className="px-4 py-2 bg-[#121215] border-b border-[#27272a] flex items-center justify-between text-xs text-zinc-400">
              <span>
                Found <strong className="text-white font-mono">{filteredCues.length}</strong> matching cues
              </span>
              <button
                onClick={() => setSearchQuery("")}
                className="text-blue-400 hover:underline cursor-pointer text-[11px]"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Editor Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {cues.length === 0 && !rawSrt ? (
              isProcessing ? (
                <div className="h-full flex flex-col justify-start max-w-3xl mx-auto p-4 gap-4 animate-in fade-in duration-300">
                  {/* Processing Banner Header */}
                  <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 flex items-center justify-between gap-3 shadow-lg shadow-purple-950/10">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
                        <Sparkles className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>AI Scribe v2 Listening & Transcribing</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {Math.round(progress?.percent ?? 10)}%
                          </span>
                        </h4>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {progress?.message || "Extracting speech audio and aligning timecodes..."}
                        </p>
                      </div>
                    </div>
                    <Loader2 className="w-5 h-5 text-purple-400 animate-spin shrink-0" />
                  </div>

                  {/* Pulsing Subtitle Skeleton Cards */}
                  <div className="flex flex-col gap-2.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="p-3.5 rounded-xl bg-[#121215] border border-[#27272a] flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-4 rounded bg-zinc-800 animate-pulse" />
                            <div className="w-20 h-4 rounded-full bg-purple-500/10 border border-purple-500/20 animate-pulse" />
                          </div>
                          <div className="w-24 h-3.5 rounded bg-zinc-800 animate-pulse" />
                        </div>
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div
                            className="h-3.5 rounded bg-zinc-800/80 animate-pulse"
                            style={{ width: i % 2 === 0 ? "85%" : "70%" }}
                          />
                          <div
                            className="h-3 rounded bg-zinc-800/50 animate-pulse"
                            style={{ width: i % 2 === 0 ? "55%" : "40%" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#71717a] gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-[#121215] border border-[#27272a] flex items-center justify-center text-[#52525b]">
                    <FileText className="w-8 h-8" />
                  </div>
                  <div className="max-w-md">
                    <h3 className="text-sm font-bold text-white mb-1">
                      No Transcript Available
                    </h3>
                    <p className="text-xs leading-relaxed">
                      Select a local media file on the left panel or enter a video URL, then click{" "}
                      <span className="text-blue-400 font-semibold">Start Transcription</span> to generate automatic subtitle captions.
                    </p>
                  </div>
                </div>
              )
            ) : activeTab === "cues" ? (
              <div className="flex flex-col gap-2.5 max-w-4xl mx-auto pb-6">
                {filteredCues.map((cue) => {
                  const isActive = activeCue?.id === cue.id;
                  const isEditing = editingCueId === cue.id;
                  const speakerStyle = getSpeakerStyle(cue.speaker);

                  return (
                    <div
                      key={cue.id}
                      ref={isActive ? activeCueRef : null}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col gap-2 group relative ${
                        isActive
                          ? "bg-blue-500/10 border-blue-500/60 shadow-md shadow-blue-500/10 border-l-4 border-l-blue-500"
                          : "bg-[#121215] border-[#27272a] hover:border-[#3f3f46]"
                      }`}
                    >
                      {/* Cue Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#18181b] text-[#71717a]">
                            #{cue.id}
                          </span>

                          {/* Speaker Tag */}
                          {cue.speaker && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${speakerStyle.bg} ${speakerStyle.text} ${speakerStyle.border}`}
                            >
                              <Users className="w-2.5 h-2.5" />
                              <span>{cue.speaker}</span>
                            </span>
                          )}

                          {/* Timestamp Pill & Seek Trigger */}
                          <button
                            type="button"
                            onClick={() => handleSeek(cue.startSec)}
                            className="flex items-center gap-1 text-[11px] font-mono text-[#a1a1aa] hover:text-blue-400 transition-colors cursor-pointer bg-[#18181b] px-2 py-0.5 rounded-lg border border-[#27272a]"
                            title="Jump to this timestamp in media player"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>{cue.startTime}</span>
                            <span>→</span>
                            <span>{cue.endTime}</span>
                          </button>

                          {/* Active Playing Indicator */}
                          {isActive && isPlaying && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 animate-pulse ml-1">
                              <Volume2 className="w-3 h-3" />
                              <span>Playing</span>
                            </span>
                          )}
                        </div>

                        {/* Edit Cue Button */}
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => handleStartEditCue(cue)}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[11px] text-[#a1a1aa] hover:text-white transition-all cursor-pointer"
                            title="Edit this subtitle cue"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        )}
                      </div>

                      {/* Cue Body / Inline Editor */}
                      {isEditing ? (
                        <div className="flex flex-col gap-2 pt-1 animate-in fade-in">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-400">Speaker:</span>
                            <input
                              type="text"
                              value={editCueSpeaker}
                              onChange={(e) => setEditCueSpeaker(e.target.value)}
                              placeholder="e.g. Speaker 1"
                              className="px-2 py-1 rounded bg-[#18181b] border border-[#27272a] text-xs text-white focus:border-blue-500 focus:outline-none w-36"
                            />
                          </div>
                          <textarea
                            value={editCueText}
                            onChange={(e) => setEditCueText(e.target.value)}
                            rows={3}
                            className="w-full bg-[#18181b] border border-[#27272a] rounded-lg p-2.5 text-xs text-white focus:border-blue-500 focus:outline-none resize-none leading-relaxed"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={handleCancelEditCue}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEditCue}
                              className="px-3 py-1 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Check className="w-3 h-3" />
                              <span>Done</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          onDoubleClick={() => handleStartEditCue(cue)}
                          className="text-xs text-white leading-relaxed selection:bg-blue-500/30 pl-0.5 cursor-text"
                          title="Double click to edit cue"
                        >
                          {renderFormattedCueText(cue.text)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : activeTab === "srt" ? (
              <textarea
                value={rawSrt}
                onChange={(e) => setRawSrt(e.target.value)}
                placeholder="Raw SRT format will appear here..."
                className="w-full h-full bg-[#121215] border border-[#27272a] rounded-xl p-4 font-mono text-xs text-[#d4d4d8] focus:border-blue-500 focus:outline-none resize-none leading-relaxed"
              />
            ) : activeTab === "vtt" ? (
              <textarea
                value={rawVtt}
                readOnly
                placeholder="WebVTT format will appear here..."
                className="w-full h-full bg-[#121215] border border-[#27272a] rounded-xl p-4 font-mono text-xs text-[#d4d4d8] focus:outline-none resize-none leading-relaxed"
              />
            ) : (
              <textarea
                value={rawTxt}
                readOnly
                placeholder="Plain text transcript will appear here..."
                className="w-full h-full bg-[#121215] border border-[#27272a] rounded-xl p-4 font-sans text-xs text-[#d4d4d8] focus:outline-none resize-none leading-relaxed"
              />
            )}
          </div>

          {/* Export Toolbar Footer */}
          {cues.length > 0 && (
            <footer className="h-14 border-t border-[#27272a] bg-[#121215] px-4 flex items-center justify-between shrink-0 gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#71717a] flex items-center gap-1.5">
                  <strong className="text-white font-mono">{cues.length}</strong> Cues
                  <span>•</span>
                  <strong className="text-white font-mono">{wordCount}</strong> Words
                  {uniqueSpeakers.length > 0 && (
                    <>
                      <span>•</span>
                      <strong className="text-white font-mono">{uniqueSpeakers.length}</strong> Speakers
                    </>
                  )}
                </span>
                {savedSuccess && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1 font-semibold animate-in fade-in">
                    <Check className="w-3.5 h-3.5" />
                    <span>Saved to Media Vault!</span>
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
                  <span>Copy Text</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCopy(rawSrt, "srt")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#d4d4d8] hover:text-white transition-colors cursor-pointer"
                >
                  {copiedFormat === "srt" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Copy SRT</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadFile(rawSrt, `${mediaTitle || "transcript"}.srt`)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#d4d4d8] hover:text-white transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.SRT</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadFile(rawVtt, `${mediaTitle || "transcript"}.vtt`)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#d4d4d8] hover:text-white transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.VTT</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveToDisk}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save to Vault</span>
                </button>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
};
