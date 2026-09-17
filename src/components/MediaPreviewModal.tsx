import { useState, useEffect } from "react";
import {
  X,
  FolderOpen,
  ExternalLink,
  Download,
  Film,
  Music,
  RotateCcw,
  Volume2,
  Scissors,
} from "lucide-react";
import { DownloadRecord } from "../types";
import { formatDuration, formatFileSize, getSourceAccount } from "../lib/utils";
import {
  resolvePlaybackUrl,
  getYouTubeEmbedUrl,
  triggerDirectBrowserDownload,
  isTauriEnvironment,
} from "../lib/tauri-api";

interface MediaPreviewModalProps {
  record: DownloadRecord | null;
  onClose: () => void;
  onOpenFolder: (record: DownloadRecord) => void;
  onOpenTrimmer?: (record: DownloadRecord) => void;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  record,
  onClose,
  onOpenFolder,
  onOpenTrimmer,
}) => {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setVideoError(false);

    if (!record) {
      setStreamUrl(null);
      return;
    }

    resolvePlaybackUrl(record).then((url) => {
      if (isMounted) {
        setStreamUrl(url);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [record?.id, record?.filePath]);

  if (!record) return null;

  const src = getSourceAccount(record);
  const ytEmbedUrl = getYouTubeEmbedUrl(record.url);
  const isAudio = record.formatType === "audio";
  const isImage = record.formatType === "image";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl bg-[#141418] border border-[#27272a] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-3.5 sm:p-4 border-b border-[#27272a] flex items-center justify-between bg-[#18181b] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-3">
            <span
              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                isAudio
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : isImage
                  ? "bg-zinc-800 text-zinc-300 border border-zinc-700"
                  : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              }`}
            >
              {record.formatType}
            </span>
            <span className="font-bold text-sm text-white truncate" title={record.title}>
              {record.title}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#27272a] text-[#71717a] hover:text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
            title="Close Preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Media Preview Player Area */}
        <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden shrink-0">
          {/* 1. AUDIO PLAYER */}
          {isAudio ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#18181b] to-[#09090b]">
              <div className="relative mb-5">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden shadow-2xl border-2 border-[#27272a] flex items-center justify-center bg-[#121215]">
                  {record.thumbnailUrl ? (
                    <img
                      src={record.thumbnailUrl}
                      alt={record.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Music className="w-12 h-12 text-purple-400" />
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg">
                  <Volume2 className="w-4 h-4" />
                </div>
              </div>

              <div className="text-center max-w-md mb-4 px-4">
                <h4 className="font-bold text-sm text-white truncate" title={record.title}>
                  {record.title}
                </h4>
                <p className="text-xs text-[#71717a] mt-0.5 truncate">
                  {record.author || "Audio Track"} · {record.quality.toUpperCase()}
                </p>
              </div>

              {streamUrl ? (
                <audio
                  src={streamUrl}
                  controls
                  autoPlay
                  className="w-full max-w-md outline-none"
                />
              ) : (
                <div className="text-xs text-[#71717a] flex items-center gap-2">
                  <span>Audio file ready in media vault</span>
                </div>
              )}
            </div>
          ) : isImage ? (
            /* 2. IMAGE PREVIEW */
            <img
              src={streamUrl || record.thumbnailUrl}
              alt={record.title}
              className="w-full h-full object-contain"
            />
          ) : streamUrl && !videoError ? (
            /* 3. NATIVE VIDEO STREAM */
            <video
              src={streamUrl}
              controls
              autoPlay
              playsInline
              onError={() => setVideoError(true)}
              className="w-full h-full object-contain"
            />
          ) : ytEmbedUrl ? (
            /* 4. YOUTUBE EMBED FALLBACK */
            <iframe
              src={ytEmbedUrl}
              title={record.title}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            /* 5. ERROR / POSTER FALLBACK */
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#09090b] relative">
              {record.thumbnailUrl ? (
                <img
                  src={record.thumbnailUrl}
                  alt={record.title}
                  className="w-full h-full object-contain opacity-40 absolute inset-0"
                />
              ) : null}
              <div className="relative z-10 bg-black/85 p-5 rounded-xl border border-[#27272a] max-w-sm flex flex-col items-center gap-2 backdrop-blur-xs">
                <Film className="w-8 h-8 text-blue-400 mb-1" />
                <p className="text-xs text-white font-bold">Video Stream Preview</p>
                <p className="text-[11px] text-[#71717a]">
                  Stream video offline atau format belum ter-decode. Anda dapat mengunduh langsung ke browser.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => {
                      setVideoError(false);
                      resolvePlaybackUrl(record).then((u) => {
                        setStreamUrl(u);
                      });
                    }}
                    className="px-3 py-1 rounded bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                  <button
                    onClick={() => triggerDirectBrowserDownload(record)}
                    className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Metadata & Actions Footer */}
        <div className="p-3.5 sm:p-4 bg-[#141418] flex items-center justify-between border-t border-[#27272a] text-xs text-[#a1a1aa] flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white uppercase px-1.5 py-0.5 rounded bg-[#27272a] text-[11px]">
              {record.quality.toUpperCase()}
            </span>
            <span>•</span>
            <span>{formatFileSize(record.fileSizeBytes)}</span>
            {record.durationSec > 0 && (
              <>
                <span>•</span>
                <span>{formatDuration(record.durationSec)}</span>
              </>
            )}
            <span>•</span>
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{src.text}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex items-center gap-2">
            {onOpenTrimmer && !isImage && (
              <button
                onClick={() => {
                  onClose();
                  onOpenTrimmer(record);
                }}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:text-white font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Potong klip video ini"
              >
                <Scissors className="w-3.5 h-3.5 text-zinc-300" />
                <span>Trim Video</span>
              </button>
            )}
            <button
              onClick={() => triggerDirectBrowserDownload(record)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Download file to computer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
            {isTauriEnvironment() && (
              <button
                onClick={() => onOpenFolder(record)}
                className="px-3 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Show in File Explorer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Show in Folder</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
