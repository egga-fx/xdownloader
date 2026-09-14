import { useState } from "react";
import {
  X,
  Search,
  LayoutGrid,
  List,
  RefreshCw,
  HardDrive,
  Eraser,
} from "lucide-react";
import { ActiveDownloadTask, DownloadRecord } from "../types";
import { formatFileSize, isRecordCorruptOrMissing } from "../lib/utils";
import { VaultHistoryTable } from "./VaultHistoryTable";
import { VaultHistoryGrid } from "./VaultHistoryGrid";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

interface MediaVaultDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTasks: ActiveDownloadTask[];
  onCancelTask: (taskId: string) => void;
  records: DownloadRecord[];
  onRefresh: () => void;
  onSelectRecord: (record: DownloadRecord) => void;
  onOpenFolder: (record: DownloadRecord) => void;
  onCopyPath: (path: string) => void;
  onDeleteRecordDirectly: (id: string, title?: string) => Promise<void>;
  loading: boolean;
}

export const MediaVaultDrawer: React.FC<MediaVaultDrawerProps> = ({
  open,
  onClose,
  activeTasks,
  onCancelTask,
  records,
  onRefresh,
  onSelectRecord,
  onOpenFolder,
  onCopyPath,
  onDeleteRecordDirectly,
  loading,
}) => {
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [recordToDelete, setRecordToDelete] = useState<DownloadRecord | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Filter records by search and format
  const filteredRecords = records.filter((r) => {
    if (formatFilter !== "all" && r.formatType !== formatFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const titleMatch = r.title.toLowerCase().includes(q);
      const authorMatch = r.author?.toLowerCase().includes(q);
      if (!titleMatch && !authorMatch) return false;
    }
    return true;
  });

  const totalVaultSize = records.reduce((acc, curr) => acc + (curr.fileSizeBytes || 0), 0);

  // Smart Delete Handler
  const handleDeleteClick = async (record: DownloadRecord) => {
    if (isRecordCorruptOrMissing(record)) {
      // Direct deletion without confirmation dialog
      await onDeleteRecordDirectly(record.id, record.title);
    } else {
      // Real file exists on disk: prompt confirmation modal
      setRecordToDelete(record);
    }
  };

  const brokenRecords = records.filter(isRecordCorruptOrMissing);
  const brokenCount = brokenRecords.length;
  const [cleaningBroken, setCleaningBroken] = useState<boolean>(false);

  const handleCleanBrokenRecords = async () => {
    if (brokenCount === 0 || cleaningBroken) return;
    setCleaningBroken(true);
    try {
      for (const item of brokenRecords) {
        await onDeleteRecordDirectly(item.id, item.title);
      }
    } finally {
      setCleaningBroken(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!recordToDelete || deleting) return;
    setDeleting(true);
    try {
      await onDeleteRecordDirectly(recordToDelete.id, recordToDelete.title);
    } finally {
      setDeleting(false);
      setRecordToDelete(null);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-xl bg-[#0e0e11] border-l border-[#27272a] h-full flex flex-col shadow-2xl shadow-black/90 transition-transform duration-300 ease-in-out transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#27272a] flex items-center justify-between shrink-0 bg-[#121215]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-white">
                  Media Vault
                </h3>
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-[#27272a] text-[#a1a1aa]">
                  {records.length} items
                </span>
              </div>
              <p className="text-[11px] text-[#71717a] font-medium">
                {formatFileSize(totalVaultSize)} total local storage
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {brokenCount > 0 && (
              <button
                onClick={handleCleanBrokenRecords}
                disabled={cleaningBroken}
                className="px-2 py-1 rounded-lg text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                title={`Purge ${brokenCount} missing or broken items`}
              >
                <Eraser className={`w-3.5 h-3.5 ${cleaningBroken ? "animate-spin" : ""}`} />
                <span>Clean ({brokenCount})</span>
              </button>
            )}
            <button
              onClick={onRefresh}
              className={`w-8 h-8 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors ${
                loading ? "animate-spin text-blue-400" : ""
              }`}
              title="Refresh Vault"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors"
              title="Close Vault"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar: Search & View Mode */}
        <div className="p-3 border-b border-[#1f1f23] flex items-center gap-2 shrink-0 bg-[#0e0e11]">
          {/* Search bar */}
          <div className="flex-grow relative flex items-center bg-[#141418] border border-[#27272a] rounded-lg px-2.5 py-1.5 focus-within:border-blue-500/50">
            <Search className="w-3.5 h-3.5 text-[#71717a] shrink-0 mr-1.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search downloaded media..."
              className="w-full bg-transparent border-0 text-xs text-white placeholder-[#71717a] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-[#71717a] hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Format selector */}
          <select
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value)}
            className="bg-[#141418] border border-[#27272a] text-[#a1a1aa] text-xs font-semibold rounded-lg px-2.5 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500/50"
          >
            <option value="all">All Formats</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="image">Images</option>
          </select>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-[#141418] border border-[#27272a] rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                viewMode === "table"
                  ? "bg-blue-600 text-white"
                  : "text-[#71717a] hover:text-white"
              }`}
              title="Table View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                viewMode === "grid"
                  ? "bg-blue-600 text-white"
                  : "text-[#71717a] hover:text-white"
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Drawer Body: Records or Empty State */}
        <div className="flex-grow overflow-y-auto min-h-0 bg-[#09090b]">
          {activeTasks.length === 0 && filteredRecords.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-3 text-[#71717a]">
              <div className="w-14 h-14 rounded-2xl bg-[#141418] border border-[#27272a] flex items-center justify-center text-[#52525b]">
                <HardDrive className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-white">Media Vault is Empty</h4>
              <p className="text-xs max-w-xs leading-relaxed text-[#71717a]">
                Downloads from YouTube, TikTok, Instagram, and more will be saved here automatically.
              </p>
            </div>
          ) : viewMode === "table" ? (
            <VaultHistoryTable
              activeTasks={activeTasks}
              onCancelTask={onCancelTask}
              records={filteredRecords}
              onSelectRecord={onSelectRecord}
              onOpenFolder={onOpenFolder}
              onCopyPath={onCopyPath}
              onDeleteRecord={handleDeleteClick}
            />
          ) : (
            <VaultHistoryGrid
              activeTasks={activeTasks}
              onCancelTask={onCancelTask}
              records={filteredRecords}
              onSelectRecord={onSelectRecord}
              onOpenFolder={onOpenFolder}
              onCopyPath={onCopyPath}
              onDeleteRecord={handleDeleteClick}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal (Only for real existing media files) */}
      <DeleteConfirmDialog
        record={recordToDelete}
        onClose={() => setRecordToDelete(null)}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </div>
  );
};
