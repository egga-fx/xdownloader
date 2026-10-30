import React, { useState, useEffect, useRef } from "react";
import {
  Download,
  Film,
  Music,
  User,
  ExternalLink,
  Loader2,
  FileEdit,
  Image as ImageIcon,
  Images,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Captions,
  Sparkles,
  Radio,
  RotateCcw,
  Scissors,
  MessageSquareText,
  RefreshCw,
  Clock,
  ShieldCheck,
  Terminal,
  Copy,
  Square,
  AlertTriangle,
} from "lucide-react";
import {
  ActiveDownloadTask,
  DownloaderFormatType,
  DownloaderQuality,
  LiveRecordMode,
  LiveStreamConfig,
  VideoInfo,
  TranscriptionProgress,
} from "../types";
import {
  detectPlatform,
  formatDuration,
  formatFileSize,
  formatLiveDuration,
  isLiveStreamMetadata,
} from "../lib/utils";
import { CarouselSelectionModal } from "./CarouselSelectionModal";

interface MetadataPreviewCardProps {
  info: VideoInfo;
  formatType: DownloaderFormatType;
  setFormatType: (format: DownloaderFormatType) => void;
  quality: DownloaderQuality;
  setQuality: (quality: DownloaderQuality) => void;
  customName: string;
  setCustomName: (name: string) => void;
  onDownload: (selectedIndices?: number[]) => void;
  onStartLiveRecord?: (liveConfig: LiveStreamConfig) => void;
  onStopLiveRecord?: (taskId: string) => void;
  onRefreshMetadata?: () => void;
  isRefreshingMetadata?: boolean;
  activeLiveTask?: ActiveDownloadTask | null;
  onCopyCommand?: (cmd: string) => void;
  isDownloadingCurrentUrl: boolean;
  transcriptionReady?: boolean;
  transcriptionBlockReason?: string | null;
  isTranscribing?: boolean;
  transcriptionProgress?: TranscriptionProgress | null;
  onTranscribe?: () => void;
  onOpenTranscriptionSettings?: () => void;
}

interface QualityOptionDef {
  id: DownloaderQuality;
  label: string;
  badge: string;
  desc: string;
}

const VIDEO_QUALITY_OPTIONS: QualityOptionDef[] = [
  { id: "best", label: "Original HD", badge: "MAX", desc: "Highest quality available (4K/2K/1080p)" },
  { id: "1080p", label: "1080p", badge: "FHD", desc: "Full High Definition (1920x1080)" },
  { id: "720p", label: "720p", badge: "HD", desc: "Standard High Definition (1280x720)" },
  { id: "480p", label: "480p", badge: "SD", desc: "Standard Definition, bandwidth saving (854x480)" },
  { id: "360p", label: "360p", badge: "LOW", desc: "Low resolution, smallest file size" },
];

const AUDIO_QUALITY_OPTIONS: QualityOptionDef[] = [
  { id: "mp3", label: "MP3", badge: "320K", desc: "Universal format, compatible with all players" },
  { id: "m4a", label: "M4A", badge: "AAC", desc: "Apple/AAC native format, crisp & efficient" },
  { id: "wav", label: "WAV", badge: "LOSSLESS", desc: "Uncompressed raw studio master audio" },
  { id: "flac", label: "FLAC", badge: "HI-RES", desc: "Audiophile lossless compression" },
];

const DURATION_PRESETS: { label: string; sec: number | null }[] = [
  { label: "Until Stream Ends", sec: null },
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "30m", sec: 1800 },
  { label: "1h", sec: 3600 },
  { label: "2h", sec: 7200 },
];

export const MetadataPreviewCard: React.FC<MetadataPreviewCardProps> = ({
  info,
  formatType,
  setFormatType,
  quality,
  setQuality,
  customName,
  setCustomName,
  onDownload,
  onStartLiveRecord,
  onStopLiveRecord,
  onRefreshMetadata,
  isRefreshingMetadata = false,
  activeLiveTask = null,
  isDownloadingCurrentUrl,
  transcriptionReady = false,
  transcriptionBlockReason = null,
  isTranscribing = false,
  transcriptionProgress = null,
  onTranscribe,
  onOpenTranscriptionSettings,
}) => {
  const mediaItems = info.mediaItems || [];
  const hasMultipleMedia = mediaItems.length > 1;
  const carouselVideosCount = mediaItems.filter((m) => m.kind === "video").length;
  const carouselImagesCount = mediaItems.filter((m) => m.kind === "image").length;
  const isImage =
    (info.postType === "image" || info.description === "image") &&
    carouselVideosCount === 0;
  const carouselImages: string[] =
    mediaItems.length > 0
      ? mediaItems.map((m) => m.thumbnail || m.url)
      : info.images && info.images.length > 0
      ? info.images
      : info.thumbnail
      ? [info.thumbnail]
      : [];
  const isCarousel = (isImage || hasMultipleMedia) && carouselImages.length > 1;

  const isDetectedLive = isLiveStreamMetadata(info, info.webpageUrl);
  const isYouTube = detectPlatform(info.webpageUrl) === "youtube";
  const canUseLiveStudio = !isImage && !isCarousel && (isYouTube || isDetectedLive);

  // Live Stream Studio state
  const [isLiveStudioActive, setIsLiveStudioActive] = useState<boolean>(isDetectedLive);
  const [liveMode, setLiveMode] = useState<LiveRecordMode>("record_from_now");
  const [liveDurationSec, setLiveDurationSec] = useState<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("00:00:00");
  const [rangeEnd, setRangeEnd] = useState<string>("00:30:00");
  const [forceKeyframes, setForceKeyframes] = useState<boolean>(true);
  const [downloadChat, setDownloadChat] = useState<boolean>(false);
  const [waitForStream, setWaitForStream] = useState<boolean>(info.liveStatus === "is_upcoming");
  const [waitIntervalSec] = useState<number>(600);
  const [autoReconnect, setAutoReconnect] = useState<boolean>(true);
  const [showLiveLogs, setShowLiveLogs] = useState<boolean>(false);
  const [copiedLiveLogs, setCopiedLiveLogs] = useState<boolean>(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState<number>(0);
  const recordingStartRef = useRef<number | null>(null);
  const [streamLiveDuration, setStreamLiveDuration] = useState<number>(() => {
    if (info.releaseTimestamp) {
      return Math.max(0, Math.floor(Date.now() / 1000) - info.releaseTimestamp);
    }
    return info.duration || 0;
  });

  // Track recording elapsed time every second while actively recording
  useEffect(() => {
    if (!activeLiveTask) {
      recordingStartRef.current = null;
      setRecordingElapsedSec(0);
      return;
    }
    if (recordingStartRef.current === null) {
      recordingStartRef.current = Date.now();
      setShowLiveLogs(true);
    }
    const updateElapsed = () => {
      if (recordingStartRef.current) {
        setRecordingElapsedSec(
          Math.max(0, Math.floor((Date.now() - recordingStartRef.current) / 1000))
        );
      }
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [activeLiveTask?.taskId]);

  // Keep live stream broadcast duration ticking every second when stream is currently live
  useEffect(() => {
    const isLive = info.liveStatus === "is_live" || info.isLive === true;
    if (!isLive) return;

    const calc = () => {
      if (info.releaseTimestamp) {
        setStreamLiveDuration(Math.max(0, Math.floor(Date.now() / 1000) - info.releaseTimestamp));
      } else {
        setStreamLiveDuration((prev) => (prev > 0 ? prev + 1 : 1));
      }
    };
    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [info.id, info.liveStatus, info.isLive, info.releaseTimestamp]);

  const formatElapsed = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // Sync live studio activation when videoInfo changes
  useEffect(() => {
    const detected = isLiveStreamMetadata(info, info.webpageUrl);
    setIsLiveStudioActive(detected);
    if (info.liveStatus === "is_upcoming") {
      setWaitForStream(true);
      setLiveMode("rewind_live");
    } else if (info.liveStatus === "was_live" || info.liveStatus === "post_live") {
      setWaitForStream(false);
    } else if (detected) {
      setLiveMode("record_from_now");
    }
  }, [info.id, info.webpageUrl, info.liveStatus, info.isLive]);

  const currentLiveConfig: LiveStreamConfig = {
    mode: liveMode,
    durationSec: liveMode === "record_from_now" ? liveDurationSec : null,
    timeRange:
      liveMode === "capture_time_range"
        ? { start: rangeStart.trim() || "00:00:00", end: rangeEnd.trim() || "00:30:00" }
        : null,
    downloadChat: liveMode === "chat_replay" ? true : downloadChat,
    waitForStream,
    waitIntervalSec,
    autoReconnect,
    forceKeyframes,
  };

  const getInitialIndex = (): number => {
    if (!info.webpageUrl) return 0;
    const match =
      info.webpageUrl.match(/[?&]img_index=(\d+)/) ||
      info.webpageUrl.match(/\/photo\/(\d+)/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < carouselImages.length) {
        return idx;
      }
    }
    return 0;
  };

  const [activeImageIndex, setActiveImageIndex] = useState<number>(getInitialIndex());
  const currentMediaItem = mediaItems[activeImageIndex];
  const isCurrentSlideVideo = currentMediaItem
    ? currentMediaItem.kind === "video"
    : (!isImage && !hasMultipleMedia);

  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Record<number, number>>({});
  const [imgError, setImgError] = useState<boolean>(false);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState<boolean>(false);
  const formatDropdownRef = useRef<HTMLDivElement>(null);
  const [isQualityDropdownOpen, setIsQualityDropdownOpen] = useState<boolean>(false);
  const qualityDropdownRef = useRef<HTMLDivElement>(null);

  // Close format dropdown on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        formatDropdownRef.current &&
        !formatDropdownRef.current.contains(event.target as Node)
      ) {
        setIsFormatDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFormatDropdownOpen(false);
      }
    };

    if (isFormatDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFormatDropdownOpen]);

  // Close quality dropdown on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        qualityDropdownRef.current &&
        !qualityDropdownRef.current.contains(event.target as Node)
      ) {
        setIsQualityDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsQualityDropdownOpen(false);
      }
    };

    if (isQualityDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isQualityDropdownOpen]);

  useEffect(() => {
    setActiveImageIndex(getInitialIndex());
    setAspectRatio(null);
    setAspectRatios({});
    setImgError(false);
  }, [info.id, info.webpageUrl, info.images]);

  const currentThumbnail = isCarousel
    ? carouselImages[activeImageIndex] || info.thumbnail
    : info.thumbnail;

  useEffect(() => {
    setImgError(false);
  }, [currentThumbnail]);

  useEffect(() => {
    if (isImage && formatType !== "image") {
      setFormatType("image");
      setQuality("best");
    } else if (!isImage && formatType === "image") {
      setFormatType("video");
      setQuality("best");
    }
  }, [isImage]);

  // Pre-load all carousel images and cache their natural aspect ratios in background
  useEffect(() => {
    if (isCarousel && carouselImages.length > 0) {
      carouselImages.forEach((imgUrl, idx) => {
        if (imgUrl) {
          const img = new Image();
          img.src = imgUrl;
          img.onload = () => {
            if (img.naturalWidth && img.naturalHeight) {
              const r = img.naturalWidth / img.naturalHeight;
              setAspectRatios((prev) => {
                if (prev[idx] === r) return prev;
                return { ...prev, [idx]: r };
              });
              if (idx === activeImageIndex) {
                setAspectRatio((curr) => curr ?? r);
              }
            }
          };
        }
      });
    }
  }, [carouselImages, isCarousel, activeImageIndex]);

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    const prevIdx = activeImageIndex > 0 ? activeImageIndex - 1 : carouselImages.length - 1;
    setActiveImageIndex(prevIdx);
    if (aspectRatios[prevIdx]) {
      setAspectRatio(aspectRatios[prevIdx]);
    }
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextIdx = activeImageIndex < carouselImages.length - 1 ? activeImageIndex + 1 : 0;
    setActiveImageIndex(nextIdx);
    if (aspectRatios[nextIdx]) {
      setAspectRatio(aspectRatios[nextIdx]);
    }
  };

  const isCurrentlyStreaming = info.liveStatus === "is_live" || info.isLive === true;
  const isStreamEnded = info.liveStatus === "was_live" || info.liveStatus === "post_live";

  const handleCopyLiveLogs = () => {
    if (!activeLiveTask?.recentLogs?.length) return;
    const text = activeLiveTask.recentLogs.join("\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedLiveLogs(true);
    setTimeout(() => setCopiedLiveLogs(false), 2000);
  };

  const liveStatusBadge = (() => {
    if (info.liveStatus === "is_live" || info.isLive) {
      return {
        label: "LIVE NOW",
        desc: "Stream is broadcasting live",
        dotClass: "bg-red-500 animate-ping",
        solidDotClass: "bg-red-500",
        pillClass: "bg-red-500/15 text-red-300 border-red-500/40",
      };
    }
    if (info.liveStatus === "is_upcoming") {
      const scheduledStr = info.releaseTimestamp
        ? new Date(info.releaseTimestamp * 1000).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;
      return {
        label: "UPCOMING",
        desc: scheduledStr ? `Scheduled for ${scheduledStr}` : "Waiting for broadcaster to go live",
        dotClass: "bg-amber-400 animate-pulse",
        solidDotClass: "bg-amber-400",
        pillClass: "bg-amber-500/15 text-amber-300 border-amber-500/40",
      };
    }
    if (info.liveStatus === "was_live" || info.liveStatus === "post_live") {
      return {
        label: "PAST LIVE / DVR",
        desc: "Completed broadcast • DVR & Chat Replay available",
        dotClass: "bg-blue-400",
        solidDotClass: "bg-blue-400",
        pillClass: "bg-blue-500/15 text-blue-300 border-blue-500/40",
      };
    }
    return {
      label: "STREAM STUDIO",
      desc: "Ready to record, rewind, slice, or extract live chat",
      dotClass: "bg-rose-400",
      solidDotClass: "bg-rose-400",
      pillClass: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    };
  })();

  return (
    <div className="w-full bg-[#121215] border border-[#27272a] rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-xl shadow-black/50">
      {/* Top Preview Section */}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        {/* Thumbnail / Carousel Preview */}
        <div
          className="relative w-full sm:w-auto h-52 sm:h-56 max-w-full sm:max-w-[320px] bg-[#09090b] rounded-xl overflow-hidden border border-[#27272a] shrink-0 group flex items-center justify-center transition-colors duration-150 mx-auto sm:mx-0 shadow-inner"
          style={{
            aspectRatio: aspectRatio
              ? `${aspectRatio}`
              : aspectRatios[activeImageIndex]
              ? `${aspectRatios[activeImageIndex]}`
              : isImage
              ? "1 / 1"
              : "16 / 9",
          }}
        >
          {currentThumbnail && !imgError ? (
            <>
              {/* Ambient backdrop for subtle edge blending */}
              <div
                className="absolute inset-0 bg-cover bg-center blur-md opacity-25 scale-110 pointer-events-none"
                style={{ backgroundImage: `url(${currentThumbnail})` }}
              />
              <img
                src={currentThumbnail}
                alt={info.title}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                onLoad={(e) => {
                  const { naturalWidth, naturalHeight } = e.currentTarget;
                  if (naturalWidth && naturalHeight) {
                    const r = naturalWidth / naturalHeight;
                    setAspectRatio(r);
                    setAspectRatios((prev) => ({ ...prev, [activeImageIndex]: r }));
                  }
                }}
                className="relative z-1 w-full h-full object-contain"
              />
            </>
          ) : (
            <div className="relative z-1 w-full h-full flex flex-col items-center justify-center gap-1.5 text-[#71717a] bg-[#18181b] min-h-[120px]">
              {isImage ? <ImageIcon className="w-8 h-8 opacity-60" /> : <Film className="w-8 h-8 opacity-60" />}
              <span className="text-[11px] font-medium text-zinc-500">
                {imgError ? "Preview unavailable" : "No preview"}
              </span>
            </div>
          )}

          {/* Live Status Badge on Thumbnail */}
          {(isDetectedLive || isLiveStudioActive) && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/85 backdrop-blur-md border border-red-500/40 text-[10px] font-extrabold text-white flex items-center gap-1.5 z-10 shadow-md">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${liveStatusBadge.solidDotClass}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${liveStatusBadge.solidDotClass}`} />
              </span>
              <span>{liveStatusBadge.label}</span>
            </div>
          )}

          {/* Duration badge for video */}
          {!info.isLive &&
            info.liveStatus !== "is_live" &&
            ((isCurrentSlideVideo && currentMediaItem && currentMediaItem.duration > 0) ||
              (!isCarousel && !isImage && info.duration > 0)) && (
              <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[11px] font-bold text-white flex items-center gap-1 z-10 shadow-sm border border-white/10">
                <Film className="w-3 h-3 text-blue-400" />
                <span>{formatDuration(currentMediaItem?.duration || info.duration)}</span>
              </div>
            )}

          {/* Carousel Counter Badge (Greyscale) */}
          {isCarousel && (
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md border border-white/20 text-[11px] font-bold text-white flex items-center gap-1.5 shadow-md z-10">
              <Images className="w-3 h-3 text-zinc-300" />
              <span>{activeImageIndex + 1} / {carouselImages.length}</span>
            </div>
          )}

          {/* Prev / Next buttons for carousel */}
          {isCarousel && (
            <>
              <button
                type="button"
                onClick={handlePrevImage}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center cursor-pointer transition-all opacity-80 hover:opacity-100 z-10 shadow-md"
                title="Previous photo"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextImage}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-sm border border-white/20 text-white flex items-center justify-center cursor-pointer transition-all opacity-80 hover:opacity-100 z-10 shadow-md"
                title="Next photo"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Bottom dot indicators */}
              <div className="absolute bottom-1.5 inset-x-0 flex items-center justify-center gap-1 z-10 pointer-events-none">
                {carouselImages.slice(0, 8).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-all duration-150 ${
                      idx === activeImageIndex
                        ? "w-3.5 bg-white shadow-sm"
                        : "w-1.5 bg-white/40"
                    }`}
                  />
                ))}
                {carouselImages.length > 8 && (
                  <span className="text-[9px] text-white/80 font-bold ml-0.5">+{carouselImages.length - 8}</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Video / Image Info Details */}
        <div className="flex flex-col justify-between gap-3 flex-grow min-w-0 self-stretch">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm sm:text-base font-bold text-white line-clamp-2 leading-snug">
              {info.title}
            </h2>
            <div className="flex items-center gap-2 text-xs text-[#a1a1aa] flex-wrap">
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-[#71717a]" />
                <span className="font-semibold text-blue-400">
                  {info.uploader || info.channel || "Creator"}
                </span>
              </span>
              <span>•</span>
              {isCarousel && (
                <>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-semibold flex items-center gap-1">
                    <Images className="w-2.5 h-2.5 text-zinc-400" />
                    <span>
                      {carouselVideosCount > 0 && carouselImagesCount > 0
                        ? `${carouselImages.length} Media (${carouselVideosCount} Videos, ${carouselImagesCount} Photos)`
                        : carouselVideosCount > 0
                        ? `${carouselVideosCount} Videos`
                        : `${carouselImages.length} Photos`}
                    </span>
                  </span>
                  <span>•</span>
                </>
              )}
              <a
                href={info.webpageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:underline text-[#71717a] hover:text-[#a1a1aa]"
              >
                <span>Source URL</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Format Type Selector & Live Stream Studio Toggle */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {isCarousel ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1e1e24] text-zinc-200 border border-[#3f3f46]">
                  <Images className="w-3.5 h-3.5 text-zinc-300" />
                  <span>
                    {carouselVideosCount > 0 && carouselImagesCount > 0
                      ? `Media Carousel (${carouselImages.length} Items)`
                      : carouselVideosCount > 0
                      ? `Video Carousel (${carouselVideosCount} Videos)`
                      : `Photo Carousel (${carouselImages.length} Photos)`}
                  </span>
                </div>
              ) : isImage ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1e1e24] text-zinc-200 border border-[#3f3f46]">
                  <ImageIcon className="w-3.5 h-3.5 text-zinc-300" />
                  <span>Photo (HD Lossless)</span>
                </div>
              ) : (
                <>
                  <div className="relative inline-block text-left" ref={formatDropdownRef}>
                    {/* Dropdown Trigger Button */}
                    <button
                      type="button"
                      onClick={() => setIsFormatDropdownOpen((prev) => !prev)}
                      className={`h-9 px-3 rounded-xl border flex items-center gap-2 cursor-pointer transition-all duration-150 select-none shadow-sm ${
                        isFormatDropdownOpen
                          ? formatType === "subtitle"
                            ? "bg-[#1f1f26] border-purple-500 ring-2 ring-purple-500/20 text-white"
                            : formatType === "audio"
                            ? "bg-[#1f1f26] border-emerald-500 ring-2 ring-emerald-500/20 text-white"
                            : "bg-[#1f1f26] border-blue-500 ring-2 ring-blue-500/20 text-white"
                          : "bg-[#18181c] hover:bg-[#1f1f24] border-[#27272a] hover:border-[#3f3f46] text-white"
                      }`}
                    >
                      {/* Active Icon */}
                      {formatType === "video" && (
                        <Film className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      )}
                      {formatType === "audio" && (
                        <Music className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      {formatType === "subtitle" && (
                        <Captions className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      )}

                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-[#71717a] font-normal">Format:</span>
                        <span className="text-white font-bold">
                          {formatType === "video"
                            ? "Video (MP4)"
                            : formatType === "audio"
                            ? "Audio (MP3)"
                            : "Transcript (SRT)"}
                        </span>
                      </div>

                      {/* Format Badge */}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border shrink-0 ${
                          formatType === "subtitle"
                            ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                            : formatType === "audio"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-blue-500/20 text-blue-300 border-blue-500/40"
                        }`}
                      >
                        {formatType === "video" ? "MP4" : formatType === "audio" ? "MP3" : "AI"}
                      </span>

                      <ChevronDown
                        className={`w-3.5 h-3.5 text-[#71717a] transition-transform duration-200 ${
                          isFormatDropdownOpen ? "rotate-180 text-white" : ""
                        }`}
                      />
                    </button>

                    {/* Floating Popover Menu */}
                    {isFormatDropdownOpen && (
                      <div className="absolute top-[calc(100%+6px)] left-0 z-50 w-72 sm:w-80 bg-[#16161a]/98 backdrop-blur-xl border border-[#27272a] rounded-xl shadow-2xl shadow-black/95 p-1.5 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150">
                        {/* Video Option */}
                        <button
                          type="button"
                          onClick={() => {
                            setFormatType("video");
                            if (quality === "srt") setQuality("best");
                            setIsFormatDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-2 rounded-lg text-left cursor-pointer transition-all ${
                            formatType === "video"
                              ? "bg-blue-500/15 border border-blue-500/30 text-white shadow-sm"
                              : "border border-transparent text-[#d4d4d8] hover:bg-[#202026] hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <div className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 shrink-0">
                              <Film className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-white">Video (MP4)</span>
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                  MP4
                                </span>
                              </div>
                              <span className="text-[11px] text-[#71717a] truncate">
                                Video with audio up to 4K resolution
                              </span>
                            </div>
                          </div>
                          {formatType === "video" && (
                            <Check className="w-4 h-4 text-blue-400 shrink-0 ml-1" />
                          )}
                        </button>

                        {/* Audio Option */}
                        <button
                          type="button"
                          onClick={() => {
                            setFormatType("audio");
                            setIsLiveStudioActive(false);
                            if (quality === "srt" || quality === "best") setQuality("mp3");
                            setIsFormatDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-2 rounded-lg text-left cursor-pointer transition-all ${
                            formatType === "audio"
                              ? "bg-emerald-500/15 border border-emerald-500/30 text-white shadow-sm"
                              : "border border-transparent text-[#d4d4d8] hover:bg-[#202026] hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 shrink-0">
                              <Music className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-white">Audio (MP3)</span>
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                  MP3
                                </span>
                              </div>
                              <span className="text-[11px] text-[#71717a] truncate">
                                Extract high-bitrate music & audio tracks
                              </span>
                            </div>
                          </div>
                          {formatType === "audio" && (
                            <Check className="w-4 h-4 text-emerald-400 shrink-0 ml-1" />
                          )}
                        </button>

                        {/* Transcript Option */}
                        <div
                          onClick={() => {
                            if (transcriptionReady) {
                              setFormatType("subtitle");
                              setIsLiveStudioActive(false);
                              setQuality("srt");
                              setIsFormatDropdownOpen(false);
                            } else if (onOpenTranscriptionSettings) {
                              onOpenTranscriptionSettings();
                              setIsFormatDropdownOpen(false);
                            }
                          }}
                          className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all ${
                            formatType === "subtitle"
                              ? "bg-purple-500/15 border border-purple-500/30 text-white shadow-sm cursor-pointer"
                              : !transcriptionReady
                              ? "bg-[#141418] border border-dashed border-[#2f2f38] text-[#71717a] hover:bg-[#1a1a22] cursor-pointer"
                              : "border border-transparent text-[#d4d4d8] hover:bg-[#202026] hover:text-white cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <div
                              className={`p-1.5 rounded-lg shrink-0 ${
                                transcriptionReady
                                  ? "bg-purple-500/15 text-purple-400"
                                  : "bg-zinc-800/60 text-zinc-500"
                              }`}
                            >
                              <Captions className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`font-bold text-xs ${
                                    transcriptionReady ? "text-white" : "text-zinc-300"
                                  }`}
                                >
                                  Transcript (SRT)
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                  AI Scribe
                                </span>
                              </div>
                              <span
                                className={`text-[11px] truncate ${
                                  !transcriptionReady
                                    ? "text-amber-400/90 font-medium"
                                    : "text-[#71717a]"
                                }`}
                                title={
                                  !transcriptionReady
                                    ? (transcriptionBlockReason || "API Key not configured in Settings")
                                    : "Auto subtitles (.srt, .vtt, .txt) via ElevenLabs"
                                }
                              >
                                {!transcriptionReady
                                  ? (transcriptionBlockReason || "API Key not configured in Settings")
                                  : "Auto subtitles (.srt, .vtt, .txt)"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-1">
                            {!transcriptionReady && onOpenTranscriptionSettings ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenTranscriptionSettings();
                                  setIsFormatDropdownOpen(false);
                                }}
                                className="px-2 py-1 rounded-md text-[10px] font-bold bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                                title="Open Settings to configure ElevenLabs API Key"
                              >
                                <span>Set Key</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            ) : formatType === "subtitle" ? (
                              <Check className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Record Live Stream Studio Toggle Pill */}
                  {canUseLiveStudio && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !isLiveStudioActive;
                        setIsLiveStudioActive(next);
                        if (next && formatType !== "video") {
                          setFormatType("video");
                          if (quality === "srt" || ["mp3", "m4a", "wav", "flac"].includes(quality)) {
                            setQuality("1080p");
                          }
                        }
                      }}
                      className={`h-9 px-3 rounded-xl border flex items-center gap-2 text-xs font-bold cursor-pointer transition-all select-none shadow-sm ${
                        isLiveStudioActive
                          ? "bg-red-500/15 border-red-500/50 text-red-300 ring-2 ring-red-500/20"
                          : "bg-[#18181c] hover:bg-[#1f1f24] border-[#27272a] hover:border-red-500/40 text-zinc-300 hover:text-white"
                      }`}
                      title="Open Record Live Stream Studio (yt-dlp Live Engine)"
                    >
                      <Radio className={`w-3.5 h-3.5 ${isLiveStudioActive ? "text-red-400 animate-pulse" : "text-red-400/80"}`} />
                      <span>Record Live Stream</span>
                      {isDetectedLive && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-red-500/25 text-red-200 border border-red-500/40">
                          LIVE
                        </span>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Custom Filename Input (Embedded in right column) */}
          <div className="flex items-center gap-2 bg-[#18181c] border border-[#27272a] rounded-xl px-3 py-2 focus-within:border-blue-500/60 transition-colors shadow-inner">
            <FileEdit className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Custom filename (optional)..."
              className="w-full bg-transparent border-0 text-xs text-white placeholder-[#71717a] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* RECORD LIVE STREAM STUDIO PANEL                                       */}
      {/* ===================================================================== */}
      {isLiveStudioActive && canUseLiveStudio && (
        <div className="rounded-xl bg-[#09090b] border border-[#27272a] p-3.5 flex flex-col gap-3.5 animate-in fade-in duration-150">
          {/* 1. Check Stream Status Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#27272a]/80">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold flex items-center gap-2 ${liveStatusBadge.pillClass}`}>
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${liveStatusBadge.dotClass}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${liveStatusBadge.solidDotClass}`} />
                </span>
                <span>{liveStatusBadge.label}</span>
              </div>

              {/* Current Broadcast Duration for Live Streams */}
              {isCurrentlyStreaming && (
                <div className="px-2.5 py-1 rounded-lg bg-[#18181c] border border-red-500/30 text-[11px] font-mono text-zinc-200 flex items-center gap-1.5 shadow-sm">
                  <Clock className="w-3 h-3 text-red-400" />
                  <span className="text-zinc-400 font-sans font-medium text-[10px] uppercase tracking-wider">Live:</span>
                  <span className="font-bold text-white tracking-wide">
                    {formatLiveDuration(streamLiveDuration)}
                  </span>
                </div>
              )}
            </div>

            {onRefreshMetadata && (
              <button
                type="button"
                onClick={onRefreshMetadata}
                disabled={isRefreshingMetadata}
                className="h-7 px-2.5 rounded-lg bg-[#18181c] hover:bg-[#222228] border border-[#27272a] hover:border-[#3f3f46] text-[11px] font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer transition-all self-start sm:self-auto shrink-0 disabled:opacity-50"
                title="Re-check live broadcast status via yt-dlp"
              >
                <RefreshCw className={`w-3 h-3 text-blue-400 ${isRefreshingMetadata ? "animate-spin" : ""}`} />
                <span>{isRefreshingMetadata ? "Checking..." : "Check Stream Status"}</span>
              </button>
            )}
          </div>

          {/* Streaming Live Alert Notice */}
          {isCurrentlyStreaming && (
            <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/30 flex items-center gap-2.5 text-xs text-red-300">
              <Radio className="w-4 h-4 text-red-400 shrink-0 animate-pulse" />
              <span>This stream is currently broadcasting live. Video downloads will become available once the stream has ended.</span>
            </div>
          )}

          {/* Stream Ended Notice */}
          {isStreamEnded && (
            <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center gap-2.5 text-xs text-emerald-300">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Broadcast has concluded. You can download the complete video directly at full quality below.</span>
            </div>
          )}

          {/* 2. Select Record Type (4 Cards) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Mode A: Record from Now */}
            <button
              type="button"
              onClick={() => !activeLiveTask && setLiveMode("record_from_now")}
              disabled={Boolean(activeLiveTask)}
              className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                activeLiveTask ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              } ${
                liveMode === "record_from_now"
                  ? "bg-red-500/12 border-red-500/50 text-white shadow-sm"
                  : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-300"
              }`}
            >
              <div className={`p-2 rounded-lg shrink-0 ${liveMode === "record_from_now" ? "bg-red-500/20 text-red-400" : "bg-zinc-800/80 text-zinc-400"}`}>
                <Radio className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Record from Now</span>
            </button>

            {/* Mode B: Rewind Live Stream */}
            <button
              type="button"
              onClick={() => !activeLiveTask && setLiveMode("rewind_live")}
              disabled={Boolean(activeLiveTask)}
              className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                activeLiveTask ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              } ${
                liveMode === "rewind_live"
                  ? "bg-amber-500/12 border-amber-500/50 text-white shadow-sm"
                  : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-300"
              }`}
            >
              <div className={`p-2 rounded-lg shrink-0 ${liveMode === "rewind_live" ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800/80 text-zinc-400"}`}>
                <RotateCcw className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Rewind Live Stream</span>
            </button>

            {/* Mode C: Capture Time Range */}
            <button
              type="button"
              onClick={() => !activeLiveTask && setLiveMode("capture_time_range")}
              disabled={Boolean(activeLiveTask)}
              className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                activeLiveTask ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              } ${
                liveMode === "capture_time_range"
                  ? "bg-blue-500/12 border-blue-500/50 text-white shadow-sm"
                  : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-300"
              }`}
            >
              <div className={`p-2 rounded-lg shrink-0 ${liveMode === "capture_time_range" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-800/80 text-zinc-400"}`}>
                <Scissors className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Capture Time Range</span>
            </button>

            {/* Mode D: Download Chat Replay */}
            <button
              type="button"
              onClick={() => !activeLiveTask && setLiveMode("chat_replay")}
              disabled={Boolean(activeLiveTask)}
              className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                activeLiveTask ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              } ${
                liveMode === "chat_replay"
                  ? "bg-emerald-500/12 border-emerald-500/50 text-white shadow-sm"
                  : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-300"
              }`}
            >
              <div className={`p-2 rounded-lg shrink-0 ${liveMode === "chat_replay" ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800/80 text-zinc-400"}`}>
                <MessageSquareText className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-white">Download Chat Replay</span>
            </button>
          </div>

          {/* Mode-Specific Sub-Configuration */}
          {liveMode === "record_from_now" && (
            <div className="p-2.5 rounded-xl bg-[#121215] border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-semibold">
                <Clock className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span>Capture Duration:</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {DURATION_PRESETS.map((preset) => {
                  const isSelected = liveDurationSec === preset.sec && customMinutes === "";
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setLiveDurationSec(preset.sec);
                        setCustomMinutes("");
                      }}
                      className={`h-7 px-2.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-all ${
                        isSelected
                          ? "bg-red-500/20 border-red-500/50 text-red-200"
                          : "bg-[#18181c] hover:bg-[#222228] border-[#27272a] text-zinc-400 hover:text-white"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <div className="flex items-center gap-1 bg-[#18181c] border border-[#27272a] rounded-lg px-2 h-7 focus-within:border-red-500/50">
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={customMinutes}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomMinutes(val);
                      const parsed = parseInt(val, 10);
                      if (!isNaN(parsed) && parsed > 0) {
                        setLiveDurationSec(parsed * 60);
                      } else {
                        setLiveDurationSec(null);
                      }
                    }}
                    placeholder="Custom"
                    className="w-14 bg-transparent border-0 text-[11px] text-white placeholder-[#71717a] focus:outline-none"
                  />
                  <span className="text-[10px] text-[#71717a] font-semibold">min</span>
                </div>
              </div>
            </div>
          )}

          {liveMode === "capture_time_range" && (
            <div className="p-2.5 rounded-xl bg-[#121215] border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#a1a1aa] font-semibold">Start:</span>
                  <input
                    type="text"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    placeholder="01:30:00"
                    className="w-24 h-7 px-2 rounded-lg bg-[#18181c] border border-[#27272a] text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <span className="text-zinc-600 font-bold">→</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#a1a1aa] font-semibold">End:</span>
                  <input
                    type="text"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    placeholder="02:00:00"
                    className="w-24 h-7 px-2 rounded-lg bg-[#18181c] border border-[#27272a] text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setForceKeyframes((p) => !p)}
                className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all self-start sm:self-auto ${
                  forceKeyframes
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                    : "bg-[#18181c] border-[#27272a] text-zinc-400"
                }`}
                title="Prevents audio/video sync delays and black screens at the cut point (--force-keyframes-at-cuts)"
              >
                <Check className={`w-3 h-3 ${forceKeyframes ? "opacity-100 text-blue-400" : "opacity-30"}`} />
                <span>Frame-Accurate Keyframes</span>
              </button>
            </div>
          )}

          {/* Expert Stream Options */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {liveMode !== "chat_replay" && (
                <button
                  type="button"
                  onClick={() => setDownloadChat((p) => !p)}
                  className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                    downloadChat
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Also save real-time chat logs & Super Chats as .srt and .json (--write-subs --sub-langs live_chat)"
                >
                  <MessageSquareText className="w-3 h-3" />
                  <span>+ Live Chat (.srt/.json)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setWaitForStream((p) => !p)}
                className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                  waitForStream
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                    : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200"
                }`}
                title="Automatically polls the link until an upcoming stream goes live (--wait-for-video 600)"
              >
                <Clock className="w-3 h-3" />
                <span>Idle Wait ({waitIntervalSec}s)</span>
              </button>

              <button
                type="button"
                onClick={() => setAutoReconnect((p) => !p)}
                className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                  autoReconnect
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                    : "bg-[#121215] hover:bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200"
                }`}
                title="Endless reconnect on network hiccups (--retries 10 --fragment-retries infinite)"
              >
                <ShieldCheck className="w-3 h-3" />
                <span>Auto-Reconnect</span>
              </button>
            </div>
          </div>

          {/* 3. Live Recording Telemetry Banner (When actively recording this stream) */}
          {activeLiveTask && (
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-red-950/30 to-[#121215] border border-red-500/40 flex flex-col gap-3 shadow-lg animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-red-500/20 text-red-300 border border-red-500/30">
                        REC LIVE • {formatElapsed(recordingElapsedSec)}
                      </span>
                      <span className="text-xs font-semibold text-white">
                        {activeLiveTask.progress.speedStr || "Recording stream..."}
                      </span>
                      {activeLiveTask.progress.downloadedBytes ? (
                        <span className="text-[11px] text-red-300/90 font-mono">
                          ({formatFileSize(activeLiveTask.progress.downloadedBytes)})
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {activeLiveTask.currentStep || "Capturing stream chunks to local storage • Click Stop anytime to finalize MP4"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowLiveLogs((p) => !p)}
                    className={`h-8 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                      showLiveLogs
                        ? "bg-zinc-800 border-zinc-600 text-white"
                        : "bg-[#18181c] hover:bg-[#222228] border-[#27272a] text-zinc-300"
                    }`}
                    title="Toggle real-time process logs"
                  >
                    <Terminal className="w-3.5 h-3.5 text-blue-400" />
                    <span>Logs ({activeLiveTask.recentLogs?.length || 0})</span>
                  </button>

                  {onStopLiveRecord && (
                    <button
                      type="button"
                      onClick={() => onStopLiveRecord(activeLiveTask.taskId)}
                      disabled={activeLiveTask.progress?.etaStr === "Saving"}
                      className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shrink-0 shadow-md shadow-red-600/25 disabled:opacity-75"
                      title="Stop live capture now and remux recorded chunks into a playable MP4 file"
                    >
                      <Square className="w-3 h-3 fill-current animate-pulse text-white" />
                      <span>
                        {activeLiveTask.progress?.etaStr === "Saving"
                          ? "Finalizing..."
                          : `Stop Recording (${formatElapsed(recordingElapsedSec)})`}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* Fragment capture progress bar */}
              <div className="w-full h-1.5 bg-zinc-800/80 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 animate-pulse transition-all duration-300"
                  style={{
                    width: liveDurationSec
                      ? `${Math.min(100, Math.max(3, Math.round((recordingElapsedSec / liveDurationSec) * 100)))}%`
                      : "100%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Real-time process logs terminal */}
          {activeLiveTask && showLiveLogs && (
            <div className="rounded-xl bg-[#09090b] border border-zinc-800 p-3 flex flex-col gap-2 font-mono text-[11px] animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Terminal className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-semibold text-zinc-200">Recording Process Logs</span>
                  <span className="text-[10px] text-zinc-500 font-sans">
                    ({activeLiveTask.recentLogs?.length || 0} events)
                  </span>
                </div>
                {activeLiveTask.recentLogs && activeLiveTask.recentLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCopyLiveLogs}
                    className="h-6 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] font-sans font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    {copiedLiveLogs ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                    <span>{copiedLiveLogs ? "Copied" : "Copy"}</span>
                  </button>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1 font-mono text-[11px] scrollbar-thin scrollbar-thumb-zinc-700">
                {activeLiveTask.recentLogs && activeLiveTask.recentLogs.length > 0 ? (
                  activeLiveTask.recentLogs.map((log, idx) => (
                    <div key={idx} className="text-zinc-300 leading-relaxed break-all">
                      <span className="text-zinc-600 select-none mr-2 font-mono">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      {log}
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500 italic py-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                    <span>Connecting to stream and buffering initial fragments...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Live Task Error Banner */}
          {activeLiveTask?.error && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/60 text-xs text-red-200 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-bold text-red-100">Recording Error</span>
                  <span className="text-red-300/90 break-all">{activeLiveTask.error}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quality Options & Action Buttons Toolbar */}
      <div className="pt-3 border-t border-[#27272a] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Quality Section: Direct buttons/badge without label, matching h-10 height */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isImage ? (
            <div
              className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-zinc-700 bg-zinc-800/90 text-zinc-200 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
              title="Original Resolution (Lossless)"
            >
              <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
              <span>Original</span>
            </div>
          ) : formatType === "subtitle" && !isLiveStudioActive ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <div
                className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-purple-500/30 bg-purple-500/10 text-purple-300 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
                title="ElevenLabs AI Speech-to-Text Model"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>ElevenLabs Scribe v2</span>
              </div>
              <div
                className="h-10 px-3.5 rounded-xl font-medium text-xs border border-[#27272a] bg-[#18181c] text-[#a1a1aa] flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                title="Automatically generated transcript format"
              >
                <span>Format:</span>
                <span className="font-bold text-white">SRT</span>
                <span>·</span>
                <span className="font-bold text-white">VTT</span>
                <span>·</span>
                <span className="font-bold text-white">TXT</span>
              </div>
            </div>
          ) : (
            <div className="relative inline-block text-left" ref={qualityDropdownRef}>
              <button
                type="button"
                onClick={() => setIsQualityDropdownOpen((prev) => !prev)}
                className={`h-10 px-3.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all duration-150 select-none shadow-sm shrink-0 ${
                  isQualityDropdownOpen
                    ? "bg-[#1f1f26] border-blue-500 ring-2 ring-blue-500/20 text-white"
                    : "bg-[#18181c] hover:bg-[#1f1f24] border-[#27272a] hover:border-[#3f3f46] text-white"
                }`}
                title="Select media quality or resolution"
              >
                {formatType === "video" || isLiveStudioActive ? (
                  <Film className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                ) : (
                  <Music className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}

                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-[#71717a] font-normal">Quality:</span>
                  <span className="text-white font-bold uppercase">
                    {quality === "best" ? "Original HD" : quality}
                  </span>
                </div>

                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#71717a] transition-transform duration-200 ${
                    isQualityDropdownOpen ? "rotate-180 text-white" : ""
                  }`}
                />
              </button>

              {isQualityDropdownOpen && (
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-64 sm:w-72 origin-bottom-left bg-[#16161a]/98 backdrop-blur-xl border border-[#27272a] rounded-xl shadow-2xl shadow-black/95 p-1.5 flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 zoom-in-95 duration-150">
                  <div className="px-2.5 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-[#27272a]/60">
                    {formatType === "video" || isLiveStudioActive ? "Video Resolution Options" : "Audio Format Options"}
                  </div>
                  {(formatType === "video" || isLiveStudioActive ? VIDEO_QUALITY_OPTIONS : AUDIO_QUALITY_OPTIONS).map((opt) => {
                    const isSelected = quality === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setQuality(opt.id as DownloaderQuality);
                          setIsQualityDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-lg text-left cursor-pointer transition-all ${
                          isSelected
                            ? "bg-blue-500/15 border border-blue-500/30 text-white shadow-sm"
                            : "border border-transparent text-[#d4d4d8] hover:bg-[#202026] hover:text-white"
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-white uppercase">{opt.label}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold border ${
                                isSelected
                                  ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                                  : "bg-zinc-800 text-zinc-400 border-zinc-700"
                              }`}
                            >
                              {opt.badge}
                            </span>
                          </div>
                          <span className="text-[10px] text-[#71717a] line-clamp-1 mt-0.5">{opt.desc}</span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons: Proportionate, single-line, aligned */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
          {isCarousel && (
            <>
              {/* Button Select Media / Photos */}
              <button
                type="button"
                onClick={() => setIsSelectionModalOpen(true)}
                disabled={isDownloadingCurrentUrl}
                className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-zinc-700 bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40 whitespace-nowrap shrink-0 active:scale-98 shadow-sm"
                title={carouselVideosCount > 0 ? "Select specific media items to download" : "Select specific photos to download"}
              >
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>{carouselVideosCount > 0 ? "Select Media" : "Select Photos"}</span>
              </button>

              {/* Quick Download Active Slide */}
              <button
                type="button"
                onClick={() => onDownload([activeImageIndex])}
                disabled={isDownloadingCurrentUrl}
                className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-zinc-700 bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40 whitespace-nowrap shrink-0 active:scale-98 shadow-sm"
                title={`Download slide #${activeImageIndex + 1} only`}
              >
                {isCurrentSlideVideo ? (
                  <Film className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>{isCurrentSlideVideo ? "Video" : "Photo"} #{activeImageIndex + 1}</span>
              </button>
            </>
          )}

          {isLiveStudioActive && canUseLiveStudio && activeLiveTask && onStopLiveRecord ? (
            <button
              type="button"
              onClick={() => onStopLiveRecord(activeLiveTask.taskId)}
              disabled={activeLiveTask.progress?.etaStr === "Saving"}
              className="h-10 px-5 rounded-xl font-bold text-xs sm:text-sm bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 active:scale-98 disabled:opacity-75"
              title="Stop live stream recording and save output MP4"
            >
              <Square className="w-3.5 h-3.5 fill-current animate-pulse text-white" />
              <span>
                {activeLiveTask.progress?.etaStr === "Saving"
                  ? "Finalizing MP4..."
                  : `Stop Recording (${formatElapsed(recordingElapsedSec)})`}
              </span>
            </button>
          ) : isLiveStudioActive && canUseLiveStudio && !isStreamEnded && onStartLiveRecord ? (
            <button
              type="button"
              onClick={() => onStartLiveRecord(currentLiveConfig)}
              disabled={isDownloadingCurrentUrl}
              className="h-10 px-5 rounded-xl font-bold text-xs sm:text-sm bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 active:scale-98 disabled:opacity-50"
            >
              <Radio className="w-4 h-4 animate-pulse" />
              <span>
                {liveMode === "rewind_live"
                  ? "Rewind & Record Stream"
                  : liveMode === "capture_time_range"
                  ? "Capture Stream Highlight"
                  : liveMode === "chat_replay"
                  ? "Record Stream + Chat (.SRT)"
                  : waitForStream && info.liveStatus === "is_upcoming"
                  ? "Wait & Record Stream"
                  : "Start Live Recording"}
              </span>
            </button>
          ) : isCurrentlyStreaming ? (
            <button
              type="button"
              disabled
              className="h-10 px-5 rounded-xl font-bold text-xs sm:text-sm bg-[#1e1e24] border border-red-500/30 text-zinc-400 flex items-center justify-center gap-2 cursor-not-allowed whitespace-nowrap shrink-0 shadow-sm"
              title="Stream is currently broadcasting live. Video download will become available once the stream has ended."
            >
              <Radio className="w-4 h-4 text-red-500 animate-pulse" />
              <span>Live in Progress (Download Disabled)</span>
            </button>
          ) : (
            <button
              onClick={() => {
                if (formatType === "subtitle") {
                  onTranscribe ? onTranscribe() : onDownload();
                } else {
                  onDownload();
                }
              }}
              disabled={
                isDownloadingCurrentUrl ||
                (!isLiveStudioActive && formatType === "subtitle" && (!transcriptionReady || isTranscribing))
              }
              className={`h-10 px-5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 active:scale-98 ${
                isDownloadingCurrentUrl || (!isLiveStudioActive && formatType === "subtitle" && isTranscribing)
                  ? "bg-[#27272a] text-[#71717a] !cursor-not-allowed"
                  : formatType === "subtitle"
                  ? "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30"
                  : isImage
                  ? "bg-zinc-100 hover:bg-white text-zinc-950 shadow-md hover:shadow-lg border border-zinc-200"
                  : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30"
              }`}
            >
              {isDownloadingCurrentUrl ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                  <span>Downloading in Media Vault...</span>
                </>
              ) : !isLiveStudioActive && formatType === "subtitle" && isTranscribing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-purple-300" />
                  <span>
                    {transcriptionProgress && transcriptionProgress.percent > 0
                      ? `Transcribing (${Math.round(transcriptionProgress.percent)}%)...`
                      : "Transcribing Audio..."}
                  </span>
                </>
              ) : (
                <>
                  {formatType === "subtitle" ? (
                    <Captions className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>
                    {isCarousel
                      ? `Download All (${carouselImages.length} ${
                          carouselVideosCount > 0 && carouselImagesCount > 0
                            ? "Media"
                            : carouselVideosCount > 0
                            ? "Videos"
                            : "Photos"
                        })`
                      : isImage
                      ? "Download Photo (HD)"
                      : formatType === "subtitle"
                      ? "Download Transcript (SRT)"
                      : formatType === "audio"
                      ? "Audio"
                      : "Video"}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Selection Modal */}
      {isCarousel && (
        <CarouselSelectionModal
          isOpen={isSelectionModalOpen}
          onClose={() => setIsSelectionModalOpen(false)}
          images={carouselImages}
          mediaItems={info.mediaItems}
          postTitle={info.title}
          initialSelectedIndices={[activeImageIndex]}
          onConfirm={(indices) => onDownload(indices)}
        />
      )}
    </div>
  );
};
