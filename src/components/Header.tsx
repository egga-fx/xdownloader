import {
  FolderOpen,
  FolderSearch,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Info,
  Scissors,
  Loader2,
} from "lucide-react";
import { BinariesStatus } from "../types";
import { isTauriEnvironment } from "../lib/tauri-api";

interface HeaderProps {
  outputFolder: string;
  onPickFolder: () => void;
  onOpenFolder: () => void;
  binariesStatus: BinariesStatus | null;
  checkingBinaries?: boolean;
  onOpenBinarySetup: () => void;
  vaultOpen: boolean;
  onToggleVault: () => void;
  vaultCount: number;
  activeDownloadingCount: number;
  onOpenSplitter?: () => void;
  onOpenTrimmer?: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  hasUpdate?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  outputFolder,
  onPickFolder,
  onOpenFolder,
  binariesStatus,
  checkingBinaries = false,
  onOpenBinarySetup,
  vaultOpen,
  onToggleVault,
  vaultCount,
  activeDownloadingCount,
  onOpenSplitter,
  onOpenTrimmer,
  onOpenSettings,
  onOpenAbout,
  hasUpdate = false,
}) => {
  const isChecking = checkingBinaries || binariesStatus === null;
  const isBinariesReady =
    !isChecking && binariesStatus?.ytdlp_installed && binariesStatus?.ffmpeg_installed;

  const triggerTrimmer = onOpenTrimmer || onOpenSplitter;

  return (
    <header className="h-14 border-b border-[#27272a] bg-[#09090b]/80 backdrop-blur-md px-4 flex items-center justify-between z-30 shrink-0 select-none">
      {/* Left Area (Clean) */}
      <div />

      {/* Right Controls: Folder path, Binary status, Media Vault, Settings, About */}
      <div className="flex items-center gap-2">
        {/* Binary Status: Checking / Ready / Setup Needed */}
        <button
          onClick={onOpenBinarySetup}
          className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border cursor-pointer transition-all ${
            isChecking
              ? "bg-zinc-800/60 border-zinc-700/60 text-zinc-300 hover:bg-zinc-800"
              : isBinariesReady
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15"
              : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 animate-pulse"
          }`}
          title={
            isChecking
              ? "Memeriksa status download engines..."
              : isBinariesReady
              ? "yt-dlp & ffmpeg are installed and ready"
              : "Click to download missing yt-dlp or ffmpeg binaries"
          }
        >
          {isChecking ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="hidden sm:inline">Checking Engines...</span>
            </>
          ) : isBinariesReady ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Engines Ready</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Setup Engines</span>
            </>
          )}
        </button>

        {/* Output Directory Button: Desktop vs Browser Mode */}
        {isTauriEnvironment() ? (
          <div className="hidden md:flex items-center gap-1 bg-[#141418] border border-[#27272a] rounded-lg p-0.5 pl-2">
            <HardDrive className="w-3.5 h-3.5 text-[#71717a] shrink-0" />
            <button
              onClick={onOpenFolder}
              className="text-xs text-[#a1a1aa] hover:text-white max-w-[160px] truncate px-1 py-0.5 text-left transition-colors cursor-pointer"
              title={`Open: ${outputFolder || "Default videos folder"}`}
            >
              {outputFolder ? outputFolder.split(/[\\/]/).pop() : "Videos"}
            </button>
            <button
              onClick={onPickFolder}
              className="w-7 h-7 rounded-md hover:bg-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Browse download folder"
            >
              <FolderSearch className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onOpenFolder}
              className="w-7 h-7 rounded-md hover:bg-[#27272a] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Open folder in File Explorer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div
            className="hidden md:flex items-center gap-1.5 bg-[#141418] border border-[#27272a] rounded-lg px-2.5 py-1 text-xs text-[#71717a] select-none"
            title="Browser Mode: Media files are downloaded directly via your browser to your default Downloads folder."
          >
            <HardDrive className="w-3.5 h-3.5 text-[#52525b] shrink-0" />
            <span className="text-[11px] font-medium text-[#a1a1aa]">Browser Downloads</span>
          </div>
        )}

        {/* Media Vault Drawer Toggle Button */}
        <button
          onClick={onToggleVault}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
            vaultOpen
              ? "bg-[#27272a] text-white border-[#3f3f46]"
              : "bg-[#141418] border-[#27272a] text-[#f4f4f5] hover:border-[#3f3f46] hover:bg-[#1c1c22]"
          }`}
        >
          <HardDrive className="w-3.5 h-3.5 text-[#a1a1aa]" />
          <span>Media Vault</span>
          {activeDownloadingCount > 0 ? (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-extrabold rounded-full bg-white text-black px-1 animate-pulse">
              {activeDownloadingCount}
            </span>
          ) : vaultCount > 0 ? (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full bg-[#27272a] text-[#a1a1aa] px-1">
              {vaultCount}
            </span>
          ) : null}
        </button>

        {/* Video Trimmer Button */}
        {triggerTrimmer && (
          <button
            onClick={triggerTrimmer}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold bg-[#141418] border-[#27272a] text-[#f4f4f5] hover:border-zinc-500 hover:bg-zinc-800 hover:text-white cursor-pointer transition-all"
            title="Video Trimmer (Potong video secara visual)"
          >
            <Scissors className="w-3.5 h-3.5 text-zinc-300" />
            <span className="hidden sm:inline">Trimmer</span>
          </button>
        )}

        {/* Settings Button: Gear Icon Only */}
        <button
          onClick={onOpenSettings}
          className="relative w-8 h-8 rounded-lg bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] hover:border-[#3f3f46] text-[#a1a1aa] hover:text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
          title={hasUpdate ? "Settings (Update Available)" : "Settings"}
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
          {hasUpdate && (
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-[#09090b]" />
            </span>
          )}
        </button>

        {/* About App Button */}
        <button
          onClick={onOpenAbout}
          className="w-8 h-8 rounded-lg bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] hover:border-[#3f3f46] text-[#a1a1aa] hover:text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
          title="About xDownloader"
          aria-label="About xDownloader"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
