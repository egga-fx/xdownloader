import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Scissors,
  X,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Repeat,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileVideo,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  TrimmerSource,
} from "../types";
import {
  formatDuration,
  secondsToTimestamp,
  getErrorMessage,
  validateTrimRange,
} from "../lib/utils";
import {
  trimLocalVideoExact,
  trimStreamVideoExact,
  openInExplorer,
  getYouTubeEmbedUrl,
  pickMediaFile,
  convertLocalFileSrc,
} from "../lib/tauri-api";

interface VideoTrimmerModalProps {
  open: boolean;
  onClose: () => void;
  source?: TrimmerSource | null;
  outputFolder?: string;
  onSuccess?: () => void;
}

const QUICK_PRESETS = [
  { label: "15s (Stories)", sec: 15 },
  { label: "30s (Reels / TikTok)", sec: 30 },
  { label: "59s (Shorts)", sec: 59 },
  { label: "90s (Clips)", sec: 90 },
];

export const VideoTrimmerModal: React.FC<VideoTrimmerModalProps> = ({
  open,
  onClose,
  source,
  outputFolder,
  onSuccess,
}) => {
  // Video element ref & playback states
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Internal source state (allows uploading/picking a video file inside trimmer)
  const [internalSource, setInternalSource] = useState<TrimmerSource | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isLoopingTrim, setIsLoopingTrim] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Trimming range state (in seconds)
  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number>(30);

  // Playback URL resolution
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  // Execution state
  const [trimming, setTrimming] = useState<boolean>(false);
  const [completedFilePath, setCompletedFilePath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Dragging interaction state for scrubber handles
  const [draggingHandle, setDraggingHandle] = useState<"start" | "end" | "playhead" | null>(null);

  // Sync internalSource with source prop when modal opens or source changes
  useEffect(() => {
    if (open) {
      setInternalSource(source || null);
    } else {
      setInternalSource(null);
      setIsDraggingFile(false);
    }
  }, [open, source]);

  const effectiveSource = internalSource || source;

  // Determine current video details
  const videoDetails = useMemo(() => {
    if (effectiveSource) {
      if (effectiveSource.type === "local") {
        return {
          type: "local" as const,
          title: effectiveSource.record?.title || effectiveSource.title || "Local Video",
          filePath: effectiveSource.record?.filePath || effectiveSource.filePath || "",
          thumbnail: effectiveSource.record?.thumbnailUrl || effectiveSource.thumbnail || "",
          duration: effectiveSource.record?.durationSec || effectiveSource.duration || 0,
        };
      }
      return {
        type: "online" as const,
        title: effectiveSource.info?.title || "Online Video",
        url: effectiveSource.url,
        thumbnail: effectiveSource.info?.thumbnail || "",
        duration: effectiveSource.info?.duration || 0,
        author: effectiveSource.info?.uploader || effectiveSource.info?.channel || "",
      };
    }

    return {
      type: "none" as const,
      title: "No video selected",
      url: "",
      filePath: "",
      thumbnail: "",
      duration: 0,
      author: "",
    };
  }, [effectiveSource]);

  // Load video playback URL whenever modal opens or source changes
  useEffect(() => {
    if (!open) {
      setIsPlaying(false);
      setTrimming(false);
      setCompletedFilePath(null);
      setErrorMsg(null);
      setPlaybackUrl(null);
      return;
    }

    if (videoDetails.type === "local" && videoDetails.filePath) {
      const directConverted = convertLocalFileSrc(videoDetails.filePath);
      setPlaybackUrl(directConverted);
    } else {
      setPlaybackUrl(null);
    }

    // Initialize trim range based on source duration
    const initialDuration = videoDetails.duration > 0 ? videoDetails.duration : 60;
    setDuration(initialDuration);
    setStartSec(0);
    setEndSec(Math.min(initialDuration, 30));
    setCurrentTime(0);
  }, [open, videoDetails]);

  // Pick/Upload video file handler
  const handlePickOrUploadVideo = async () => {
    if (trimming) return;

    // 1. Try native desktop picker in Tauri
    const pickedPath = await pickMediaFile();
    if (pickedPath) {
      const fileName = pickedPath.split(/[/\\]/).pop() || "Selected Video";
      const newSource: TrimmerSource = {
        type: "local",
        title: fileName,
        filePath: pickedPath,
        duration: 0,
      };
      setInternalSource(newSource);
      setPlaybackUrl(convertLocalFileSrc(pickedPath));
      setErrorMsg(null);
      setCompletedFilePath(null);
      return;
    }

    // 2. Fallback to HTML input file
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const filePath = (file as unknown as { path?: string }).path || file.name;
    const objectUrl = URL.createObjectURL(file);
    const newSource: TrimmerSource = {
      type: "local",
      title: file.name,
      filePath: filePath,
      duration: 0,
    };
    setInternalSource(newSource);
    setPlaybackUrl(objectUrl);
    setErrorMsg(null);
    setCompletedFilePath(null);
    e.target.value = "";
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const filePath = (file as unknown as { path?: string }).path || file.name;
    const objectUrl = URL.createObjectURL(file);
    const newSource: TrimmerSource = {
      type: "local",
      title: file.name,
      filePath: filePath,
      duration: 0,
    };
    setInternalSource(newSource);
    setPlaybackUrl(objectUrl);
    setErrorMsg(null);
    setCompletedFilePath(null);
  };

  // Handle video loaded metadata to sync real video duration
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const realDur = videoRef.current.duration;
      if (Number.isFinite(realDur) && realDur > 0) {
        setDuration(realDur);
        setEndSec((prevEnd) => {
          if (prevEnd > realDur || prevEnd === 30 || prevEnd === 0) {
            return Math.min(realDur, 30);
          }
          return prevEnd;
        });
      }
    }
  };

  // Video time update tracker
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    setCurrentTime(curr);

    // If loop trim is active and playhead passes endSec, loop back to startSec
    if (isLoopingTrim && curr >= endSec) {
      videoRef.current.currentTime = startSec;
      setCurrentTime(startSec);
    }
  };

  // Toggle Play/Pause
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      if (videoRef.current.currentTime >= endSec || videoRef.current.currentTime < startSec) {
        videoRef.current.currentTime = startSec;
      }
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Set In Point (Start = Current Playhead)
  const handleSetInPoint = () => {
    const newStart = Math.min(currentTime, endSec - 0.5);
    setStartSec(Math.max(0, newStart));
  };

  // Set Out Point (End = Current Playhead)
  const handleSetOutPoint = () => {
    const newEnd = Math.max(currentTime, startSec + 0.5);
    setEndSec(Math.min(duration, newEnd));
  };

  // Preview Trimmed Clip
  const handlePreviewTrimmedClip = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = startSec;
    setCurrentTime(startSec);
    videoRef.current.play().catch(() => {});
    setIsPlaying(true);
  };

  // Apply Quick Preset (e.g. 15s, 30s, 59s from startSec)
  const handleApplyPreset = (presetSeconds: number) => {
    const targetEnd = Math.min(duration, startSec + presetSeconds);
    setEndSec(targetEnd);
  };

  // Timeline drag handlers (Scrubber timeline interaction)
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const clickRatio = clickX / rect.width;
    const clickSec = clickRatio * duration;

    // Check if closer to start handle, end handle, or middle playhead
    const distToStart = Math.abs(clickSec - startSec);
    const distToEnd = Math.abs(clickSec - endSec);

    if (distToStart < 2 || (distToStart < distToEnd && distToStart < 4)) {
      setDraggingHandle("start");
    } else if (distToEnd < 2 || (distToEnd <= distToStart && distToEnd < 4)) {
      setDraggingHandle("end");
    } else {
      setDraggingHandle("playhead");
      if (videoRef.current) {
        videoRef.current.currentTime = clickSec;
      }
      setCurrentTime(clickSec);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingHandle || !timelineRef.current || duration <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clientX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const ratio = clientX / rect.width;
      const sec = ratio * duration;

      if (draggingHandle === "start") {
        const bounded = Math.max(0, Math.min(sec, endSec - 0.5));
        setStartSec(bounded);
        if (currentTime < bounded) {
          if (videoRef.current) videoRef.current.currentTime = bounded;
          setCurrentTime(bounded);
        }
      } else if (draggingHandle === "end") {
        const bounded = Math.min(duration, Math.max(sec, startSec + 0.5));
        setEndSec(bounded);
        if (currentTime > bounded) {
          if (videoRef.current) videoRef.current.currentTime = bounded;
          setCurrentTime(bounded);
        }
      } else if (draggingHandle === "playhead") {
        const bounded = Math.max(0, Math.min(sec, duration));
        if (videoRef.current) videoRef.current.currentTime = bounded;
        setCurrentTime(bounded);
      }
    };

    const handleMouseUp = () => {
      setDraggingHandle(null);
    };

    if (draggingHandle) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingHandle, duration, startSec, endSec, currentTime]);

  // Execute Trim Action (Saves with default [Name]_trim_[timestamp].mp4)
  const handleExecuteTrim = async () => {
    if (trimming || videoDetails.type === "none") return;
    setErrorMsg(null);
    setCompletedFilePath(null);

    const rangeCheck = validateTrimRange(startSec, endSec, duration);
    if (!rangeCheck.valid) {
      setErrorMsg(rangeCheck.error || "Invalid trim range.");
      return;
    }

    setTrimming(true);

    try {
      if (videoDetails.type === "local") {
        if (!videoDetails.filePath) {
          throw new Error("Source video file path is missing.");
        }
        const savedPath = await trimLocalVideoExact({
          filePath: videoDetails.filePath,
          startSec,
          endSec,
          outputFolder,
        });
        setCompletedFilePath(savedPath);
      } else {
        const targetUrl = videoDetails.url;
        if (!targetUrl) {
          throw new Error("Target video URL is missing.");
        }
        const taskId = await trimStreamVideoExact({
          url: targetUrl,
          startSec,
          endSec,
          outputFolder,
          title: videoDetails.title,
          thumbnailUrl: videoDetails.thumbnail,
          author: videoDetails.author,
        });
        setCompletedFilePath(`Task Queued: ${taskId}`);
      }

      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      console.error("Trim execution error:", err);
      setErrorMsg(getErrorMessage(err) || "Failed to trim video. Please check FFmpeg status.");
    } finally {
      setTrimming(false);
    }
  };

  if (!open) return null;

  const trimDuration = Math.max(0.1, endSec - startSec);
  const startPercent = duration > 0 ? (startSec / duration) * 100 : 0;
  const endPercent = duration > 0 ? (endSec / duration) * 100 : 100;
  const currentPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const ytEmbed = videoDetails.type === "online" && videoDetails.url ? getYouTubeEmbedUrl(videoDetails.url) : null;
  const hasVideoLoaded = Boolean(playbackUrl || ytEmbed || (videoDetails.type === "online" && videoDetails.url));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !trimming) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl bg-[#141418] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/90 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="p-3 sm:p-3.5 border-b border-[#27272a] flex items-center justify-between bg-[#18181b] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0">
              <Scissors className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white tracking-tight truncate">
                Video Trimmer
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                {videoDetails.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            {hasVideoLoaded && (
              <button
                type="button"
                onClick={handlePickOrUploadVideo}
                disabled={trimming}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                title="Pilih file video lain dari komputer"
              >
                <Upload className="w-3 h-3 text-zinc-300" />
                <span>Ganti Video</span>
              </button>
            )}

            <button
              onClick={onClose}
              disabled={trimming}
              className="w-7 h-7 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40 shrink-0"
              title="Tutup Trimmer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-grow overflow-y-auto p-3.5 sm:p-4 flex flex-col gap-3.5 text-xs">
          {/* 1. Media Player / Dropzone Area */}
          <div className="relative w-full rounded-xl overflow-hidden border border-[#27272a] bg-[#0c0c10] flex items-center justify-center">
            {/* Hidden File Input for fallback upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/x-matroska,video/quicktime,video/webm,video/avi,video/x-msvideo,video/*"
              onChange={handleFileInputChange}
              className="hidden"
            />

            {playbackUrl ? (
              <div className="relative w-full aspect-video max-h-[300px] bg-black flex items-center justify-center group">
                <video
                  ref={videoRef}
                  src={playbackUrl}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  muted={isMuted}
                  playsInline
                  onClick={togglePlay}
                  className="w-full h-full object-contain cursor-pointer"
                />

                {/* Video Controls Overlay (for HTML5 Video) */}
                <div className="absolute bottom-2 left-2 right-2 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-sm border border-zinc-800 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="p-1 rounded text-zinc-300 hover:text-white cursor-pointer"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-1 rounded text-zinc-300 hover:text-white cursor-pointer"
                    >
                      {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsLoopingTrim(!isLoopingTrim)}
                      className={`p-1 rounded cursor-pointer transition-colors ${
                        isLoopingTrim ? "text-white font-bold" : "text-zinc-500 hover:text-white"
                      }`}
                      title="Loop Trimmed Segment"
                    >
                      <Repeat className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="font-mono text-[11px] text-zinc-300 flex items-center gap-1">
                    <span className="text-white font-semibold">{secondsToTimestamp(currentTime)}</span>
                    <span className="text-zinc-600">/</span>
                    <span>{secondsToTimestamp(duration)}</span>
                  </div>
                </div>
              </div>
            ) : ytEmbed ? (
              <div className="relative w-full aspect-video max-h-[300px] bg-black">
                <iframe
                  src={ytEmbed}
                  title={videoDetails.title}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : videoDetails.type === "online" ? (
              <div className="relative w-full h-52 sm:h-60 flex flex-col items-center justify-center bg-[#09090b]">
                {videoDetails.thumbnail && (
                  <img
                    src={videoDetails.thumbnail}
                    alt={videoDetails.title}
                    className="w-full h-full object-cover opacity-25 absolute inset-0 pointer-events-none"
                  />
                )}
                <div className="relative z-10 flex flex-col items-center gap-2 text-center p-4 bg-zinc-900/80 backdrop-blur-sm rounded-xl border border-zinc-800 max-w-sm">
                  <FileVideo className="w-6 h-6 text-zinc-300" />
                  <p className="font-bold text-white text-xs">Stream Trimming Mode</p>
                  <p className="text-[11px] text-zinc-400">
                    Geser timeline di bawah untuk menentukan rentang waktu yang akan dipotong langsung dari stream.
                  </p>
                </div>
              </div>
            ) : (
              /* No video selected -> Proportional Greyscale Dropzone */
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleFileDrop}
                onClick={handlePickOrUploadVideo}
                className={`relative w-full h-52 sm:h-56 flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all border border-dashed rounded-xl ${
                  isDraggingFile
                    ? "border-zinc-400 bg-zinc-800/50"
                    : "border-zinc-800 hover:border-zinc-600 bg-zinc-900/40 hover:bg-zinc-900/70"
                }`}
              >
                <div className="w-11 h-11 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 mb-2.5 shadow-sm group-hover:scale-105 transition-transform">
                  <Upload className="w-5 h-5 text-zinc-300" />
                </div>
                <h4 className="text-xs sm:text-sm font-bold text-white mb-1">
                  Pilih atau Upload File Video
                </h4>
                <p className="text-[11px] text-zinc-400 max-w-xs mb-3.5 leading-relaxed">
                  Tarik & lepas file video ke sini, atau klik tombol di bawah untuk memilih file dari komputer Anda.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs shadow-sm transition-all">
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Pilih Video dari Komputer</span>
                </div>
                <p className="text-[10px] text-zinc-500 mt-2.5 font-medium">
                  Format: MP4, MKV, MOV, WEBM, AVI, FLV, TS
                </p>
              </div>
            )}
          </div>

          {/* 2. Timeline Scrubber */}
          <div className={`flex flex-col gap-2.5 p-3 rounded-xl bg-[#141418] border border-[#27272a] transition-opacity ${!hasVideoLoaded ? "opacity-50 pointer-events-none" : ""}`}>
            {/* Timeline Header Info */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Timeline Trimmer</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-[11px] font-semibold">
                  {secondsToTimestamp(startSec)} → {secondsToTimestamp(endSec)} ({formatDuration(trimDuration)})
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSetInPoint}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold text-[11px] border border-zinc-700 flex items-center gap-1 cursor-pointer transition-colors"
                  title="Tandai titik awal (Start) sesuai posisi video saat ini"
                >
                  <span>[ Set In</span>
                </button>
                <button
                  type="button"
                  onClick={handleSetOutPoint}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold text-[11px] border border-zinc-700 flex items-center gap-1 cursor-pointer transition-colors"
                  title="Tandai titik akhir (End) sesuai posisi video saat ini"
                >
                  <span>Set Out ]</span>
                </button>
              </div>
            </div>

            {/* Visual Multi-Handle Range Bar Track */}
            <div
              ref={timelineRef}
              onMouseDown={handleTimelineMouseDown}
              className="relative h-10 w-full bg-[#09090b] rounded-lg border border-[#27272a] overflow-hidden cursor-pointer select-none flex items-center"
            >
              {/* Left Inactive Dimmed Mask */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/75 z-10 pointer-events-none"
                style={{ width: `${startPercent}%` }}
              />

              {/* Active Trimmed Zone (Clean Greyscale Highlight) */}
              <div
                className="absolute top-0 bottom-0 bg-white/10 border-y-2 border-zinc-300 z-10 flex items-center justify-between pointer-events-none"
                style={{
                  left: `${startPercent}%`,
                  width: `${Math.max(1, endPercent - startPercent)}%`,
                }}
              >
                <div className="w-full h-full flex items-center justify-center text-[9px] font-mono font-bold tracking-wider text-zinc-300 pointer-events-none select-none">
                  TRIMMED SELECTION ({Math.round(trimDuration)}s)
                </div>
              </div>

              {/* Right Inactive Dimmed Mask */}
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/75 z-10 pointer-events-none"
                style={{ width: `${100 - endPercent}%` }}
              />

              {/* Start Handle [ */}
              <div
                className="absolute top-0 bottom-0 w-3.5 bg-zinc-200 hover:bg-white text-zinc-950 flex items-center justify-center cursor-ew-resize z-20 shadow-md transition-colors"
                style={{ left: `calc(${startPercent}% - 7px)` }}
                title={`Start: ${secondsToTimestamp(startSec)}`}
              >
                <div className="w-0.5 h-3.5 bg-zinc-800 rounded-full" />
              </div>

              {/* End Handle ] */}
              <div
                className="absolute top-0 bottom-0 w-3.5 bg-zinc-200 hover:bg-white text-zinc-950 flex items-center justify-center cursor-ew-resize z-20 shadow-md transition-colors"
                style={{ left: `calc(${endPercent}% - 7px)` }}
                title={`End: ${secondsToTimestamp(endSec)}`}
              >
                <div className="w-0.5 h-3.5 bg-zinc-800 rounded-full" />
              </div>

              {/* Playhead Indicator Needle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
                style={{ left: `${currentPercent}%` }}
              >
                <div className="w-2 h-2 bg-red-500 rounded-full -ml-[3px] -mt-0.5 shadow-sm shadow-red-500/80" />
              </div>
            </div>

            {/* Timeline Controls & Quick Presets */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[11px] font-medium text-zinc-500 mr-1">
                  Preset:
                </span>
                {QUICK_PRESETS.map((p) => (
                  <button
                    key={p.sec}
                    type="button"
                    onClick={() => handleApplyPreset(p.sec)}
                    className="px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 cursor-pointer transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePreviewTrimmedClip}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Play className="w-3 h-3 text-zinc-300" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartSec(0);
                    setEndSec(duration);
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-white cursor-pointer"
                  title="Reset ke rentang penuh"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Display */}
          {completedFilePath && (
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-xs text-white">Video Berhasil Dipotong & Disimpan!</p>
                  <p className="text-[11px] text-zinc-400 font-mono truncate max-w-sm" title={completedFilePath}>
                    {completedFilePath}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => openInExplorer(completedFilePath)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Buka Folder</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-3.5 border-t border-[#27272a] bg-[#141418] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Frame-accurate re-encoding (H.264 Presisi Milidetik)</span>
            <span className="sm:hidden">H.264 Presisi Milidetik</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={trimming}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer transition-colors disabled:opacity-40"
            >
              Batal
            </button>

            <button
              type="button"
              onClick={handleExecuteTrim}
              disabled={trimming || videoDetails.type === "none"}
              className={`px-4 sm:px-5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                trimming || videoDetails.type === "none"
                  ? "bg-zinc-800 text-zinc-500 border border-zinc-700/50 cursor-not-allowed"
                  : "bg-zinc-100 hover:bg-white text-zinc-950 shadow-sm active:scale-[0.98] cursor-pointer"
              }`}
            >
              {trimming ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600" />
                  <span>Memotong Video...</span>
                </>
              ) : videoDetails.type === "none" ? (
                <>
                  <Upload className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Pilih Video Terlebih Dahulu</span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Potong & Simpan Video</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
