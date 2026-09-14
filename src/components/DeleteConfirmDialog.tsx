import { AlertTriangle, Trash2, X, Loader2 } from "lucide-react";
import { DownloadRecord } from "../types";

interface DeleteConfirmDialogProps {
  record: DownloadRecord | null;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  record,
  onClose,
  onConfirm,
  deleting,
}) => {
  if (!record) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl p-5 shadow-2xl shadow-black/80 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-red-400">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="font-extrabold text-sm text-white">
              Delete Media from Vault?
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-[#27272a] text-[#71717a] hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="text-xs text-[#a1a1aa] leading-relaxed">
          Media file <span className="font-bold text-white">&quot;{record.title}&quot;</span> will be permanently deleted from local disk storage. This action cannot be undone.
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#27272a]">
          <button
            onClick={onClose}
            disabled={deleting}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              deleting
                ? "text-[#52525b] !cursor-not-allowed"
                : "text-[#a1a1aa] hover:text-white hover:bg-[#27272a] cursor-pointer"
            }`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 shadow-md shadow-red-600/30 transition-colors ${
              deleting
                ? "bg-red-600/50 !cursor-not-allowed"
                : "bg-red-600 hover:bg-red-500 cursor-pointer"
            }`}
          >
            {deleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
