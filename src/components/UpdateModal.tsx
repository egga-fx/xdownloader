import React, { useState } from "react";
import {
  ArrowUpCircle,
  Download,
  X,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { AppUpdateInfo } from "../types";
import { downloadAndInstallAppUpdate, openExternalUrl } from "../lib/tauri-api";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface UpdateModalProps {
  open: boolean;
  onClose: () => void;
  updateInfo: AppUpdateInfo | null;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  open,
  onClose,
  updateInfo,
}) => {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!open || !updateInfo) return null;

  const handleInstall = async () => {
    setError(null);
    setInstalling(true);
    setProgress(0);

    try {
      await downloadAndInstallAppUpdate(updateInfo, (pct) => {
        setProgress(pct);
      });
    } catch (err: unknown) {
      console.error("Failed to install update:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to download or install automatic update."
      );
      setInstalling(false);
    }
  };

  const handleOpenReleasePage = () => {
    if (updateInfo.releaseUrl) {
      openExternalUrl(updateInfo.releaseUrl);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-[#121215] border border-[#27272a] rounded-2xl shadow-2xl shadow-black/80 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-[#27272a] flex items-center justify-between bg-[#18181b]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <ArrowUpCircle className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 id="update-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
                <span>Application Update Available</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  v{updateInfo.version}
                </span>
              </h2>
              <p className="text-xs text-[#a1a1aa]">
                A new version of xDownloader is ready to download and install.
              </p>
            </div>
          </div>

          {!installing && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#27272a] text-[#71717a] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          {/* Version badge cards */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#18181b] border border-[#27272a]">
            <div>
              <p className="text-[11px] font-medium text-[#71717a]">Installed Version</p>
              <p className="text-sm font-bold font-mono text-[#a1a1aa]">
                v{updateInfo.currentVersion}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-blue-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Latest Version</span>
              </p>
              <p className="text-sm font-bold font-mono text-emerald-400">
                v{updateInfo.version}
              </p>
            </div>
          </div>

          {/* Release Notes with Markdown Renderer */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Release Notes</span>
              {updateInfo.releaseUrl && (
                <button
                  type="button"
                  onClick={handleOpenReleasePage}
                  className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>View on GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="p-3.5 rounded-xl bg-[#09090b] border border-[#27272a] max-h-56 overflow-y-auto selection:bg-blue-500/30">
              <MarkdownRenderer content={updateInfo.body} />
            </div>
          </div>

          {/* Progress or error */}
          {installing && (
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-400 font-medium flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Downloading and preparing update...</span>
                </span>
                <span className="font-mono font-bold text-white">{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#27272a] overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-[#71717a]">
                The application will close and launch the installer once the download completes.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 flex flex-col gap-1.5">
                <p className="font-medium">{error}</p>
                {updateInfo.releaseUrl && (
                  <button
                    type="button"
                    onClick={handleOpenReleasePage}
                    className="self-start text-[11px] font-bold text-red-300 hover:text-white underline cursor-pointer"
                  >
                    Download manually from GitHub Releases →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#27272a] bg-[#18181b]/50 flex items-center justify-between">
          <button
            type="button"
            disabled={installing}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#a1a1aa] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer disabled:opacity-50"
          >
            Later
          </button>

          <button
            type="button"
            disabled={installing}
            onClick={handleInstall}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all cursor-pointer disabled:opacity-50"
          >
            {installing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Installing Update ({progress}%)...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Install Update Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
