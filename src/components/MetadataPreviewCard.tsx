import React, { useState, useEffect, useRef } from "react";
import {
  Download,
  Film,
  Music,
  Clock,
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
} from "lucide-react";
import {
  DownloaderFormatType,
  DownloaderQuality,
  VideoInfo,
} from "../types";
import { formatDuration } from "../lib/utils";
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
  isDownloadingCurrentUrl: boolean;
  transcriptionReady?: boolean;
  transcriptionBlockReason?: string | null;
  isTranscribing?: boolean;
  onTranscribe?: () => void;
  onOpenTranscriptionSettings?: () => void;
  onOpenTranscriptStudio?: () => void;
}

const VIDEO_QUALITIES: DownloaderQuality[] = ["best", "1080p", "720p", "480p", "360p"];
const AUDIO_QUALITIES: DownloaderQuality[] = ["mp3", "m4a", "wav", "flac"];

export const MetadataPreviewCard: React.FC<MetadataPreviewCardProps> = ({
  info,
  formatType,
  setFormatType,
  quality,
  setQuality,
  customName,
  setCustomName,
  onDownload,
  isDownloadingCurrentUrl,
  transcriptionReady = false,
  transcriptionBlockReason = null,
  isTranscribing = false,
  onTranscribe,
  onOpenTranscriptionSettings,
  onOpenTranscriptStudio,
}) => {
  const isImage = info.description === "image";
  const carouselImages: string[] =
    info.images && info.images.length > 0
      ? info.images
      : info.thumbnail
      ? [info.thumbnail]
      : [];
  const isCarousel = isImage && carouselImages.length > 1;

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
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Record<number, number>>({});
  const [imgError, setImgError] = useState<boolean>(false);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState<boolean>(false);
  const formatDropdownRef = useRef<HTMLDivElement>(null);

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
    if (info.description === "image" && formatType !== "image") {
      setFormatType("image");
      setQuality("best");
    } else if (info.description !== "image" && formatType === "image") {
      setFormatType("video");
      setQuality("best");
    }
  }, [info.description]);

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

          {/* Duration badge for video */}
          {!isImage && info.duration > 0 && (
            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[11px] font-bold text-white flex items-center gap-1 z-10">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>{formatDuration(info.duration)}</span>
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
                    <span>{carouselImages.length} Photos</span>
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

            {/* Format Type Selector (Custom Dropdown) */}
            <div className="flex items-center gap-2 mt-1">
              {info.description === "image" ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1e1e24] text-zinc-200 border border-[#3f3f46]">
                  {isCarousel ? (
                    <Images className="w-3.5 h-3.5 text-zinc-300" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-zinc-300" />
                  )}
                  <span>
                    {isCarousel
                      ? `Photo Carousel (${carouselImages.length} Photos)`
                      : "Photo (HD Lossless)"}
                  </span>
                </div>
              ) : (
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
                          : "Transkrip (SRT)"}
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
                              Video dengan audio hingga resolusi 4K
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
                              Ekstrak lagu & audio resolusi tinggi
                            </span>
                          </div>
                        </div>
                        {formatType === "audio" && (
                          <Check className="w-4 h-4 text-emerald-400 shrink-0 ml-1" />
                        )}
                      </button>

                      {/* Transkrip Option */}
                      <div
                        onClick={() => {
                          if (transcriptionReady) {
                            setFormatType("subtitle");
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
                                Transkrip (SRT)
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
                                  ? (transcriptionBlockReason || "API Key belum di-set di Settings")
                                  : "Subtitle otomatis (.srt, .vtt, .txt) via ElevenLabs"
                              }
                            >
                              {!transcriptionReady
                                ? (transcriptionBlockReason || "API Key belum di-set di Settings")
                                : "Subtitle otomatis (.srt, .vtt, .txt)"}
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
                              title="Buka Pengaturan untuk mengisi ElevenLabs API Key"
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
          ) : formatType === "subtitle" ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <div
                className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-purple-500/30 bg-purple-500/10 text-purple-300 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
                title="Model AI Speech-to-Text ElevenLabs"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>ElevenLabs Scribe v2</span>
              </div>
              <div
                className="h-10 px-3.5 rounded-xl font-medium text-xs border border-[#27272a] bg-[#18181c] text-[#a1a1aa] flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                title="Format berkas transkrip yang dihasilkan secara otomatis"
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
            (formatType === "video" ? VIDEO_QUALITIES : AUDIO_QUALITIES).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`h-10 px-3 rounded-xl text-xs font-bold uppercase cursor-pointer transition-all shrink-0 ${
                  quality === q
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/50"
                    : "bg-[#18181c] text-[#71717a] hover:text-[#a1a1aa] border border-[#27272a]"
                }`}
              >
                {q === "best" ? "Original HD" : q}
              </button>
            ))
          )}
        </div>

        {/* Action Buttons: Proportionate, single-line, aligned */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
          {isCarousel && (
            <>
              {/* Button Pilih Foto */}
              <button
                type="button"
                onClick={() => setIsSelectionModalOpen(true)}
                disabled={isDownloadingCurrentUrl}
                className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-zinc-700 bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40 whitespace-nowrap shrink-0 active:scale-98 shadow-sm"
                title="Pilih foto tertentu untuk diunduh"
              >
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>Pilih Foto</span>
              </button>

              {/* Quick Download Active Slide */}
              <button
                type="button"
                onClick={() => onDownload([activeImageIndex])}
                disabled={isDownloadingCurrentUrl}
                className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-zinc-700 bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40 whitespace-nowrap shrink-0 active:scale-98 shadow-sm"
                title={`Download hanya slide #${activeImageIndex + 1}`}
              >
                <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
                <span>Foto #{activeImageIndex + 1}</span>
              </button>
            </>
          )}

          {onOpenTranscriptStudio && !isImage && (
            <button
              type="button"
              onClick={onOpenTranscriptStudio}
              disabled={isDownloadingCurrentUrl || isTranscribing}
              className="h-10 px-3.5 rounded-xl font-semibold text-xs border border-purple-500/30 bg-purple-950/40 text-purple-200 hover:bg-purple-900/60 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40 whitespace-nowrap shrink-0 active:scale-98 shadow-sm"
              title="Buka media ini langsung di Transcript Studio"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Buka di Studio</span>
            </button>
          )}

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
              (formatType === "subtitle" && (!transcriptionReady || isTranscribing))
            }
            className={`h-10 px-5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 active:scale-98 ${
              isDownloadingCurrentUrl || (formatType === "subtitle" && isTranscribing)
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
            ) : formatType === "subtitle" && isTranscribing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-purple-300" />
                <span>Mentranskrip Audio...</span>
              </>
            ) : (
              <>
                {formatType === "subtitle" ? (
                  <Captions className="w-4 h-4" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>
                  {isImage
                    ? isCarousel
                      ? `Download Semua (${carouselImages.length} Foto)`
                      : "Download Photo (HD)"
                    : formatType === "subtitle"
                    ? "Unduh Transkrip (SRT)"
                    : formatType === "audio"
                    ? "Audio"
                    : "Video"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Selection Modal */}
      {isCarousel && (
        <CarouselSelectionModal
          isOpen={isSelectionModalOpen}
          onClose={() => setIsSelectionModalOpen(false)}
          images={carouselImages}
          postTitle={info.title}
          initialSelectedIndices={[activeImageIndex]}
          onConfirm={(indices) => onDownload(indices)}
        />
      )}
    </div>
  );
};
