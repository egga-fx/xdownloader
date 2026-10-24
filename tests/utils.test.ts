import { describe, expect, it } from "bun:test";
import {
  detectPlatform,
  isSupportedMediaUrl,
  formatDuration,
  formatFileSize,
  isRecordCorruptOrMissing,
  cleanMediaUrl,
  extractMultipleUrls,
  secondsToTimestamp,
  timestampToSeconds,
  getErrorMessage,
  sanitizeTitle,
  stripMediaExtension,
  getSourcePlatformName,
  buildOutputFileName,
} from "../src/lib/utils";

describe("AI Spec-First Audit: src/lib/utils.ts", () => {
  // --- 1. detectPlatform & isSupportedMediaUrl ---
  describe("detectPlatform() & isSupportedMediaUrl() [Boundary & Anti-Spoofing]", () => {
    it("should return 'generic' and false for empty or whitespace-only inputs", () => {
      expect(detectPlatform("")).toBe("generic");
      expect(detectPlatform("   ")).toBe("generic");
      expect(isSupportedMediaUrl("")).toBe(false);
      expect(isSupportedMediaUrl("   ")).toBe(false);
    });

    it("should accurately detect YouTube variants", () => {
      expect(detectPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
      expect(detectPlatform("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
      expect(detectPlatform("https://youtube.com/shorts/abc123xyz")).toBe("youtube");
      expect(isSupportedMediaUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    });

    it("should accurately detect Threads, TikTok, Instagram, X/Twitter, and Pinterest", () => {
      expect(detectPlatform("https://www.threads.com/@mirasammm/post/Dd7qshgk7ev")).toBe("threads");
      expect(detectPlatform("https://www.threads.net/@digitalbynonnanii/post/Dd6hc6HGKSS/media")).toBe("threads");
      expect(detectPlatform("https://www.threads.com/share/D5iSbKNRg/")).toBe("threads");
      expect(isSupportedMediaUrl("https://www.threads.com/@mirasammm/post/Dd7qshgk7ev")).toBe(true);
      expect(isSupportedMediaUrl("https://www.threads.com/share/D5iSbKNRg/")).toBe(true);
      expect(detectPlatform("https://www.tiktok.com/@user/video/123456789")).toBe("tiktok");
      expect(detectPlatform("https://www.instagram.com/reel/C8xyz123/")).toBe("instagram");
      expect(detectPlatform("https://x.com/username/status/1234567890")).toBe("x");
      expect(detectPlatform("https://twitter.com/username/status/1234567890")).toBe("x");
      expect(detectPlatform("https://pin.it/7xYz123")).toBe("pinterest");
      expect(detectPlatform("https://www.pinterest.com/pin/123456789/")).toBe("pinterest");
    });

    it("should classify direct media URLs as 'web_media'", () => {
      expect(detectPlatform("https://example.com/video.mp4")).toBe("web_media");
      expect(isSupportedMediaUrl("https://example.com/video.mp4")).toBe(true);
    });

    it("should reject non-HTTP schemes and arbitrary invalid strings", () => {
      expect(isSupportedMediaUrl("ftp://example.com/file.mp4")).toBe(false);
      expect(isSupportedMediaUrl("not_a_url_at_all")).toBe(false);
    });

    it("should reject bare platform root domains as non-media URLs", () => {
      expect(isSupportedMediaUrl("https://pinterest.com")).toBe(false);
      expect(isSupportedMediaUrl("https://pinterest.com/")).toBe(false);
      expect(isSupportedMediaUrl("https://www.pinterest.com")).toBe(false);
      expect(isSupportedMediaUrl("https://www.pinterest.com/")).toBe(false);
      expect(isSupportedMediaUrl("https://id.pinterest.com/")).toBe(false);
      expect(isSupportedMediaUrl("https://youtube.com")).toBe(false);
      expect(isSupportedMediaUrl("https://www.youtube.com/")).toBe(false);
      expect(isSupportedMediaUrl("https://instagram.com/")).toBe(false);
      expect(isSupportedMediaUrl("https://tiktok.com/")).toBe(false);
      expect(isSupportedMediaUrl("https://x.com/")).toBe(false);
    });
  });

  // --- 2. formatDuration ---
  describe("formatDuration() [Numerical Boundaries]", () => {
    it("should return '0:00' for zero, NaN, or falsy values", () => {
      expect(formatDuration(0)).toBe("0:00");
      expect(formatDuration(NaN)).toBe("0:00");
    });

    it("should format single-digit and double-digit seconds with padding", () => {
      expect(formatDuration(5)).toBe("0:05");
      expect(formatDuration(45)).toBe("0:45");
      expect(formatDuration(60)).toBe("1:00");
      expect(formatDuration(75)).toBe("1:15");
      expect(formatDuration(3599)).toBe("59:59");
    });
  });

  // --- 3. formatFileSize ---
  describe("formatFileSize() [Byte Scale Boundaries]", () => {
    it("should return '0 B' for 0, negative values, NaN, or undefined", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(-100)).toBe("0 B");
      expect(formatFileSize(NaN)).toBe("0 B");
      expect(formatFileSize(undefined)).toBe("0 B");
    });

    it("should accurately scale across B, KB, MB, and GB boundaries", () => {
      expect(formatFileSize(500)).toBe("500.0 B");
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(1048576)).toBe("1.0 MB");
      expect(formatFileSize(1073741824)).toBe("1.0 GB");
    });
  });

  // --- 4. isRecordCorruptOrMissing ---
  describe("isRecordCorruptOrMissing() [Defensive Verification]", () => {
    it("should return true for null or undefined input", () => {
      expect(isRecordCorruptOrMissing(null)).toBe(true);
      expect(isRecordCorruptOrMissing(undefined)).toBe(true);
    });

    it("should return true if file is explicitly flagged missing or error", () => {
      expect(isRecordCorruptOrMissing({ exists: false, filePath: "C:/video.mp4" })).toBe(true);
      expect(isRecordCorruptOrMissing({ status: "error", filePath: "C:/video.mp4" })).toBe(true);
      expect(isRecordCorruptOrMissing({ error: "Download failed", filePath: "C:/video.mp4" })).toBe(true);
    });

    it("should return true for empty path or zero bytes file", () => {
      expect(isRecordCorruptOrMissing({ filePath: "", fileSizeBytes: 1024 })).toBe(true);
      expect(isRecordCorruptOrMissing({ filePath: "   ", fileSizeBytes: 1024 })).toBe(true);
      expect(isRecordCorruptOrMissing({ filePath: "C:/video.mp4", fileSizeBytes: 0 })).toBe(true);
      expect(isRecordCorruptOrMissing({ filePath: "C:/video.mp4", fileSizeBytes: -5 })).toBe(true);
    });

    it("should return false for valid existing file with positive size and no errors", () => {
      expect(
        isRecordCorruptOrMissing({
          exists: true,
          status: "completed",
          filePath: "C:/downloads/video.mp4",
          fileSizeBytes: 2048000,
        })
      ).toBe(false);
    });
  });

  // --- 5. cleanMediaUrl & extractMultipleUrls ---
  describe("cleanMediaUrl() & extractMultipleUrls() [Sanitization & De-duplication]", () => {
    it("should strip YouTube tracking parameters while preserving video ID", () => {
      const dirtyYt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=trackingToken123&feature=share";
      expect(cleanMediaUrl(dirtyYt)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });

    it("should preserve YouTube Shorts video path without parameters", () => {
      const dirtyShorts = "https://www.youtube.com/shorts/abcdef12345?si=share123";
      expect(cleanMediaUrl(dirtyShorts)).toBe("https://www.youtube.com/shorts/abcdef12345");
    });

    it("should strip common tracking parameters from social platforms", () => {
      const dirtyIg = "https://www.instagram.com/reel/C8xyz123/?igsh=token123&utm_source=ig_web_copy_link";
      expect(cleanMediaUrl(dirtyIg)).toBe("https://www.instagram.com/reel/C8xyz123/");
    });

    it("should return empty string on falsy input", () => {
      expect(cleanMediaUrl("")).toBe("");
    });

    it("should extract and de-duplicate multiple valid URLs from text block", () => {
      const textBlock = `
        Check this: https://youtu.be/dQw4w9WgXcQ
        And this duplicate: https://youtu.be/dQw4w9WgXcQ?si=token
        Also TikTok: https://www.tiktok.com/@user/video/123456789
        Random string that is not a url
      `;
      const extracted = extractMultipleUrls(textBlock);
      expect(extracted).toHaveLength(2);
      expect(extracted[0]).toBe("https://youtu.be/dQw4w9WgXcQ");
      expect(extracted[1]).toBe("https://www.tiktok.com/@user/video/123456789");
    });

    it("should extract and sanitize Pinterest video/pin share text with attribution", () => {
      const shareText = "Check out this idea on Pinterest: https://pin.it/3X9v5Yz (via https://pinterest.com)";
      expect(cleanMediaUrl(shareText)).toBe("https://pin.it/3X9v5Yz");

      const extracted = extractMultipleUrls(shareText);
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toBe("https://pin.it/3X9v5Yz");
    });

    it("should clean Pinterest pin URLs with tracking parameters", () => {
      const dirtyPin = "https://www.pinterest.com/pin/1020065265557766020/?invite_code=123&sender=456&nic_v3=1";
      expect(cleanMediaUrl(dirtyPin)).toBe("https://www.pinterest.com/pin/1020065265557766020/");
    });
  });

  // --- 6. Timestamp Conversions & Splitting Presets ---
  describe("secondsToTimestamp() & timestampToSeconds() [Bidirectional Invariant]", () => {
    it("should format seconds to HH:MM:SS with leading zeroes", () => {
      expect(secondsToTimestamp(0)).toBe("00:00:00");
      expect(secondsToTimestamp(65)).toBe("00:01:05");
      expect(secondsToTimestamp(3665)).toBe("01:01:05");
    });

    it("should return '00:00:00' for negative or NaN seconds", () => {
      expect(secondsToTimestamp(-10)).toBe("00:00:00");
      expect(secondsToTimestamp(NaN)).toBe("00:00:00");
    });

    it("should parse 3-part (HH:MM:SS), 2-part (MM:SS), and 1-part timestamps", () => {
      expect(timestampToSeconds("01:01:05")).toBe(3665);
      expect(timestampToSeconds("02:30")).toBe(150);
      expect(timestampToSeconds("45")).toBe(45);
      expect(timestampToSeconds("")).toBe(0);
      expect(timestampToSeconds("invalid:ts")).toBe(0);
    });

    it("should preserve bidirectional symmetry: timestampToSeconds(secondsToTimestamp(x)) === x", () => {
      const testCases = [0, 1, 59, 60, 3599, 3600, 7245];
      for (const val of testCases) {
        expect(timestampToSeconds(secondsToTimestamp(val))).toBe(val);
      }
    });
  });

  // --- 7. getErrorMessage ---
  describe("getErrorMessage() [Type Polymorphism]", () => {
    it("should extract message from standard Error instances", () => {
      expect(getErrorMessage(new Error("Database locked"))).toBe("Database locked");
    });

    it("should return primitive string directly", () => {
      expect(getErrorMessage("Connection refused")).toBe("Connection refused");
    });

    it("should extract message property from object duck-typing", () => {
      expect(getErrorMessage({ message: "Custom object error" })).toBe("Custom object error");
    });

    it("should safely convert numbers, booleans, or null/undefined to string", () => {
      expect(getErrorMessage(500)).toBe("500");
      expect(getErrorMessage(null)).toBe("null");
      expect(getErrorMessage(undefined)).toBe("undefined");
    });
  });

  // --- 8. sanitizeTitle ---
  describe("sanitizeTitle() [Windows & Web Filename Sanitization]", () => {
    it("should return empty string for undefined or empty input", () => {
      expect(sanitizeTitle("")).toBe("");
      expect(sanitizeTitle(undefined)).toBe("");
    });

    it("should strip newlines, carriage returns, tabs, and control characters", () => {
      const input = "Full percakapan Rocky Gerung.\n\nPasca dilantik sebagai anggota.\r\n\tWartawan";
      const result = sanitizeTitle(input);
      expect(result).not.toContain("\n");
      expect(result).not.toContain("\r");
      expect(result).not.toContain("\t");
      expect(result).toContain("Full percakapan Rocky Gerung. Pasca dilantik sebagai anggota. Wartawan");
    });

    it("should replace invalid Windows filesystem characters", () => {
      const input = 'Sample / Video : Part * 1 ? "Quotes" <Bracket> | Pipe';
      const result = sanitizeTitle(input);
      expect(result).not.toMatch(/[\\/:*?"<>|]/);
      expect(result).toBe("Sample Video Part 1 Quotes Bracket Pipe");
    });

    it("should collapse multiple consecutive spaces and trim ending dots/spaces", () => {
      const input = "   Too    Many     Spaces   ...   ";
      expect(sanitizeTitle(input)).toBe("Too Many Spaces");
    });

    it("should truncate stem to max 80 characters", () => {
      const longTitle = "A".repeat(120);
      const result = sanitizeTitle(longTitle);
      expect(result.length).toBeLessThanOrEqual(80);
    });

    it("should strip trailing media extensions to prevent double-extension output", () => {
      expect(sanitizeTitle("my_custom_video.mp4")).toBe("my_custom_video");
      expect(sanitizeTitle("podcast_episode.MP3")).toBe("podcast_episode");
      expect(sanitizeTitle("photo_slide.jpg")).toBe("photo_slide");
      expect(sanitizeTitle("subtitles_id.srt")).toBe("subtitles_id");
      expect(sanitizeTitle("complex.clip.name.webm")).toBe("complex.clip.name");
    });
  });

  // --- 9. stripMediaExtension ---
  describe("stripMediaExtension()", () => {
    it("should return empty string for undefined or empty input", () => {
      expect(stripMediaExtension("")).toBe("");
      expect(stripMediaExtension(undefined)).toBe("");
    });

    it("should strip video, audio, image, and subtitle extensions case-insensitively", () => {
      expect(stripMediaExtension("video.mp4")).toBe("video");
      expect(stripMediaExtension("video.MKV")).toBe("video");
      expect(stripMediaExtension("audio.m4a")).toBe("audio");
      expect(stripMediaExtension("image.PNG")).toBe("image");
      expect(stripMediaExtension("captions.vtt")).toBe("captions");
      expect(stripMediaExtension("plain_text.txt")).toBe("plain_text");
    });

    it("should leave filenames without media extensions untouched", () => {
      expect(stripMediaExtension("my_great_video")).toBe("my_great_video");
      expect(stripMediaExtension("archive.tar.gz")).toBe("archive.tar.gz");
    });
  });

  // --- 10. getSourcePlatformName ---
  describe("getSourcePlatformName()", () => {
    it("should resolve human-friendly names for recognized platforms", () => {
      expect(getSourcePlatformName("https://www.youtube.com/watch?v=123")).toBe("YouTube");
      expect(getSourcePlatformName("https://tiktok.com/@creator/video/123")).toBe("TikTok");
      expect(getSourcePlatformName("https://instagram.com/reel/123")).toBe("Instagram");
      expect(getSourcePlatformName("https://x.com/user/status/123")).toBe("X");
      expect(getSourcePlatformName("https://threads.net/@user/post/123")).toBe("Threads");
      expect(getSourcePlatformName("https://pin.it/123")).toBe("Pinterest");
    });

    it("should extract host/domain name or fallback for arbitrary URLs", () => {
      expect(getSourcePlatformName("https://vimeo.com/123456")).toBe("Vimeo");
      expect(getSourcePlatformName("")).toBe("Media");
    });
  });

  // --- 11. buildOutputFileName ---
  describe("buildOutputFileName() [$file_name-$author/channel/source_name.$format]", () => {
    it("should format as file_name-author.format when author is provided", () => {
      const result = buildOutputFileName({
        title: "Awesome Podcast Episode 1",
        author: "JohnDoe",
        format: "mp4",
      });
      expect(result).toBe("Awesome Podcast Episode 1-JohnDoe.mp4");
    });

    it("should fall back to channel when author is empty or na", () => {
      const result = buildOutputFileName({
        title: "Awesome Podcast Episode 1",
        author: "na",
        channel: "TechChannel",
        format: "mp4",
      });
      expect(result).toBe("Awesome Podcast Episode 1-TechChannel.mp4");
    });

    it("should fall back to source_name derived from URL when author and channel are missing", () => {
      const result = buildOutputFileName({
        title: "Short Clip",
        url: "https://www.youtube.com/watch?v=xyz",
        format: "mp4",
      });
      expect(result).toBe("Short Clip-YouTube.mp4");
    });

    it("should avoid duplicate author suffix if title already ends with or starts with author", () => {
      const result = buildOutputFileName({
        title: "Veritasium - The Science of Thinking",
        author: "Veritasium",
        format: "mp4",
      });
      expect(result).toBe("Veritasium - The Science of Thinking.mp4");
    });

    it("should clean media extension from incoming title to avoid double extension", () => {
      const result = buildOutputFileName({
        title: "Funny Cat Video.mp4",
        author: "CatLover",
        format: "mp4",
      });
      expect(result).toBe("Funny Cat Video-CatLover.mp4");
    });

    it("should use description as stem and channel as suffix for TikTok with hashtags preserved", () => {
      const result = buildOutputFileName({
        title: "TikTok Video 12345...",
        description: "Tips coding pemula agar cepat mahir #coding #pemula #belajar",
        author: "indonesia_hariini",
        channel: "Indonesia Hari Ini??",
        url: "https://www.tiktok.com/@indonesia_hariini/video/7699391539155307783",
        format: "mp4",
      });
      expect(result).toBe("Tips coding pemula agar cepat mahir #coding #pemula #belajar-Indonesia Hari Ini.mp4");
    });

    it("should truncate long TikTok descriptions cleanly at word boundary under 80 chars", () => {
      const result = buildOutputFileName({
        description: "Menteri ESDM, Bahlil Lahadalia pertegas akan menghentikan ekspor gas alam (LNG) mulai 2026. #eksporgas #menteriesdm",
        author: "indonesia_hariini",
        channel: "Indonesia Hari Ini",
        url: "https://www.tiktok.com/@indonesia_hariini/video/7699391539155307783",
        format: "mp4",
      });
      expect(result).toBe("Menteri ESDM, Bahlil Lahadalia pertegas akan menghentikan ekspor gas alam (LNG)-Indonesia Hari Ini.mp4");
    });

    it("should use video title and uploaderId (without @) for YouTube", () => {
      const result = buildOutputFileName({
        title: "Me at the zoo",
        author: "jawed",
        channel: "jawed",
        uploaderId: "@jawed",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        format: "mp4",
      });
      expect(result).toBe("Me at the zoo-jawed.mp4");
    });

    it("should use video title and strip @ from uploaderId for Veritasium on YouTube", () => {
      const result = buildOutputFileName({
        title: "How To Solve The 100 Prisoners Riddle",
        author: "Veritasium",
        channel: "Veritasium",
        uploaderId: "@veritasium",
        url: "https://www.youtube.com/watch?v=iSNsgj1OCLA",
        format: "mp4",
      });
      expect(result).toBe("How To Solve The 100 Prisoners Riddle-veritasium.mp4");
    });
  });
});
