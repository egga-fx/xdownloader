import {
  Play,
  FolderOpen,
  Copy,
  Trash2,
  XCircle,
  Film,
  Music,
  Clock,
  Loader2,
  AlertTriangle,
  Scissors,
} from "lucide-react";
import { ActiveDownloadTask, DownloadRecord } from "../types";
import {
  formatDuration,
  formatFileSize,
  getSourceAccount,
  isRecordCorruptOrMissing,
  getRecordThumbnail,
} from "../lib/utils";

interface VaultHistoryGridProps {
  activeTasks: ActiveDownloadTask[];
  onCancelTask: (taskId: string) => void;
  records: DownloadRecord[];
  onSelectRecord: (record: DownloadRecord) => void;
  onOpenFolder: (record: DownloadRecord) => void;
  onCopyPath: (path: string) => void;
  onDeleteRecord: (record: DownloadRecord) => void;
  onSplitRecord?: (record: DownloadRecord) => void;
}

export const VaultHistoryGrid: React.FC<VaultHistoryGridProps> = ({
  activeTasks,
  onCancelTask,
  records,
  onSelectRecord,
  onOpenFolder,
  onCopyPath,
  onDeleteRecord,
  onSplitRecord,
}) => {
  return (
    <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
      {/* 1. PINNED ACTIVE DOWNLOAD TASKS */}
      {activeTasks.map((task) => (
        <div
          key={task.taskId}
          className="col-span-1 sm:col-span-2 bg-[#121215] border border-blue-500/30 rounded-xl p-3 flex flex-col gap-2 shadow-md shadow-blue-500/5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
              <span className="text-xs font-bold text-white truncate" title={task.title}>
                {task.title}
              </span>
            </div>
            <button
              onClick={() => onCancelTask(task.taskId)}
              className="w-6 h-6 rounded text-[#71717a] hover:text-red-400 flex items-center justify-center cursor-pointer shrink-0"
              title="Cancel Download"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#a1a1aa]">
            <span className="font-bold text-blue-400">
              {task.progress.percent > 0
                ? `${Math.round(task.progress.percent)}%`
                : "Connecting..."}
            </span>
            <span>
              {task.progress.speedStr || "Starting..."}{" "}
              {task.progress.etaStr && task.progress.etaStr !== "--:--"
                ? `· ETA ${task.progress.etaStr}`
                : ""}
            </span>
          </div>

          <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.max(task.progress.percent, 3)}%` }}
            />
          </div>
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
            className={`bg-[#121215] border rounded-lg overflow-hidden flex flex-col transition-all group ${
              corruptOrMissing
                ? "border-red-500/30 hover:border-red-500/50"
                : "border-[#27272a] hover:border-[#3f3f46]"
            }`}
          >
            {/* Thumbnail */}
            <div
              onClick={() => !corruptOrMissing && onSelectRecord(item)}
              className={`relative w-full aspect-video bg-[#09090b] rounded-t-md overflow-hidden transition-all ${
                corruptOrMissing
                  ? "grayscale saturate-0 opacity-50 contrast-75 cursor-not-allowed"
                  : "cursor-pointer"
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
                    <Music className="w-6 h-6" />
                  ) : (
                    <Film className="w-6 h-6" />
                  )}
                </div>
              )}

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
                  title={item.title}
                >
                  {item.title}
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

              {/* Action Bar */}
              <div className="pt-2 border-t border-[#27272a] flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {item.exists && (
                    <button
                      onClick={() => onSelectRecord(item)}
                      className="w-7 h-7 rounded-md text-[#71717a] hover:text-blue-400 hover:bg-blue-500/10 flex items-center justify-center cursor-pointer transition-colors"
                      title="Preview Media"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.exists && onSplitRecord && (
                    <button
                      onClick={() => onSplitRecord(item)}
                      className="w-7 h-7 rounded-md text-[#71717a] hover:text-amber-400 hover:bg-amber-500/10 flex items-center justify-center cursor-pointer transition-colors"
                      title="Split Video"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.exists && (
                    <button
                      onClick={() => onOpenFolder(item)}
                      className="w-7 h-7 rounded-md text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors"
                      title="Open Folder"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.exists && item.filePath && (
                    <button
                      onClick={() => onCopyPath(item.filePath)}
                      className="w-7 h-7 rounded-md text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors"
                      title="Copy File Path"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Delete button: bypasses dialog if corrupt or missing */}
                <button
                  onClick={() => onDeleteRecord(item)}
                  className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
                    corruptOrMissing
                      ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      : "text-[#71717a] hover:text-red-400 hover:bg-red-500/10"
                  }`}
                  title={corruptOrMissing ? "Remove broken record" : "Delete"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
