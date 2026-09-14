import { useState } from "react";
import {
  Download,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  Cpu,
  Info,
  RefreshCw,
} from "lucide-react";
import { BinariesStatus } from "../types";
import { installBinary, updateEngine, isTauriEnvironment } from "../lib/tauri-api";

interface BinarySetupModalProps {
  open: boolean;
  onClose: () => void;
  status: BinariesStatus | null;
  onRefresh: () => void;
}

export const BinarySetupModal: React.FC<BinarySetupModalProps> = ({
  open,
  onClose,
  status,
  onRefresh,
}) => {
  const [installingType, setInstallingType] = useState<string | null>(null);
  const [updatingEngine, setUpdatingEngine] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleInstall = async (binaryType: "ytdlp" | "ffmpeg") => {
    setInstallingType(binaryType);
    setError(null);
    setSuccessMsg(null);
    try {
      await installBinary(binaryType);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || `Failed to download ${binaryType}`);
    } finally {
      setInstallingType(null);
    }
  };

  const handleUpdateEngine = async () => {
    setUpdatingEngine(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const msg = await updateEngine();
      setSuccessMsg(msg);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || "Failed to update yt-dlp engine");
    } finally {
      setUpdatingEngine(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#141418] border border-[#27272a] rounded-2xl p-6 shadow-2xl shadow-black/80 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">
                Download Engines Setup
              </h3>
              <p className="text-xs text-[#71717a]">
                Required native binaries for media downloading & encoding
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#27272a] text-[#71717a] hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Web Preview Mode Banner */}
        {!isTauriEnvironment() && (
          <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-850/50 text-[11px] text-blue-200/90 flex items-start gap-2.5 leading-relaxed">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">Browser Preview Mode: </span>
              Auto-install simulates binary setup for UI evaluation. For native downloads and OS background processes, launch with{" "}
              <code className="bg-black/50 px-1.5 py-0.5 rounded text-blue-300 font-mono font-bold">
                bun run tauri dev
              </code>
              .
            </div>
          </div>
        )}

        {/* Binary Status List */}
        <div className="flex flex-col gap-3">
          {/* yt-dlp */}
          <div className="p-3.5 rounded-xl bg-[#0e0e11] border border-[#27272a] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {status?.ytdlp_installed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-white">yt-dlp</span>
                  <span className="text-[10px] text-[#71717a]">Media Extractor</span>
                </div>
                <p className="text-[11px] text-[#71717a]">
                  {status?.ytdlp_installed
                    ? `Version: ${status.ytdlp_version}`
                    : "Not found in bin/ or system PATH"}
                </p>
              </div>
            </div>

            {status?.ytdlp_installed ? (
              <button
                onClick={handleUpdateEngine}
                disabled={updatingEngine || installingType !== null}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#27272a] hover:bg-[#3f3f46] text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                title="Update yt-dlp to latest release"
              >
                {updatingEngine ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>Updating...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                    <span>Update Engine</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => handleInstall("ytdlp")}
                disabled={installingType !== null}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 transition-colors shadow-sm ${
                  installingType !== null
                    ? "bg-blue-600/50 !cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 cursor-pointer"
                }`}
              >
                {installingType === "ytdlp" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Downloading...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Auto Install</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* ffmpeg */}
          <div className="p-3.5 rounded-xl bg-[#0e0e11] border border-[#27272a] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {status?.ffmpeg_installed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-white">ffmpeg</span>
                  <span className="text-[10px] text-[#71717a]">Video & Audio Multiplexer</span>
                </div>
                <p className="text-[11px] text-[#71717a]">
                  {status?.ffmpeg_installed
                    ? `Version: ${status.ffmpeg_version}`
                    : "Not found in bin/ or system PATH"}
                </p>
              </div>
            </div>

            {!status?.ffmpeg_installed && (
              <button
                onClick={() => handleInstall("ffmpeg")}
                disabled={installingType !== null}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 transition-colors shadow-sm ${
                  installingType !== null
                    ? "bg-blue-600/50 !cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 cursor-pointer"
                }`}
              >
                {installingType === "ffmpeg" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Downloading...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Auto Install</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {successMsg && (
          <p className="text-xs text-emerald-400 font-medium px-1 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{successMsg}</span>
          </p>
        )}

        {error && (
          <p className="text-xs text-red-400 font-medium px-1">
            {error}
          </p>
        )}

        {/* Footer info */}
        <div className="text-[11px] text-[#71717a] flex items-center justify-between pt-2 border-t border-[#27272a]">
          <span>Saved directly into: <code className="text-white">{status?.bin_dir || "./bin"}</code></span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold cursor-pointer transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
