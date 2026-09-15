import React, { useState } from "react";
import {
  Download,
  Film,
  Music,
  Clock,
  User,
  ExternalLink,
  Loader2,
  FileEdit,
  Scissors,
} from "lucide-react";
import {
  DownloaderFormatType,
  DownloaderQuality,
  TimeRange,
  VideoInfo,
} from "../types";
import { formatDuration } from "../lib/utils";

interface MetadataPreviewCardProps {
  info: VideoInfo;
  formatType: DownloaderFormatType;
  setFormatType: (format: DownloaderFormatType) => void;
  quality: DownloaderQuality;
  setQuality: (quality: DownloaderQuality) => void;
  customName: string;
  setCustomName: (name: string) => void;
  timeRange?: TimeRange;
  setTimeRange?: (tr: TimeRange | undefined) => void;
  onDownload: () => void;
  isDownloadingCurrentUrl: boolean;
  onOpenSplitter?: () => void;
}

const VIDEO_QUALITIES: DownloaderQuality[] = ["1080p", "720p", "480p", "360p", "best"];
const AUDIO_QUALITIES: DownloaderQuality[] = ["mp3", "m4a", "wav", "flac"];

export const MetadataPreviewCard: React.FC<MetadataPreviewCardProps> = ({
  info,
  formatType,
  setFormatType,
  quality,
  setQuality,
  customName,
  setCustomName,
  timeRange,
  setTimeRange,
  onDownload,
  isDownloadingCurrentUrl,
  onOpenSplitter,
}) => {
  const [showTrimmer, setShowTrimmer] = useState<boolean>(Boolean(timeRange));
  return (
    <div className="w-full bg-[#121215] border border-[#27272a] rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-xl shadow-black/50">
      {/* Top Preview Section */}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        {/* Thumbnail Preview */}
        <div className="relative w-full sm:w-56 aspect-video bg-[#09090b] rounded-xl overflow-hidden border border-[#27272a] shrink-0">
          {info.thumbnail ? (
            <img
              src={info.thumbnail}
              alt={info.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#71717a]">
              <Film className="w-8 h-8" />
            </div>
          )}
          {info.duration > 0 && (
            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[11px] font-bold text-white flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>{formatDuration(info.duration)}</span>
            </div>
          )}
        </div>

        {/* Video Info Details */}
        <div className="flex flex-col gap-1.5 flex-grow min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-white line-clamp-2 leading-snug">
            {info.title}
          </h2>
          <div className="flex items-center gap-2 text-xs text-[#a1a1aa] flex-wrap mt-1">
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-[#71717a]" />
              <span className="font-semibold text-blue-400">
                {info.uploader || info.channel || "Creator"}
              </span>
            </span>
            <span>•</span>
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
          <div className="flex items-center gap-1.5 mt-3">
            <button
              onClick={() => {
                setFormatType("video");
                setQuality("1080p");
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
          </div>
        </div>
      </div>

      {/* Custom Filename Input */}
      <div className="flex items-center gap-2 bg-[#18181c] border border-[#27272a] rounded-xl px-3 py-1.5 focus-within:border-blue-500/60">
        <FileEdit className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
        <input
          type="text"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="Custom filename (optional)..."
          className="w-full bg-transparent border-0 text-xs text-white placeholder-[#71717a] focus:outline-none"
        />
      </div>

      {/* Time Range Trimming Toggle & Inputs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              const next = !showTrimmer;
              setShowTrimmer(next);
              if (!next && setTimeRange) setTimeRange(undefined);
              else if (next && setTimeRange && !timeRange) {
                setTimeRange({ start: "00:00:00", end: formatDuration(info.duration) });
              }
            }}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
              showTrimmer
                ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                : "bg-[#18181c] border-[#27272a] text-[#a1a1aa] hover:text-white"
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Clip Segment {showTrimmer ? "(Active)" : "(Optional)"}</span>
          </button>

          {showTrimmer && (
            <span className="text-[11px] text-[#71717a]">
              Downloads section only via yt-dlp
            </span>
          )}
        </div>

        {showTrimmer && setTimeRange && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#18181c] border border-[#27272a] animate-in fade-in">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-[#a1a1aa]">Start Time (HH:MM:SS)</label>
              <input
                type="text"
                value={timeRange?.start || "00:00:00"}
                onChange={(e) => setTimeRange({ start: e.target.value, end: timeRange?.end || formatDuration(info.duration) })}
                placeholder="00:00:00"
                className="bg-[#121215] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-[#a1a1aa]">End Time (HH:MM:SS)</label>
              <input
                type="text"
                value={timeRange?.end || formatDuration(info.duration)}
                onChange={(e) => setTimeRange({ start: timeRange?.start || "00:00:00", end: e.target.value })}
                placeholder="00:01:30"
                className="bg-[#121215] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Quality Options & Download Button */}
      <div className="pt-3 border-t border-[#27272a] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Quality Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-[#71717a] mr-1">
            Quality:
          </span>
          {(formatType === "video" ? VIDEO_QUALITIES : AUDIO_QUALITIES).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase cursor-pointer transition-all ${
                quality === q
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/50"
                  : "bg-[#18181c] text-[#71717a] hover:text-[#a1a1aa] border border-[#27272a]"
              }`}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Action Buttons: Splitter & Download */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {onOpenSplitter && (
            <button
              type="button"
              onClick={onOpenSplitter}
              disabled={isDownloadingCurrentUrl}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl font-bold text-xs border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40"
              title="Split this video stream directly without downloading the full video"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Split Video</span>
            </button>
          )}

          <button
            onClick={onDownload}
            disabled={isDownloadingCurrentUrl}
            className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all ${
              isDownloadingCurrentUrl
                ? "bg-[#27272a] text-[#71717a] !cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 active:scale-98"
            }`}
          >
            {isDownloadingCurrentUrl ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span>Downloading in Media Vault...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  Download {formatType === "audio" ? "Audio" : "Video"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
