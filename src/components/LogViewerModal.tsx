import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  X,
  FileText,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  FolderOpen,
  AlertTriangle,
  Info,
  AlertCircle,
  Search,
  Loader2,
} from "lucide-react";
import { LogEntry } from "../types";
import { getRecentLogs, clearAppLogs, openLogsFolder } from "../lib/tauri-api";

interface LogViewerModalProps {
  open: boolean;
  onClose: () => void;
}

type LogLevelFilter = "ALL" | "INFO" | "WARN" | "ERROR";

export const LogViewerModal: React.FC<LogViewerModalProps> = ({ open, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedLevel, setSelectedLevel] = useState<LogLevelFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRecentLogs(200);
      setLogs(data);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open
  useEffect(() => {
    if (open) {
      fetchLogs();
    }
  }, [open, fetchLogs]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    let result = logs;
    if (selectedLevel !== "ALL") {
      result = result.filter(
        (log) => log.level.toUpperCase() === selectedLevel.toUpperCase()
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(q) ||
          log.category.toLowerCase().includes(q) ||
          (log.taskId && log.taskId.toLowerCase().includes(q)) ||
          (log.details && log.details.toLowerCase().includes(q))
      );
    }
    return result;
  }, [logs, selectedLevel, searchQuery]);

  // Counts by level
  const counts = useMemo(() => {
    return {
      all: logs.length,
      info: logs.filter((l) => l.level.toUpperCase() === "INFO").length,
      warn: logs.filter((l) => l.level.toUpperCase() === "WARN").length,
      error: logs.filter((l) => l.level.toUpperCase() === "ERROR").length,
    };
  }, [logs]);

  // Copy logs to clipboard
  const handleCopyLogs = () => {
    if (filteredLogs.length === 0) return;
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.createdAt}] [${l.level.toUpperCase()}] [${l.category}]${
            l.taskId ? ` [Task: ${l.taskId}]` : ""
          } ${l.message}${l.details ? `\n  Details: ${l.details}` : ""}`
      )
      .join("\n");

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Clear logs
  const handleClearLogs = async () => {
    if (!confirm("Apakah Anda yakin ingin menghapus semua riwayat log aktivitas?")) {
      return;
    }
    setClearing(true);
    try {
      await clearAppLogs();
      await fetchLogs();
    } catch (err) {
      console.error("Failed to clear logs:", err);
    } finally {
      setClearing(false);
    }
  };

  // Open logs folder
  const handleOpenFolder = async () => {
    try {
      await openLogsFolder();
    } catch (err) {
      console.error("Failed to open logs folder:", err);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl bg-[#121215] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/90 flex flex-col h-[85vh] max-h-[800px] overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-[#27272a] flex items-center justify-between bg-[#18181b] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <span>Diagnostics & System Logs</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#a1a1aa] font-mono">
                  {logs.length} entries
                </span>
              </h3>
              <p className="text-[11px] text-[#71717a] truncate">
                Catatan aktivitas unduhan, error processing, dan event runtime
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenFolder}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#27272a] bg-[#18181b] hover:bg-[#27272a] text-xs font-semibold text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
              title="Buka direktori penyimpanan file log di OS"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Buka Folder</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="p-3 border-b border-[#27272a] bg-[#141418] flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: "ALL", label: "ALL", count: counts.all },
                { id: "INFO", label: "INFO", count: counts.info },
                { id: "WARN", label: "WARN", count: counts.warn },
                { id: "ERROR", label: "ERROR", count: counts.error },
              ] as const
            ).map((tab) => {
              const active = selectedLevel === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedLevel(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-[#1e1e24] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] px-1 rounded ${
                      active ? "bg-blue-700/80 text-white" : "bg-[#27272a] text-[#71717a]"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-2 flex-grow sm:flex-grow-0 min-w-[200px]">
            <div className="relative flex-grow sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari log..."
                className="w-full pl-8 pr-3 py-1 bg-[#1e1e24] border border-[#27272a] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 font-sans"
              />
            </div>

            <button
              type="button"
              onClick={fetchLogs}
              disabled={loading}
              className="p-1.5 rounded-lg border border-[#27272a] bg-[#1e1e24] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh logs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-400" : ""}`} />
            </button>

            <button
              type="button"
              onClick={handleCopyLogs}
              disabled={filteredLogs.length === 0}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#27272a] bg-[#1e1e24] hover:bg-[#27272a] text-xs font-medium text-[#a1a1aa] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
              title="Salin log yang difilter ke clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Salin</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClearLogs}
              disabled={clearing || logs.length === 0}
              className="p-1.5 rounded-lg border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-40"
              title="Hapus semua log riwayat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Log Viewer Content */}
        <div className="flex-grow overflow-y-auto p-3 font-mono text-xs bg-[#09090b] select-text">
          {loading && logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[#71717a]">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span>Memuat data log aktivitas...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[#71717a]">
              <Info className="w-8 h-8 opacity-40" />
              <span className="text-sm">Tidak ada log yang sesuai kriteria</span>
              <p className="text-[11px] text-[#52525b]">
                {searchQuery ? "Coba ubah kata kunci pencarian." : "Belum ada event tercatat."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredLogs.map((entry) => {
                const isError = entry.level.toUpperCase() === "ERROR";
                const isWarn = entry.level.toUpperCase() === "WARN";

                const badgeStyle = isError
                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                  : isWarn
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "bg-blue-500/15 text-blue-400 border-blue-500/30";

                const IconComponent = isError ? AlertCircle : isWarn ? AlertTriangle : Info;

                return (
                  <div
                    key={entry.id}
                    className={`p-2 rounded-lg border transition-colors ${
                      isError
                        ? "bg-red-950/15 border-red-900/30 hover:bg-red-950/25"
                        : isWarn
                        ? "bg-amber-950/15 border-amber-900/30 hover:bg-amber-950/25"
                        : "bg-[#121215] border-[#27272a]/60 hover:bg-[#18181b]"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Level Badge */}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border shrink-0 flex items-center gap-1 ${badgeStyle}`}
                      >
                        <IconComponent className="w-3 h-3" />
                        <span>{entry.level}</span>
                      </span>

                      {/* Timestamp */}
                      <span className="text-[#71717a] text-[11px] shrink-0 pt-0.5">
                        {entry.createdAt.replace("T", " ").replace(/\..+/, "")}
                      </span>

                      {/* Category */}
                      <span className="text-cyan-400/90 text-[11px] font-semibold shrink-0 pt-0.5">
                        [{entry.category}]
                      </span>

                      {/* Task ID if present */}
                      {entry.taskId && (
                        <span className="text-[#a1a1aa] bg-[#27272a] px-1 rounded text-[10px] shrink-0 pt-0.5">
                          task:{entry.taskId}
                        </span>
                      )}

                      {/* Message */}
                      <p className="text-[#f4f4f5] text-xs flex-grow break-all pt-0.5">
                        {entry.message}
                      </p>
                    </div>

                    {/* Details if available */}
                    {entry.details && (
                      <div className="mt-1.5 ml-8 p-2 rounded bg-black/40 border border-[#27272a]/80 text-[#a1a1aa] text-[11px] whitespace-pre-wrap break-all">
                        {entry.details}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#27272a] bg-[#18181b] flex items-center justify-between text-xs text-[#71717a] shrink-0">
          <div className="flex items-center gap-3">
            <span>
              Menampilkan <strong className="text-white">{filteredLogs.length}</strong> dari{" "}
              {logs.length} catatan
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold cursor-pointer transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
