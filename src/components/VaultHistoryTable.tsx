import {
  XCircle,
  Film,
  Music,
  Loader2,
  AlertTriangle,
  Captions,
  Pause,
  Play,
} from "lucide-react";
import { ActiveDownloadTask, DownloadRecord } from "../types";
import { VaultItemActions } from "./VaultItemActions";
import { CarouselThumbnailStack, getCarouselSlideCount } from "./CarouselThumbnailStack";
import {
  formatFileSize,
  getSourceAccount,
  isRecordCorruptOrMissing,
  getRecordThumbnail,
} from "../lib/utils";

interface VaultHistoryTableProps {
  activeTasks: ActiveDownloadTask[];
  onPauseTask?: (taskId: string) => void;
  onResumeTask?: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  records: DownloadRecord[];
  onSelectRecord: (record: DownloadRecord) => void;
  onOpenFolder: (record: DownloadRecord) => void;
  onCopyPath: (path: string) => void;
  onDeleteRecord: (record: DownloadRecord) => void;
  onRetryRecord?: (record: DownloadRecord) => void;
  onOpenTranscriptStudio?: (record: DownloadRecord) => void;
}

export const VaultHistoryTable: React.FC<VaultHistoryTableProps> = ({
  activeTasks,
  onPauseTask,
  onResumeTask,
  onCancelTask,
  records,
  onSelectRecord,
  onOpenFolder,
  onCopyPath,
  onDeleteRecord,
  onRetryRecord,
  onOpenTranscriptStudio,
}) => {
  return (
    <div className="flex flex-col divide-y divide-[#1f1f23]">
      {/* 1. ACTIVE RUNNING TASKS */}
      {activeTasks.map((task) => {
        const isPaused = task.status === "paused";
        const isSubtitle = task.formatType === "subtitle";

        return (
          <div
            key={task.taskId}
            className={`flex items-center justify-between p-3.5 sm:p-4 min-h-[78px] bg-[#121215]/80 border-b gap-3 transition-colors ${
              isPaused
                ? "border-amber-500/20 bg-amber-500/[0.02]"
                : isSubtitle
                ? "border-purple-500/30 bg-purple-950/[0.08]"
                : "border-blue-500/20"
            }`}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-grow">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                  isPaused
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : isSubtitle
                    ? "bg-purple-500/15 border-purple-500/35 text-purple-300"
                    : "bg-blue-500/10 border-blue-500/30 text-blue-400"
                }`}
              >
                {isPaused ? (
                  <Pause className="w-4 h-4" />
                ) : isSubtitle ? (
                  <Captions className="w-5 h-5 text-purple-400 animate-pulse" />
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin" />
                )}
              </div>
              <div className="flex flex-col min-w-0 flex-grow gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-bold text-white truncate" title={task.title}>
                    {task.title}
                  </span>
                  {isSubtitle && (
                    <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                      AI Scribe v2
                    </span>
                  )}
                  {isPaused && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                      Paused
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#a1a1aa]">
                  <span
                    className={`font-bold ${
                      isPaused
                        ? "text-amber-400"
                        : isSubtitle
                        ? "text-purple-300"
                        : "text-blue-400"
                    }`}
                  >
                    {task.progress.percent > 0
                      ? `${Math.round(task.progress.percent)}%`
                      : isPaused
                      ? "Paused"
                      : "Connecting..."}
                  </span>
                  <span>•</span>
                  <span className="truncate">
                    {task.progress.speedStr || (isPaused ? "Paused" : "Starting...")}
                  </span>
                  {task.progress.etaStr && task.progress.etaStr !== "--:--" && !isPaused && !isSubtitle && (
                    <>
                      <span>•</span>
                      <span>ETA {task.progress.etaStr}</span>
                    </>
                  )}
                </div>
                {/* Progress Bar */}
                <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden mt-0.5">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isPaused
                        ? "bg-amber-500"
                        : isSubtitle
                        ? "bg-gradient-to-r from-purple-500 to-indigo-500"
                        : "bg-blue-500"
                    }`}
                    style={{ width: `${Math.max(task.progress.percent, 3)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!isSubtitle && (
                isPaused ? (
                  <button
                    onClick={() => onResumeTask?.(task.taskId)}
                    className="w-7 h-7 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 flex items-center justify-center cursor-pointer transition-colors"
                    title="Resume Download"
                  >
                    <Play className="w-4 h-4 fill-amber-400/20" />
                  </button>
                ) : (
                  <button
                    onClick={() => onPauseTask?.(task.taskId)}
                    className="w-7 h-7 rounded-md text-[#a1a1aa] hover:text-amber-400 hover:bg-amber-500/10 flex items-center justify-center cursor-pointer transition-colors"
                    title="Pause Download"
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                )
              )}
              <button
                onClick={() => onCancelTask(task.taskId)}
                className="w-7 h-7 rounded-md text-[#71717a] hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center cursor-pointer transition-colors"
                title={isSubtitle ? "Batalkan Transkripsi" : "Cancel Download"}
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}

      {/* 2. COMPLETED RECORDS */}
      {records.map((item) => {
        const corruptOrMissing = isRecordCorruptOrMissing(item);
        const src = getSourceAccount(item);
        const thumb = getRecordThumbnail(item);

        return (
          <div
            key={item.id}
            className="flex items-center justify-between p-3.5 sm:p-4 min-h-[78px] border-b border-[#1f1f23] hover:bg-white/[0.02] transition-colors gap-3.5 group"
          >
            {/* Thumbnail & Title */}
            <div className="flex items-center gap-3.5 min-w-0 flex-grow">
              {/* Thumbnail (Stacked for carousel, standard single for other formats) */}
              {(() => {
                const slideCount = getCarouselSlideCount(item);
                if (slideCount) {
                  return (
                    <div
                      onClick={() => !corruptOrMissing && onSelectRecord(item)}
                      className={`relative w-20 h-13 sm:w-24 sm:h-15 rounded-md shrink-0 transition-all ${
                        corruptOrMissing
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer hover:scale-102"
                      }`}
                    >
                      <CarouselThumbnailStack
                        record={item}
                        slideCount={slideCount}
                        corruptOrMissing={corruptOrMissing}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    onClick={() => !corruptOrMissing && onSelectRecord(item)}
                    className={`relative w-20 h-13 sm:w-24 sm:h-15 rounded-md overflow-hidden bg-[#09090b] border shrink-0 transition-all ${
                      corruptOrMissing
                        ? "border-red-500/30 grayscale saturate-0 opacity-50 contrast-75 cursor-not-allowed"
                        : "border-[#27272a] cursor-pointer hover:border-blue-500/50"
                    }`}
                  >
                    {thumb && (
                      <img
                        src={thumb}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        className={`w-full h-full object-cover absolute inset-0 z-1 ${
                          corruptOrMissing ? "grayscale saturate-0" : ""
                        }`}
                      />
                    )}
                    <div
                      className={`w-full h-full flex items-center justify-center text-[#71717a] ${
                        corruptOrMissing ? "grayscale saturate-0" : ""
                      }`}
                    >
                      {item.formatType === "subtitle" ? (
                        <Captions className="w-4 h-4 text-purple-400" />
                      ) : item.formatType === "audio" ? (
                        <Music className="w-4 h-4" />
                      ) : (
                        <Film className="w-4 h-4" />
                      )}
                    </div>

                    {/* Broken / Missing Visual Overlay */}
                    {corruptOrMissing && (
                      <div className="absolute inset-0 bg-black/45 backdrop-blur-[0.5px] flex items-center justify-center">
                        <AlertTriangle className="w-4 h-4 text-red-400 drop-shadow" />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Info Column */}
              <div className="flex flex-col min-w-0 flex-grow gap-1">
                <span
                  onClick={() => !corruptOrMissing && onSelectRecord(item)}
                  className={`text-xs sm:text-sm font-bold truncate ${
                    !corruptOrMissing
                      ? "text-[#f4f4f5] cursor-pointer hover:text-blue-400"
                      : "text-[#71717a] cursor-not-allowed"
                  }`}
                  title={item.title}
                >
                  {item.title}
                </span>

                <div className="flex items-center gap-1.5 text-[11px] text-[#71717a] mt-0.5 flex-wrap">
                  {/* Format badge for subtitles */}
                  {item.formatType === "subtitle" && (
                    <span className="px-1 py-0.2 rounded text-[9px] font-extrabold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      SRT
                    </span>
                  )}
                  {/* Status chip if missing / error */}
                  {!item.exists && (
                    <span className="px-1 py-0.2 rounded text-[9px] font-extrabold bg-red-500/15 text-red-400 border border-red-500/30">
                      NOT FOUND
                    </span>
                  )}
                  {item.exists && item.status === "error" && (
                    <span className="px-1 py-0.2 rounded text-[9px] font-extrabold bg-red-500/15 text-red-400 border border-red-500/30">
                      ERROR
                    </span>
                  )}

                  {/* Author source link */}
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400/80 hover:text-blue-400 hover:underline max-w-[130px] truncate cursor-pointer"
                    title={`Source: ${src.text}`}
                  >
                    {src.text}
                  </a>
                  <span>•</span>
                  <span>{formatFileSize(item.fileSizeBytes)}</span>
                </div>
              </div>
            </div>

            {/* Consolidated Action Buttons: Play + Show in Folder / Download direct, other actions in More menu */}
            <VaultItemActions
              record={item}
              onSelectRecord={onSelectRecord}
              onOpenFolder={onOpenFolder}
              onCopyPath={onCopyPath}
              onDeleteRecord={onDeleteRecord}
              onRetry={onRetryRecord}
              onOpenTranscriptStudio={onOpenTranscriptStudio}
              layout="row"
            />
          </div>
        );
      })}
    </div>
  );
};
