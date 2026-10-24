import {
  XCircle,
  Film,
  Music,
  Clock,
  Loader2,
  AlertTriangle,
  Pause,
  Play,
  Captions,
} from "lucide-react";
import { ActiveDownloadTask, DownloadRecord } from "../types";
import { VaultItemActions } from "./VaultItemActions";
import { CarouselThumbnailStack, getCarouselSlideCount } from "./CarouselThumbnailStack";
import {
  formatDuration,
  formatFileSize,
  getSourceAccount,
  isRecordCorruptOrMissing,
  getRecordThumbnail,
  getDisplayTitle,
} from "../lib/utils";

interface VaultHistoryGridProps {
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

export const VaultHistoryGrid: React.FC<VaultHistoryGridProps> = ({
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
    <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
      {/* 1. PINNED ACTIVE DOWNLOAD TASKS */}
      {activeTasks.map((task) => {
        const isPaused = task.status === "paused";
        const isSubtitle = task.formatType === "subtitle";

        return (
          <div
            key={task.taskId}
            className={`col-span-1 sm:col-span-2 bg-[#121215] border rounded-xl p-3 flex flex-col gap-2 shadow-md transition-colors ${
              isPaused
                ? "border-amber-500/30 shadow-amber-500/5 bg-amber-500/[0.02]"
                : isSubtitle
                ? "border-purple-500/30 shadow-purple-500/5 bg-purple-950/[0.08]"
                : "border-blue-500/30 shadow-blue-500/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isPaused ? (
                  <Pause className="w-4 h-4 text-amber-400 shrink-0" />
                ) : isSubtitle ? (
                  <Captions className="w-4 h-4 text-purple-400 animate-pulse shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                )}
                <span className="text-xs font-bold text-white truncate" title={getDisplayTitle(task)}>
                  {getDisplayTitle(task)}
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
              <div className="flex items-center gap-1 shrink-0">
                {!isSubtitle && (
                  isPaused ? (
                    <button
                      onClick={() => onResumeTask?.(task.taskId)}
                      className="w-6 h-6 rounded text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 flex items-center justify-center cursor-pointer transition-colors"
                      title="Resume Download"
                    >
                      <Play className="w-3.5 h-3.5 fill-amber-400/20" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onPauseTask?.(task.taskId)}
                      className="w-6 h-6 rounded text-[#a1a1aa] hover:text-amber-400 hover:bg-amber-500/10 flex items-center justify-center cursor-pointer transition-colors"
                      title="Pause Download"
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
                <button
                  onClick={() => onCancelTask(task.taskId)}
                  className="w-6 h-6 rounded text-[#71717a] hover:text-red-400 flex items-center justify-center cursor-pointer transition-colors"
                  title={isSubtitle ? "Cancel Transcription" : "Cancel Download"}
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#a1a1aa]">
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
              <span className="truncate">
                {task.progress.speedStr || (isPaused ? "Paused" : "Starting...")}{" "}
                {task.progress.etaStr && task.progress.etaStr !== "--:--" && !isPaused && !isSubtitle
                  ? `· ETA ${task.progress.etaStr}`
                  : ""}
              </span>
            </div>

            <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
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
            className={`bg-[#121215] border rounded-lg overflow-hidden flex flex-col transition-all group ${
              corruptOrMissing
                ? "border-red-500/30 hover:border-red-500/50"
                : "border-[#27272a] hover:border-[#3f3f46]"
            }`}
          >
            {/* Thumbnail (Stacked for carousel, standard single for other formats) */}
            {(() => {
              const slideCount = getCarouselSlideCount(item);
              if (slideCount) {
                return (
                  <div
                    onClick={() => !corruptOrMissing && onSelectRecord(item)}
                    className={`relative w-full aspect-video rounded-t-md overflow-hidden transition-all ${
                      corruptOrMissing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
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
                  className={`relative w-full aspect-video bg-[#09090b] rounded-t-md overflow-hidden transition-all ${
                    corruptOrMissing
                      ? "grayscale saturate-0 opacity-50 contrast-75 cursor-not-allowed"
                      : "cursor-pointer"
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
                    {item.formatType === "audio" ? (
                      <Music className="w-6 h-6" />
                    ) : (
                      <Film className="w-6 h-6" />
                    )}
                  </div>

                  {/* Status Badge in bottom-right corner */}
                  <div
                    className={`absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-extrabold flex items-center gap-1 ${
                      corruptOrMissing
                        ? "bg-red-600/90 text-white"
                        : "bg-black/80 backdrop-blur-sm text-white"
                    }`}
                  >
                    {!item.exists ? (
                      <>
                        <AlertTriangle className="w-3 h-3 text-white" />
                        <span>NOT FOUND</span>
                      </>
                    ) : item.status === "error" ? (
                      <>
                        <AlertTriangle className="w-3 h-3 text-white" />
                        <span>ERROR</span>
                      </>
                    ) : item.durationSec > 0 ? (
                      <>
                        <Clock className="w-3 h-3 text-blue-400" />
                        <span>{formatDuration(item.durationSec)}</span>
                      </>
                    ) : (
                      item.formatType.toUpperCase()
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Info Card Content */}
            <div className="p-3 flex flex-col flex-grow justify-between gap-2.5">
              <div className="flex flex-col gap-1">
                <h4
                  onClick={() => item.exists && onSelectRecord(item)}
                  className={`text-xs font-bold line-clamp-2 leading-snug ${
                    item.exists
                      ? "text-[#f4f4f5] cursor-pointer hover:text-blue-400"
                      : "text-[#71717a]"
                  }`}
                  title={getDisplayTitle(item)}
                >
                  {getDisplayTitle(item)}
                </h4>

                <div className="flex items-center justify-between text-[11px] text-[#71717a] mt-1">
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400/80 hover:text-blue-400 hover:underline max-w-[65%] truncate cursor-pointer"
                    title={`Source: ${src.text}`}
                  >
                    {src.text}
                  </a>
                  <span>{formatFileSize(item.fileSizeBytes)}</span>
                </div>
              </div>

              {/* Consolidated Action Bar: Play + Show in Folder / Download direct on left, other actions in More menu on right */}
              <VaultItemActions
                record={item}
                onSelectRecord={onSelectRecord}
                onOpenFolder={onOpenFolder}
                onCopyPath={onCopyPath}
                onDeleteRecord={onDeleteRecord}
                onRetry={onRetryRecord}
                onOpenTranscriptStudio={onOpenTranscriptStudio}
                layout="split"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
