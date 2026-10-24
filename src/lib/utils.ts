import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DownloadRecord, DownloaderPlatform } from "../types";
import { convertFileSrc } from "./tauri-api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function detectPlatform(inputUrl: string): DownloaderPlatform {
  if (!inputUrl) return "generic";
  const trimmed = inputUrl.trim();
  if (/threads\.(?:net|com)/i.test(trimmed)) return "threads";
  if (/youtube\.com|youtu\.be/i.test(trimmed)) return "youtube";
  if (/tiktok\.com/i.test(trimmed)) return "tiktok";
  if (/instagram\.com/i.test(trimmed)) return "instagram";
  if (/twitter\.com|x\.com/i.test(trimmed)) return "x";
  if (/pinterest\.com|pin\.it|pinimg\.com/i.test(trimmed)) return "pinterest";
  if (/^https?:\/\//i.test(trimmed)) return "web_media";
  return "generic";
}

export function stripWrappingPunctuation(str: string): string {
  return str.trim().replace(/^[<(\[\"']+|[>),.;:!\]\"']+$/g, "");
}

export function isSupportedMediaUrl(inputUrl: string): boolean {
  if (!inputUrl) return false;
  const trimmed = stripWrappingPunctuation(inputUrl);
  if (!/^https?:\/\/.+/i.test(trimmed)) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const hasParams = Boolean(parsed.search && parsed.search.length > 1);

  // Reject bare root domains (e.g. https://pinterest.com, https://youtube.com)
  if (!path && !hasParams) {
    return false;
  }

  const platform = detectPlatform(trimmed);
  if (platform === "generic") return false;

  // Platform-specific media validations:
  if (platform === "threads") {
    return Boolean(path && path !== "/");
  }

  if (platform === "pinterest") {
    // pin.it must have shortcode
    if (parsed.hostname.includes("pin.it")) {
      const code = parsed.pathname.replace(/^\//, "").trim();
      return Boolean(code);
    }
    // pinterest.com must be a pin or media path
    if (/pinterest\./i.test(parsed.hostname)) {
      if (/\/pin\/[0-9]+/i.test(parsed.pathname)) return true;
      if (/\/sent\/?$/i.test(parsed.pathname)) return false;
      return Boolean(path && path !== "/");
    }
    if (parsed.hostname.includes("pinimg.com")) {
      return Boolean(path);
    }
  }

  if (platform === "youtube") {
    if (parsed.hostname.includes("youtu.be")) {
      return Boolean(path);
    }
    return Boolean(parsed.searchParams.get("v") || /\/(?:shorts|live)\/[a-zA-Z0-9_-]+/i.test(path));
  }

  if (platform === "tiktok") {
    return Boolean(path && path !== "/");
  }

  if (platform === "instagram") {
    return Boolean(path && path !== "/");
  }

  if (platform === "x") {
    return Boolean(path && path !== "/");
  }

  return true;
}

export function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Determines whether a download record is corrupt, missing from disk, or in an error state.
 * When true, deleting this record bypasses the confirmation dialog and deletes immediately.
 */
export function isRecordCorruptOrMissing(record?: {
  exists?: boolean;
  status?: string;
  error?: string;
  filePath?: string;
  fileSizeBytes?: number;
} | null): boolean {
  if (!record) return true;
  if (record.exists === false) return true;
  if (record.status === "error") return true;
  if (Boolean(record.error)) return true;
  if (!record.filePath || !record.filePath.trim()) return true;
  if (typeof record.fileSizeBytes === "number" && record.fileSizeBytes <= 0) return true;
  return false;
}

export interface SourceAccountInfo {
  text: string;
  url: string;
}

export function getSourceAccount(item: DownloadRecord): SourceAccountInfo {
  let author = item.author?.trim() || "";
  const rawUrl = item.url?.trim() || "";

  // If author is missing or a generic platform name, extract the real author from the filename suffix ($title-$author.ext)
  if (!author || ["youtube", "tiktok", "instagram", "web_media", "media"].includes(author.toLowerCase())) {
    const candidateName = (item.filePath ? item.filePath.split(/[/\\]/).pop() : "") || item.title || "";
    const cleanStem = stripMediaExtension(candidateName);
    const lastDash = cleanStem.lastIndexOf("-");
    if (lastDash !== -1) {
      const suffix = cleanStem.slice(lastDash + 1).trim();
      const cleanSuffix = suffix.replace(/^@/, "").trim();
      if (
        cleanSuffix &&
        !["youtube", "tiktok", "instagram", "web_media", "media", "unknown"].includes(cleanSuffix.toLowerCase())
      ) {
        author = cleanSuffix;
      }
    }
  }

  // 1. TikTok
  if (item.platform === "tiktok" || rawUrl.includes("tiktok.com")) {
    const match = rawUrl.match(/tiktok\.com\/(@[^/?#]+)/i);
    if (match) {
      return { text: match[1], url: `https://www.tiktok.com/${match[1]}` };
    }
    if (author) {
      const handle = author.startsWith("@") ? author : `@${author}`;
      return { text: handle, url: `https://www.tiktok.com/${handle}` };
    }
    return { text: "@tiktok", url: rawUrl || "https://www.tiktok.com" };
  }

  // 2. 𝕏 (Twitter)
  if (item.platform === "x" || rawUrl.includes("twitter.com") || rawUrl.includes("x.com")) {
    const match = rawUrl.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status/i);
    if (match && !["home", "explore", "notifications", "messages"].includes(match[1].toLowerCase())) {
      const handle = `@${match[1]}`;
      return { text: handle, url: `https://x.com/${match[1]}` };
    }
    if (author) {
      const handle = author.startsWith("@") ? author : `@${author}`;
      return { text: handle, url: `https://x.com/${handle.replace(/^@/, "")}` };
    }
    return { text: "@x", url: rawUrl || "https://x.com" };
  }

  // 3. Instagram
  if (item.platform === "instagram" || rawUrl.includes("instagram.com")) {
    const match = rawUrl.match(/instagram\.com\/([A-Za-z0-9_.]+)(?:\/reel|\/p|\/tv)?/i);
    if (match && !["reel", "reels", "p", "tv", "stories", "explore"].includes(match[1].toLowerCase())) {
      const handle = `@${match[1]}`;
      return { text: handle, url: `https://www.instagram.com/${match[1]}` };
    }
    if (author) {
      const handle = author.startsWith("@") ? author : `@${author}`;
      return { text: handle, url: `https://www.instagram.com/${handle.replace(/^@/, "")}` };
    }
    return { text: "@instagram", url: rawUrl || "https://www.instagram.com" };
  }

  // 4. YouTube
  if (item.platform === "youtube" || rawUrl.includes("youtube.com") || rawUrl.includes("youtu.be")) {
    const channelMatch = rawUrl.match(/youtube\.com\/(@[^/?#]+)/i);
    if (channelMatch) {
      return { text: channelMatch[1], url: `https://www.youtube.com/${channelMatch[1]}` };
    }
    if (author) {
      const display = author.startsWith("@") ? author : `@${author}`;
      return { text: display, url: rawUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(author)}` };
    }
    return { text: "YouTube Source", url: rawUrl || "https://www.youtube.com" };
  }

  // 5. Pinterest
  if (item.platform === "pinterest" || rawUrl.includes("pinterest.com") || rawUrl.includes("pin.it")) {
    const match = rawUrl.match(/pinterest\.[a-z.]+\/([A-Za-z0-9_]+)\//i);
    if (match && !["pin", "search", "ideas"].includes(match[1].toLowerCase())) {
      return { text: `@${match[1]}`, url: `https://www.pinterest.com/${match[1]}` };
    }
    if (author) {
      return { text: author.startsWith("@") ? author : `@${author}`, url: `https://www.pinterest.com/${author.replace(/^@/, "")}` };
    }
    return { text: "Pinterest Source", url: rawUrl || "https://www.pinterest.com" };
  }

  // 6. Threads
  if (item.platform === "threads" || /threads\.(?:net|com)/i.test(rawUrl)) {
    const match = rawUrl.match(/threads\.(?:net|com)\/(@[^/?#]+)/i);
    if (match) {
      return { text: match[1], url: `https://www.threads.net/${match[1]}` };
    }
    if (author) {
      const handle = author.startsWith("@") ? author : `@${author}`;
      return { text: handle, url: `https://www.threads.net/${handle}` };
    }
    return { text: "@threads", url: rawUrl || "https://www.threads.net" };
  }

  // 6. Web Media
  if (item.platform === "web_media" || /^https?:\/\//i.test(rawUrl)) {
    let hostname = "Web Media";
    try {
      hostname = new URL(rawUrl).hostname.replace(/^www\./i, "");
    } catch {
      // ignore
    }
    const handle = author ? (author.startsWith("@") ? author : `@${author}`) : `@${hostname}`;
    return { text: handle, url: rawUrl || "#" };
  }

  if (author) {
    return { text: author.startsWith("@") ? author : `@${author}`, url: rawUrl || "#" };
  }
  return { text: "Source", url: rawUrl || "#" };
}

/**
 * Safely resolves the thumbnail image URL for a download record.
 * Falls back to YouTube video ID thumbnail if the recorded thumbnailUrl is empty.
 */
export function getRecordThumbnail(item: {
  thumbnailUrl?: string;
  url?: string;
  platform?: string;
  filePath?: string;
  formatType?: string;
}): string {
  if (item.thumbnailUrl && item.thumbnailUrl.trim()) {
    const raw = item.thumbnailUrl.trim();
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("data:") ||
      raw.startsWith("asset:")
    ) {
      return raw;
    }
    return convertFileSrc(raw);
  }

  // Fallback for image downloads where thumbnailUrl wasn't saved, but filePath exists
  if (item.filePath && (item.formatType === "image" || /\.(jpg|jpeg|png|webp|gif)$/i.test(item.filePath))) {
    return convertFileSrc(item.filePath);
  }

  const rawUrl = item.url?.trim() || "";
  // YouTube fallback: extract video ID
  const ytMatch = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch && ytMatch[1]) {
    return `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
  }
  return "";
}

/**
 * Strips tracking parameters, referral tokens, and clutter from media URLs.
 * Keeps clean video IDs for YouTube, TikTok, Instagram, X/Twitter, and Pinterest.
 */
export function cleanMediaUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  let trimmed = rawUrl.trim();

  // If text contains surrounding words/labels, extract the URL substring first
  if (!/^https?:\/\//i.test(trimmed)) {
    const match = trimmed.match(/https?:\/\/[^\s]+/i);
    if (match) {
      trimmed = match[0];
    }
  }

  // Strip wrapping punctuation e.g. "(https://...)" or "https://...)"
  trimmed = stripWrappingPunctuation(trimmed);

  try {
    const parsed = new URL(trimmed);

    // 1. YouTube
    if (/youtube\.com|youtu\.be/i.test(parsed.hostname)) {
      // Shorts: https://www.youtube.com/shorts/VIDEO_ID
      const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) {
        return `https://www.youtube.com/shorts/${shortsMatch[1]}`;
      }
      // youtu.be/VIDEO_ID
      if (parsed.hostname.includes("youtu.be")) {
        const id = parsed.pathname.replace(/^\//, "").split("/")[0];
        if (id) return `https://youtu.be/${id}`;
      }
      // Standard watch?v=VIDEO_ID
      const v = parsed.searchParams.get("v");
      if (v) {
        return `https://www.youtube.com/watch?v=${v}`;
      }
      // Strip tracking params like ?si=, &feature=share
      parsed.searchParams.delete("si");
      parsed.searchParams.delete("feature");
      parsed.searchParams.delete("pp");
      parsed.searchParams.delete("fbclid");
      parsed.searchParams.delete("list");
      return parsed.toString();
    }

    // 2. Pinterest
    if (/pinterest\.com|pin\.it|pinimg\.com/i.test(parsed.hostname)) {
      // pin.it shortlink: https://pin.it/XXXX
      if (parsed.hostname.includes("pin.it")) {
        const pinId = parsed.pathname.replace(/^\//, "").split(/[/?#]/)[0];
        if (pinId) return `https://pin.it/${pinId}`;
      }

      // pinterest.com/pin/123456...
      const pinMatch = parsed.pathname.match(/\/pin\/([0-9]+)/i);
      if (pinMatch) {
        return `https://www.pinterest.com/pin/${pinMatch[1]}/`;
      }

      // Strip common tracking queries from other pinterest URLs
      const trackingParams = [
        "si", "utm_source", "utm_medium", "utm_campaign",
        "utm_term", "utm_content", "fbclid", "nic_v3", "invite_code", "sender"
      ];
      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }
      return parsed.toString();
    }

    // 3. TikTok / Instagram / X / Threads
    // Strip common tracking queries
    const trackingParams = [
      "si", "igsh", "utm_source", "utm_medium", "utm_campaign",
      "utm_term", "utm_content", "fbclid", "s", "t", "ref_src", "xmt"
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Extracts multiple valid media URLs from a block of text (e.g. multi-line paste).
 */
export function extractMultipleUrls(text: string): string[] {
  if (!text) return [];
  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) || [];
  const validUrls: string[] = [];
  const seen = new Set<string>();

  for (const raw of urlMatches) {
    const cleaned = cleanMediaUrl(raw);
    if (cleaned && isSupportedMediaUrl(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned);
      validUrls.push(cleaned);
    }
  }

  return validUrls;
}

/**
 * Formats seconds into HH:MM:SS timestamp string
 */
export function secondsToTimestamp(sec: number): string {
  if (isNaN(sec) || sec < 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Parses timestamp string (HH:MM:SS or MM:SS or raw seconds) into seconds
 */
export function timestampToSeconds(ts: string): number {
  if (!ts) return 0;
  const parts = ts.trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

/**
 * Safely extracts a readable string message from an unknown error value
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

const MEDIA_EXTENSIONS = [
  ".mp4", ".webm", ".mkv", ".mov", ".avi", ".flv", ".ts", ".m4v", ".wmv",
  ".mp3", ".m4a", ".wav", ".flac", ".aac", ".opus", ".ogg",
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".srt", ".vtt", ".txt",
];

/**
 * Strips common media, audio, image, and subtitle extensions from a filename.
 */
export function stripMediaExtension(filename?: string): string {
  if (!filename) return "";
  const trimmed = filename.trim();
  const lower = trimmed.toLowerCase();
  for (const ext of MEDIA_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return trimmed.slice(0, trimmed.length - ext.length);
    }
  }
  return trimmed;
}

/**
 * Sanitizes titles for safe display and default filenames across Windows and Web.
 * Strips trailing media extensions, newlines, control characters, and reserved Windows symbols.
 */
export function sanitizeTitle(name?: string): string {
  if (!name) return "";
  const stripped = stripMediaExtension(name);
  const cleaned = stripped
    .replace(/[\x00-\x1f\n\r\t]/g, " ")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= 80) {
    return cleaned.replace(/[.,\-_\\/\s]+$/, "");
  }

  let truncated = cleaned.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 50) {
    truncated = truncated.slice(0, lastSpace);
  }
  return truncated.trim().replace(/[.,\-_\\/\s]+$/, "");
}

/**
 * Detects whether a given title string is a raw fallback URL or generic placeholder.
 */
export function isFallbackTitle(title?: string): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "media" ||
    trimmed.toLowerCase() === "media_download" ||
    trimmed.toLowerCase() === "untitled media"
  ) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("http") ||
    lower.includes("://") ||
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("tiktok.com") ||
    lower.includes("instagram.com") ||
    lower.includes("twitter.com") ||
    lower.includes("x.com") ||
    lower.includes("pinterest.") ||
    lower.includes("pin.it") ||
    lower.includes("threads.net") ||
    lower.includes("threads.com") ||
    lower.startsWith("tiktok video") ||
    lower.startsWith("youtube video") ||
    lower.startsWith("youtube shorts") ||
    lower.startsWith("instagram post") ||
    lower.startsWith("x post") ||
    lower.startsWith("threads post") ||
    lower.startsWith("pinterest pin") ||
    lower.startsWith("pinterest media")
  );
}

/**
 * Builds a clean, human-readable fallback media title from URL and optional author.
 * Strictly avoids showing raw URLs or HTTP links in UI cards or download items.
 */
export function getFallbackMediaTitle(url: string, author?: string): string {
  const cleanUrl = url.trim();
  const cleanAuthor = author?.replace(/^@/, "").trim() || "";

  // 1. TikTok
  if (cleanUrl.includes("tiktok.com")) {
    const idMatch = cleanUrl.match(/\/video\/(\d+)/i) || cleanUrl.match(/\/photo\/(\d+)/i);
    const userMatch = cleanUrl.match(/@([^/?#]+)/i);
    const authorName = cleanAuthor || (userMatch ? userMatch[1] : "");
    const videoId = idMatch ? idMatch[1] : "";

    const baseTitle = videoId ? `TikTok Video ${videoId}` : "TikTok Video";
    return authorName ? `${baseTitle}-${authorName}` : baseTitle;
  }

  // 2. YouTube
  if (cleanUrl.includes("youtube.com") || cleanUrl.includes("youtu.be")) {
    const ytMatch = cleanUrl.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    const id = ytMatch ? ytMatch[1] : "";
    const isShorts = cleanUrl.includes("/shorts/");
    const baseTitle = isShorts ? `YouTube Shorts ${id}` : `YouTube Video ${id}`;
    return cleanAuthor ? `${baseTitle}-${cleanAuthor}` : baseTitle;
  }

  // 3. Instagram
  if (cleanUrl.includes("instagram.com")) {
    const idMatch = cleanUrl.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    const userMatch = cleanUrl.match(/instagram\.com\/([A-Za-z0-9_.]+)(?:\/reel|\/p|\/tv)?/i);
    const authorName = cleanAuthor || (userMatch && !["p", "reel", "reels", "tv", "stories", "explore"].includes(userMatch[1].toLowerCase()) ? userMatch[1] : "");
    const shortcode = idMatch ? idMatch[1] : "";

    const baseTitle = shortcode ? `Instagram Post ${shortcode}` : "Instagram Post";
    return authorName ? `${baseTitle}-${authorName}` : baseTitle;
  }

  // 4. X (Twitter)
  if (cleanUrl.includes("twitter.com") || cleanUrl.includes("x.com")) {
    const idMatch = cleanUrl.match(/\/status\/(\d+)/i);
    const userMatch = cleanUrl.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status/i);
    const authorName = cleanAuthor || (userMatch && !["home", "explore", "notifications", "messages"].includes(userMatch[1].toLowerCase()) ? userMatch[1] : "");
    const postId = idMatch ? idMatch[1] : "";

    const baseTitle = postId ? `X Post ${postId}` : "X Post";
    return authorName ? `${baseTitle}-${authorName}` : baseTitle;
  }

  // 5. Threads
  if (cleanUrl.includes("threads.net") || cleanUrl.includes("threads.com")) {
    const idMatch = cleanUrl.match(/\/post\/([A-Za-z0-9_-]+)/i);
    const userMatch = cleanUrl.match(/threads\.(?:net|com)\/@([A-Za-z0-9_.]+)/i);
    const authorName = cleanAuthor || (userMatch ? userMatch[1] : "");
    const postId = idMatch ? idMatch[1] : "";

    const baseTitle = postId ? `Threads Post ${postId}` : "Threads Post";
    return authorName ? `${baseTitle}-${authorName}` : baseTitle;
  }

  // 6. Pinterest
  if (cleanUrl.includes("pinterest.") || cleanUrl.includes("pin.it")) {
    const idMatch = cleanUrl.match(/\/pin\/(\d+)/i);
    const pinId = idMatch ? idMatch[1] : "";
    return pinId ? `Pinterest Pin ${pinId}` : "Pinterest Media";
  }

  return cleanAuthor ? `Media Download-${cleanAuthor}` : "Media Download";
}

/**
 * Resolves the platform or domain source name for a given media URL.
 */
export function getSourcePlatformName(url?: string): string {
  if (!url || !url.trim()) return "Media";
  const platform = detectPlatform(url);
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "x":
      return "X";
    case "threads":
      return "Threads";
    case "pinterest":
      return "Pinterest";
    case "web_media":
    default: {
      try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./i, "");
        const part = host.split(".")[0];
        if (part) {
          return part.charAt(0).toUpperCase() + part.slice(1);
        }
      } catch {
        // Ignored
      }
      return "WebMedia";
    }
  }
}

/**
 * Builds the canonical output filename following the convention:
 * - TikTok: $description-$channel.$format (fallback to title if description empty, fallback to uploader if channel empty)
 * - YouTube: $title-$uploader_id.$format (stripping leading '@', fallback to channel/uploader)
 * - Other: $title-$author.$format
 */
export function buildOutputFileName(params: {
  title?: string;
  description?: string;
  customName?: string;
  author?: string;
  channel?: string;
  uploaderId?: string;
  url?: string;
  platform?: string;
  formatType?: string;
  quality?: string;
  format?: string;
  videoFilenameFormat?: string;
}): string {
  const {
    title,
    description,
    customName,
    author,
    channel,
    uploaderId,
    url = "",
    platform,
    formatType,
    quality,
    format,
    videoFilenameFormat,
  } = params;

  const ext =
    format ||
    (formatType === "audio"
      ? ["mp3", "m4a", "wav", "flac"].includes(quality || "")
        ? quality!
        : "mp3"
      : formatType === "subtitle"
      ? "srt"
      : formatType === "image"
      ? "jpg"
      : "mp4");

  const isInvalid = (s?: string) => {
    if (!s) return true;
    const l = s.trim().toLowerCase();
    return !l || l === "na" || l === "n/a" || l === "unknown" || l === "none" || l === "media_download";
  };

  const detectedPlatform = platform || detectPlatform(url);
  const isTikTok = detectedPlatform === "tiktok" || url.includes("tiktok.com");
  const isYouTube = detectedPlatform === "youtube" || url.includes("youtube.com") || url.includes("youtu.be");

  // Determine base title / stem
  let rawBase = "";
  if (customName && customName.trim()) {
    rawBase = sanitizeTitle(customName);
  } else if (isTikTok) {
    // For TikTok: prioritize description (full caption & hashtags), fallback to title
    if (description && !isFallbackTitle(description)) {
      rawBase = sanitizeTitle(description);
    } else if (title && !isFallbackTitle(title)) {
      rawBase = sanitizeTitle(title);
    }
  } else {
    if (title && !isFallbackTitle(title)) {
      rawBase = sanitizeTitle(title);
    }
  }

  const baseTitle =
    rawBase ||
    getFallbackMediaTitle(url, !isInvalid(author) ? author : (!isInvalid(channel) ? channel : undefined));
  const cleanBase = stripMediaExtension(baseTitle);

  if (videoFilenameFormat === "title_only") {
    return `${cleanBase}.${ext}`;
  }

  // Resolve author/channel/source suffix
  let authorOrSource = "";
  if (isTikTok) {
    // TikTok: prefer channel display name, fallback to author/uploader, fallback to "TikTok"
    const cleanChannel = !isInvalid(channel) ? sanitizeTitle(channel) : "";
    const cleanAuthor = !isInvalid(author) ? sanitizeTitle(author?.replace(/^@/, "")) : "";
    authorOrSource = cleanChannel || cleanAuthor || "TikTok";
  } else if (isYouTube) {
    // YouTube: prefer uploader_id (stripping leading @), fallback to channel, fallback to author, fallback to "YouTube"
    const cleanUploaderId = !isInvalid(uploaderId) ? sanitizeTitle(uploaderId?.replace(/^@/, "")) : "";
    const cleanChannel = !isInvalid(channel) ? sanitizeTitle(channel) : "";
    const cleanAuthor = !isInvalid(author) ? sanitizeTitle(author?.replace(/^@/, "")) : "";
    authorOrSource = cleanUploaderId || cleanChannel || cleanAuthor || "YouTube";
  } else {
    // Other platforms: author, then channel, then platform source name
    const cleanAuthor = !isInvalid(author) ? sanitizeTitle(author?.replace(/^@/, "")) : "";
    const cleanChannel = !isInvalid(channel) ? sanitizeTitle(channel) : "";
    authorOrSource = cleanAuthor || cleanChannel || getSourcePlatformName(url);
  }

  // Cap suffix to 40 characters
  authorOrSource = authorOrSource.slice(0, 40).trim();

  const cleanLower = cleanBase.toLowerCase();
  const authorLower = authorOrSource.toLowerCase();

  let stem = cleanBase;
  if (
    authorOrSource &&
    !cleanLower.endsWith(authorLower) &&
    !cleanLower.startsWith(authorLower) &&
    !cleanLower.includes(`-${authorLower}`) &&
    !cleanLower.includes(`_${authorLower}`)
  ) {
    stem = `${cleanBase}-${authorOrSource}`;
  }

  return `${stem}.${ext}`;
}

/**
 * Returns a human-friendly display title for any record or active task.
 * In Media Vault, prioritizes the exact output filename so it matches the downloaded file.
 */
export function getDisplayTitle(itemOrTask: {
  title?: string;
  url?: string;
  author?: string;
  filePath?: string;
}): string {
  // 1. If filePath is present (e.g. completed download in Media Vault), return the filename on disk
  if (itemOrTask.filePath) {
    const filename = itemOrTask.filePath.split(/[/\\]/).pop();
    if (filename && !isFallbackTitle(filename)) {
      return filename;
    }
  }

  // 2. Use title if valid
  const rawTitle = itemOrTask.title?.trim() || "";
  if (rawTitle && !isFallbackTitle(rawTitle)) {
    return rawTitle;
  }

  // 3. Fallback
  if (itemOrTask.url) {
    return getFallbackMediaTitle(itemOrTask.url, itemOrTask.author);
  }
  return rawTitle || "Media Download";
}





