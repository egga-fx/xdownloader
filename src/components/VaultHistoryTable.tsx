import {
  XCircle,
  Film,
  Music,
  Loader2,
  AlertTriangle,
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
  onCancelTask: (taskId: string) => void;
  records: DownloadRecord[];
  onSelectRecord: (record: DownloadRecord) => void;
  onOpenFolder: (record: DownloadRecord) => void;
  onCopyPath: (path: string) => void;
  onDeleteRecord: (record: DownloadRecord) => void;
  onSplitRecord?: (record: DownloadRecord) => void;
  onRetryRecord?: (record: DownloadRecord) => void;
}

export const VaultHistoryTable: React.FC<VaultHistoryTableProps> = ({
  activeTasks,
  onCancelTask,
  records,
  onSelectRecord,
  onOpenFolder,
  onCopyPath,
  onDeleteRecord,
  onSplitRecord,
  onRetryRecord,
}) => {
  return (
    <div className="flex flex-col divide-y divide-[#1f1f23]">
      {/* 1. ACTIVE RUNNING TASKS */}
      {activeTasks.map((task) => (
        <div
          key={task.taskId}
          className="flex items-center justify-between p-3.5 sm:p-4 min-h-[78px] bg-[#121215]/80 border-b border-blue-500/20 gap-3"
        >
          <div className="flex items-center gap-3.5 min-w-0 flex-grow">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
            </div>
            <div className="flex flex-col min-w-0 flex-grow gap-1">
              <span className="text-xs sm:text-sm font-bold text-white truncate" title={task.title}>
                {task.title}
              </span>
              <div className="flex items-center gap-2 text-[11px] text-[#a1a1aa]">
                <span className="font-bold text-blue-400">
                  {task.progress.percent > 0
                    ? `${Math.round(task.progress.percent)}%`
                    : "Connecting..."}
                </span>
                <span>•</span>
                <span>{task.progress.speedStr || "Starting..."}</span>
                {task.progress.etaStr && task.progress.etaStr !== "--:--" && (
                  <>
                    <span>•</span>
                    <span>ETA {task.progress.etaStr}</span>
                  </>
                )}
              </div>
              {/* Progress Bar */}
              <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden mt-0.5">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${Math.max(task.progress.percent, 3)}%` }}
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => onCancelTask(task.taskId)}
            className="w-7 h-7 rounded-md text-[#71717a] hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center cursor-pointer transition-colors shrink-0"
            title="Cancel Download"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ))}

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
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className={`w-full h-full object-cover ${
                          corruptOrMissing ? "grayscale saturate-0" : ""
                        }`}
                      />
                    ) : (
                      <div
                        className={`w-full h-full flex items-center justify-center text-[#71717a] ${
                          corruptOrMissing ? "grayscale saturate-0" : ""
                        }`}
                      >
                        {item.formatType === "audio" ? (
                          <Music className="w-4 h-4" />
                        ) : (
                          <Film className="w-4 h-4" />
                        )}
                      </div>
                    )}

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
              onSplitRecord={onSplitRecord}
              onRetry={onRetryRecord}
              layout="row"
            />
          </div>
        );
      })}
    </div>
  );
};
