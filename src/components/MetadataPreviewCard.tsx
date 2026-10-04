import React, { useState, useEffect } from "react";
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

            {/* Format Type Selector */}
            <div className="flex items-center gap-1.5 mt-1">
              {info.description === "image" ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#1e1e24] text-zinc-200 border border-[#3f3f46]">
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
                <>
                  <button
                    onClick={() => {
                      setFormatType("video");
                      setQuality("best");
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      formatType === "video"
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                        : "bg-[#1a1a20] text-[#a1a1aa] hover:text-white border border-[#27272a]"
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Video (MP4)</span>
                  </button>
                  <button
                    onClick={() => {
                      setFormatType("audio");
                      setQuality("mp3");
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      formatType === "audio"
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                        : "bg-[#1a1a20] text-[#a1a1aa] hover:text-white border border-[#27272a]"
                    }`}
                  >
                    <Music className="w-3.5 h-3.5" />
                    <span>Audio (MP3)</span>
                  </button>
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
          ) : (
            (formatType === "video" ? VIDEO_QUALITIES : AUDIO_QUALITIES).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`h-10 px-3 rounded-xl text-xs font-bold uppercase cursor-pointer transition-all ${
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

          <button
            onClick={() => onDownload()}
            disabled={isDownloadingCurrentUrl}
            className={`h-10 px-5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 active:scale-98 ${
              isDownloadingCurrentUrl
                ? "bg-[#27272a] text-[#71717a] !cursor-not-allowed"
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
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  {isImage
                    ? isCarousel
                      ? `Download Semua (${carouselImages.length} Foto)`
                      : "Download Photo (HD)"
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
