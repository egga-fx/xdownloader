import { useState, useEffect } from "react";
import {
  Link2,
  Clipboard,
  X,
  Loader2,
  Globe,
} from "lucide-react";
import { DownloaderPlatform } from "../types";
import { detectPlatform, isSupportedMediaUrl, cleanMediaUrl, extractMultipleUrls } from "../lib/utils";
import { getClipboardUrl, isTauriEnvironment } from "../lib/tauri-api";
import {
  YoutubeIcon,
  InstagramIcon,
  XIcon,
  TikTokIcon,
  PinterestIcon,
} from "../lib/icons";

interface UrlInputSectionProps {
  url: string;
  onUrlChange: (value: string) => void;
  detectedPlatform: DownloaderPlatform;
  fetchingInfo: boolean;
  hasMetadata: boolean;
  onStartDownload: (url?: string) => void;
  onPaste: () => void;
  error?: string | null;
}

export const UrlInputSection: React.FC<UrlInputSectionProps> = ({
  url,
  onUrlChange,
  detectedPlatform,
  fetchingInfo,
  hasMetadata,
  onStartDownload,
  onPaste,
  error,
}) => {
  const [clipboardUrl, setClipboardUrl] = useState<string>("");
  const [clipboardPlatform, setClipboardPlatform] = useState<DownloaderPlatform>("generic");

  // Check clipboard periodically on window focus and visibility change
  const checkClipboard = async () => {
    // Only auto-poll in native desktop shell to avoid browser security permission popups
    if (!isTauriEnvironment()) return;

    try {
      const text = await getClipboardUrl();
      const trimmed = (text || "").trim();
      const extracted = extractMultipleUrls(trimmed);
      const cleanCandidate = extracted.length > 0 ? extracted[0] : cleanMediaUrl(trimmed);
      if (cleanCandidate && isSupportedMediaUrl(cleanCandidate)) {
        setClipboardUrl(cleanCandidate);
        setClipboardPlatform(detectPlatform(cleanCandidate));
      } else {
        setClipboardUrl("");
      }
    } catch {
      // clipboard access not granted or unavailable
    }
  };

  useEffect(() => {
    // Auto-polling is only active in native desktop shell
    if (!isTauriEnvironment()) return;

    let active = true;
    const runCheck = async () => {
      if (active) await checkClipboard();
    };

    runCheck();
    const interval = setInterval(runCheck, 2000);
    const handleFocus = () => runCheck();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") runCheck();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const hasValidInputUrl = Boolean(url.trim() && isSupportedMediaUrl(url.trim()));
  const hasValidClipboardUrl = Boolean(clipboardUrl && isSupportedMediaUrl(clipboardUrl));

  const handleSmartDownloadClick = async () => {
    // 1. If live clipboard contains a valid media URL, DYNAMICALLY use it:
    if (hasValidClipboardUrl) {
      onUrlChange(clipboardUrl);
      onStartDownload(clipboardUrl);
      return;
    }

    // 2. If the user already typed/pasted a valid URL in the input field:
    if (hasValidInputUrl) {
      onStartDownload(url.trim());
      return;
    }

    // 3. Otherwise, trigger onPaste
    onPaste();
  };

  const renderPlatformIcon = (platform: DownloaderPlatform, className = "w-4 h-4") => {
    switch (platform) {
      case "youtube":
        return <YoutubeIcon className={`${className} text-[#ef4444]`} />;
      case "instagram":
        return <InstagramIcon className={`${className} text-[#e1306c]`} />;
      case "tiktok":
        return <TikTokIcon className={`${className} text-[#06b6d4]`} />;
      case "x":
        return <XIcon className={`${className} text-[#38bdf8]`} />;
      case "pinterest":
        return <PinterestIcon className={`${className} text-[#e60023]`} />;
      case "web_media":
        return <Globe className={`${className} text-[#60a5fa]`} />;
      default:
        return <Link2 className={`${className} text-[#71717a]`} />;
    }
  };

  return (
    <div className="w-full flex flex-col gap-1.5">
      {/* Zero-layer standalone input container */}
      <div
        onMouseEnter={checkClipboard}
        className={`w-full relative flex items-center bg-[#121215] border transition-all duration-150 rounded-xl px-2 py-1.5 shadow-lg shadow-black/40 ${
          error
            ? "border-red-500/80 focus-within:border-red-500"
            : "border-[#27272a] focus-within:border-blue-500/80 focus-within:ring-1 focus-within:ring-blue-500/30"
        }`}
      >
        {/* Left Action / Platform Icon */}
        <div className="flex items-center pl-1 pr-1.5 shrink-0">
          {fetchingInfo ? (
            <div className="w-8 h-8 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
          ) : hasMetadata ? (
            // Metadata loaded: download button disappears cleanly, showing only clean static platform icon
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5">
              {renderPlatformIcon(detectedPlatform, "w-4 h-4")}
            </div>
          ) : hasValidClipboardUrl ? (
            // Clipboard contains a valid media link: show "Download from clipboard" button with animated light trail border
            <div className="relative p-[1px] overflow-hidden rounded-lg group shrink-0">
              {/* Rotating Greyscale Light Trail Border Beam */}
              <div
                className="absolute -inset-[200%] animate-[spin_3.5s_linear_infinite] pointer-events-none"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, transparent 250deg, rgba(255, 255, 255, 0.15) 290deg, rgba(255, 255, 255, 0.95) 335deg, transparent 360deg)",
                }}
              />
              {/* Inner Button in Pure Greyscale */}
              <button
                onClick={handleSmartDownloadClick}
                onMouseEnter={checkClipboard}
                className="relative z-10 flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-xs font-bold bg-[#18181b] hover:bg-[#222228] text-white cursor-pointer transition-colors"
                title={`Download from clipboard: ${clipboardUrl}`}
              >
                {renderPlatformIcon(clipboardPlatform, "w-3.5 h-3.5")}
                <span>Download from clipboard</span>
              </button>
            </div>
          ) : hasValidInputUrl ? (
            // Input field contains a valid media link: show "Download" button with animated light trail border
            <div className="relative p-[1px] overflow-hidden rounded-lg group shrink-0">
              <div
                className="absolute -inset-[200%] animate-[spin_3.5s_linear_infinite] pointer-events-none"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, transparent 250deg, rgba(255, 255, 255, 0.15) 290deg, rgba(255, 255, 255, 0.95) 335deg, transparent 360deg)",
                }}
              />
              <button
                onClick={handleSmartDownloadClick}
                className="relative z-10 flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-xs font-bold bg-[#18181b] hover:bg-[#222228] text-white cursor-pointer transition-colors"
                title={`Download: ${url.trim()}`}
              >
                {renderPlatformIcon(detectedPlatform, "w-3.5 h-3.5")}
                <span>Download</span>
              </button>
            </div>
          ) : (
            // No valid link in clipboard and no input: Clean default platform / link icon (NO button)
            <div className="w-8 h-8 flex items-center justify-center text-[#71717a]">
              {renderPlatformIcon(detectedPlatform, "w-4 h-4")}
            </div>
          )}
        </div>

        {/* Text Input */}
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim()) {
              onStartDownload(url.trim());
            }
          }}
          placeholder="Paste video or media link (YouTube, TikTok, Instagram, 𝕏, Pinterest, Web Media)..."
          className="flex-grow bg-transparent border-0 text-sm text-[#f4f4f5] placeholder-[#71717a] px-2 py-1.5 focus:outline-none focus:ring-0 min-w-0"
        />

        {/* Right Actions: Clear or Paste */}
        <div className="flex items-center gap-1 shrink-0 pr-1">
          {url ? (
            <button
              onClick={() => onUrlChange("")}
              className="w-7 h-7 rounded-md hover:bg-[#27272a] text-[#71717a] hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              title="Clear input"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={onPaste}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold bg-[#1a1a20] hover:bg-[#22222a] text-[#a1a1aa] hover:text-white border border-[#27272a] cursor-pointer transition-colors"
              title="Paste from clipboard"
            >
              <Clipboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Paste</span>
            </button>
          )}
        </div>
      </div>

      {/* Error text if any */}
      {error && (
        <p className="text-xs font-medium text-red-400 px-3">
          {error}
        </p>
      )}
    </div>
  );
};
