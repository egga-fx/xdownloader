import { describe, expect, it, beforeEach } from "bun:test";
import {
  isTauriEnvironment,
  checkBinariesStatus,
  getAppSettings,
  saveAppSettings,
  onDownloadProgress,
  onBinaryDownloadProgress,
  getRecentLogs,
  clearAppLogs,
  appendMockLog,
  openLogsFolder,
  splitLocalVideo,
  splitStreamVideo,
  trimLocalVideoExact,
  trimStreamVideoExact,
  resetMockStorage,
  getVideoMetadata,
} from "../src/lib/tauri-api";
import { ActiveDownloadTask, LogEntry } from "../src/types";

describe("AI Spec-First Contract Tests: src/lib/tauri-api.ts", () => {
  beforeEach(() => {
    resetMockStorage();
  });

  // --- 1. Tauri Environment Detection ---
  describe("isTauriEnvironment() [Environment Guard]", () => {
    it("should return false in headless Bun test runner without Tauri globals", () => {
      expect(isTauriEnvironment()).toBe(false);
    });

    it("should return true when window.__TAURI_INTERNALS__ is defined", () => {
      const originalWindow = (globalThis as unknown as { window?: unknown }).window;
      try {
        (globalThis as unknown as { window: { __TAURI_INTERNALS__: Record<string, unknown> } }).window = {
          __TAURI_INTERNALS__: { invoke: () => {} },
        };
        expect(isTauriEnvironment()).toBe(true);
      } finally {
        if (originalWindow !== undefined) {
          (globalThis as unknown as { window: unknown }).window = originalWindow;
        } else {
          delete (globalThis as unknown as { window?: unknown }).window;
        }
      }
    });
  });

  // --- 2. Binaries Status & Fallback ---
  describe("checkBinariesStatus() [Web Preview Fallback]", () => {
    it("should return valid fallback status object without crashing", async () => {
      const status = await checkBinariesStatus();
      expect(status).toBeDefined();
      expect(status).toHaveProperty("ytdlp_installed");
      expect(status).toHaveProperty("ffmpeg_installed");
      expect(status.bin_dir).toContain("Web Preview");
    });
  });

  // --- 3. App Settings Lifecycle ---
  describe("getAppSettings() & saveAppSettings() [Persistence Contract]", () => {
    it("should return default application settings when storage is empty", async () => {
      const settings = await getAppSettings();
      expect(settings).toBeDefined();
      expect(settings.outputFolder).toBe("Videos\\xDownloader");
      expect(settings.defaultVideoQuality).toBe("1080p");
      expect(settings.defaultAudioQuality).toBe("mp3");
      expect(settings.autoClipboardDetect).toBe(true);
    });

    it("should merge and persist updated settings", async () => {
      const saved = await saveAppSettings({
        defaultVideoQuality: "720p",
        downloadSubtitles: true,
      });
      expect(saved).toBe(true);

      const updated = await getAppSettings();
      expect(updated.defaultVideoQuality).toBe("720p");
      expect(updated.downloadSubtitles).toBe(true);
      // Preserved defaults:
      expect(updated.outputFolder).toBe("Videos\\xDownloader");
      expect(updated.defaultAudioQuality).toBe("mp3");
    });
  });

  // --- 4. Event Bus Subscription & Cleanup ---
  describe("Event Listeners: onDownloadProgress & onBinaryDownloadProgress", () => {
    it("should register listener and permit unlistening without memory leak", async () => {
      const receivedTasks: ActiveDownloadTask[] = [];
      const listener = (task: ActiveDownloadTask) => {
        receivedTasks.push(task);
      };

      const unlisten = await onDownloadProgress(listener);
      expect(typeof unlisten).toBe("function");

      // Cleanup
      unlisten();
    });

    it("should register binary download progress listener and unlisten cleanly", async () => {
      const events: { binaryType: string; percent: number }[] = [];
      const listener = (data: { binaryType: string; percent: number }) => {
        events.push(data);
      };

      const unlisten = await onBinaryDownloadProgress(listener);
      expect(typeof unlisten).toBe("function");
      unlisten();
    });
  });

  // --- 5. Logging & Diagnostics Contract ---
  describe("getRecentLogs(), appendMockLog(), clearAppLogs(), & openLogsFolder()", () => {
    it("should return default initialization entry when log store is empty", async () => {
      const logs = await getRecentLogs(50);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].taskId).toBe("sys_init");
      expect(logs[0].level).toBe("INFO");
    });

    it("should append mock logs and respect level filtering", async () => {
      appendMockLog({
        taskId: "task-001",
        level: "INFO",
        category: "DOWNLOAD",
        message: "Download started for YouTube stream",
      });
      appendMockLog({
        taskId: "task-002",
        level: "ERROR",
        category: "PROCESS",
        message: "FFmpeg process failed with exit code 1",
        details: "Invalid container parameters",
      });

      const allLogs = await getRecentLogs(50);
      expect(allLogs.length).toBe(2);

      const errorLogs = await getRecentLogs(50, "ERROR");
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0].taskId).toBe("task-002");
      expect(errorLogs[0].level).toBe("ERROR");

      const infoLogs = await getRecentLogs(50, "INFO");
      expect(infoLogs.length).toBe(1);
      expect(infoLogs[0].taskId).toBe("task-001");
    });

    it("should clear mock logs completely via clearAppLogs()", async () => {
      appendMockLog({
        taskId: "task-test",
        level: "WARN",
        category: "STORAGE",
        message: "Disk space running low",
      });

      const cleared = await clearAppLogs();
      expect(cleared).toBe(true);

      // After clearing, it falls back to the default init entry
      const logs = await getRecentLogs(50);
      expect(logs.length).toBe(1);
      expect(logs[0].taskId).toBe("sys_init");
    });

    it("should return true for openLogsFolder() in preview mode", async () => {
      const opened = await openLogsFolder();
      expect(opened).toBe(true);
    });
  });

  // --- 6. Media Studio Preview Simulation ---
  describe("Media Studio preview methods", () => {
    it("should return generated part filepaths for splitLocalVideo()", async () => {
      const parts = await splitLocalVideo({
        filePath: "C:\\Videos\\sample.mp4",
        segments: [
          { partIndex: 1, start: "00:00:00", end: "00:01:00" },
          { partIndex: 2, start: "00:01:00", end: "00:02:00" },
        ],
      });
      expect(parts).toHaveLength(2);
      expect(parts[0]).toContain("sample.mp4_part_01.mp4");
      expect(parts[1]).toContain("sample.mp4_part_02.mp4");
    });

    it("should return task identifiers for splitStreamVideo()", async () => {
      const tasks = await splitStreamVideo({
        url: "https://example.com/video.mp4",
        segments: [
          { partIndex: 1, start: "00:00:00", end: "00:00:30" },
        ],
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toBe("mock_task_1");
    });

    it("should return expected trimmed paths for trimLocalVideoExact() and trimStreamVideoExact()", async () => {
      const localResult = await trimLocalVideoExact({
        filePath: "C:\\Videos\\test.mp4",
        startSec: 10,
        endSec: 25,
      });
      expect(localResult).toContain("test.mp4_trim_");

      const streamResult = await trimStreamVideoExact({
        url: "https://youtube.com/watch?v=sample",
        startSec: 0,
        endSec: 15,
      });
      expect(streamResult).toContain("trim_task_");
    });

    it("should return carousel image bundle structure for photo/image posts in preview mode", async () => {
      const pinResult = await getVideoMetadata("https://pin.it/7xYz123");
      expect(pinResult).toBeDefined();
      expect(pinResult.description).toBe("image");
      expect(pinResult.images).toBeDefined();
      expect(Array.isArray(pinResult.images)).toBe(true);
      expect((pinResult.images || []).length).toBeGreaterThan(1);
    });
  });
});
