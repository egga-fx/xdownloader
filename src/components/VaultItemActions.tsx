import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Play,
  Download,
  MoreVertical,
  Scissors,
  FolderOpen,
  Copy,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { DownloadRecord } from "../types";
import { triggerDirectBrowserDownload, isTauriEnvironment } from "../lib/tauri-api";
import { isRecordCorruptOrMissing } from "../lib/utils";

interface VaultItemActionsProps {
  record: DownloadRecord;
  onSelectRecord: (record: DownloadRecord) => void;
  onOpenFolder: (record: DownloadRecord) => void;
  onCopyPath: (path: string) => void;
  onDeleteRecord: (record: DownloadRecord) => void;
  onSplitRecord?: (record: DownloadRecord) => void;
  onRetry?: (record: DownloadRecord) => void;
  layout?: "row" | "split";
}

export const VaultItemActions: React.FC<VaultItemActionsProps> = ({
  record,
  onSelectRecord,
  onOpenFolder,
  onCopyPath,
  onDeleteRecord,
  onSplitRecord,
  onRetry,
  layout = "row",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 8 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isDesktop = isTauriEnvironment();
  const corruptOrMissing = isRecordCorruptOrMissing(record);
  const canPlayOrDownload = record.exists && !corruptOrMissing;

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const right = Math.max(8, window.innerWidth - rect.right);

      if (spaceBelow < 180 && rect.top > 180) {
        setMenuPos({
          bottom: window.innerHeight - rect.top + 4,
          right,
        });
      } else {
        setMenuPos({
          top: rect.bottom + 4,
          right,
        });
      }
    }
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleDismiss = () => {
      setIsOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [isOpen]);

  const directButtons = (
    <>
      {/* 1. Retry Action: for corrupt, missing, or failed records */}
      {corruptOrMissing && onRetry && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry(record);
          }}
          className="w-7 h-7 rounded-md text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 flex items-center justify-center cursor-pointer transition-colors"
          title="Download Ulang / Retry Download"
          aria-label="Retry Download"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}

      {/* 2. Play Action: for existing media */}
      {canPlayOrDownload && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRecord(record);
          }}
          className="w-7 h-7 rounded-md text-[#71717a] hover:text-blue-400 hover:bg-blue-500/10 flex items-center justify-center cursor-pointer transition-colors"
          title="Preview / Play Media"
          aria-label="Play Media"
        >
          <Play className="w-3.5 h-3.5" />
        </button>
      )}

      {/* 3. Primary Secondary Action: Desktop -> Show in Folder; Browser -> Download File */}
      {canPlayOrDownload && (
        isDesktop ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolder(record);
            }}
            className="w-7 h-7 rounded-md text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#27272a] flex items-center justify-center cursor-pointer transition-colors"
            title="Open Folder"
            aria-label="Open Folder"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerDirectBrowserDownload(record);
            }}
            className="w-7 h-7 rounded-md text-[#71717a] hover:text-emerald-400 hover:bg-emerald-500/10 flex items-center justify-center cursor-pointer transition-colors"
            title="Download File to Browser / Device"
            aria-label="Download File"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )
      )}
    </>
  );

  const moreButton = (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleMenu}
        className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
          isOpen
            ? "bg-[#27272a] text-white"
            : "text-[#71717a] hover:text-white hover:bg-[#27272a]"
        }`}
        title="More Actions"
        aria-label="More Actions"
        aria-expanded={isOpen}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {isOpen &&
        createPortal(
          <>
            {/* Backdrop for click outside dismissal */}
            <div
              className="fixed inset-0 z-50 cursor-default"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsOpen(false);
              }}
            />

            {/* Floating Dropdown Menu */}
            <div
              style={{
                top: menuPos.top !== undefined ? `${menuPos.top}px` : undefined,
                bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : undefined,
                right: `${menuPos.right}px`,
              }}
              className="fixed z-50 min-w-[170px] bg-[#141418] border border-[#27272a] rounded-xl p-1.5 shadow-2xl shadow-black/90 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100 backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Retry Download (also in More menu for convenience if corrupt/missing) */}
              {corruptOrMissing && onRetry && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onRetry(record);
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors cursor-pointer w-full text-left"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>Retry Download</span>
                </button>
              )}

              {/* Trim / Split Video */}
              {canPlayOrDownload && onSplitRecord && record.formatType !== "image" && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onSplitRecord(record);
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#d4d4d8] hover:text-white hover:bg-white/5 transition-colors cursor-pointer w-full text-left"
                >
                  <Scissors className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Trim / Split Media</span>
                </button>
              )}

              {/* Show in Folder (Only show in menu if in browser mode, since desktop has it as a direct button outside) */}
              {canPlayOrDownload && !isDesktop && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenFolder(record);
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#d4d4d8] hover:text-white hover:bg-white/5 transition-colors cursor-pointer w-full text-left"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#a1a1aa] shrink-0" />
                  <span>Show in Folder</span>
                </button>
              )}

              {/* Copy File Path */}
              {Boolean(record.filePath) && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onCopyPath(record.filePath);
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#d4d4d8] hover:text-white hover:bg-white/5 transition-colors cursor-pointer w-full text-left"
                >
                  <Copy className="w-3.5 h-3.5 text-[#a1a1aa] shrink-0" />
                  <span>Copy File Path</span>
                </button>
              )}

              {/* Divider */}
              <div className="my-1 border-t border-[#27272a]" />

              {/* Delete / Remove */}
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onDeleteRecord(record);
                }}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer w-full text-left"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span>{corruptOrMissing ? "Remove from Vault" : "Delete Media"}</span>
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );

  if (layout === "split") {
    return (
      <div className="pt-2 border-t border-[#27272a] flex items-center justify-between">
        <div className="flex items-center gap-1">
          {directButtons}
        </div>
        {moreButton}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      {directButtons}
      {moreButton}
    </div>
  );
};
