import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DownloadRecord, DownloaderPlatform } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function detectPlatform(inputUrl: string): DownloaderPlatform {
  if (!inputUrl) return "generic";
  const trimmed = inputUrl.trim();
  if (/youtube\.com|youtu\.be/i.test(trimmed)) return "youtube";
  if (/tiktok\.com/i.test(trimmed)) return "tiktok";
  if (/instagram\.com/i.test(trimmed)) return "instagram";
  if (/twitter\.com|x\.com/i.test(trimmed)) return "x";
  if (/pinterest\.com|pin\.it/i.test(trimmed)) return "pinterest";
  if (/^https?:\/\//i.test(trimmed)) return "web_media";
  return "generic";
}

export function isSupportedMediaUrl(inputUrl: string): boolean {
  if (!inputUrl) return false;
  const trimmed = inputUrl.trim();
  if (!/^https?:\/\/.+/i.test(trimmed)) return false;
  const platform = detectPlatform(trimmed);
  return platform !== "generic";
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
  const author = item.author?.trim() || "";
  const rawUrl = item.url?.trim() || "";

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
export function getRecordThumbnail(item: { thumbnailUrl?: string; url?: string; platform?: string }): string {
  if (item.thumbnailUrl && item.thumbnailUrl.trim()) {
    return item.thumbnailUrl.trim();
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
  const trimmed = rawUrl.trim();
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

    // 2. TikTok / Instagram / X / Pinterest
    // Strip common tracking queries
    const trackingParams = [
      "si", "igsh", "utm_source", "utm_medium", "utm_campaign",
      "utm_term", "utm_content", "fbclid", "s", "t", "ref_src"
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
  const lines = text.split(/[\r\n\s]+/);
  const validUrls: string[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const cleaned = cleanMediaUrl(raw);
    if (cleaned && isSupportedMediaUrl(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned);
      validUrls.push(cleaned);
    }
  }

  return validUrls;
}

