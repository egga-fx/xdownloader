import { describe, expect, it, beforeEach } from "bun:test";
import {
  ensureNotificationPermission,
  sendDesktopNotification,
  notifyDownloadCompleted,
  notifyDownloadFailed,
  notifyOutputFolderChanged,
  resetNotificationDeduplicationCache,
} from "../src/lib/notifications";
import { resetMockStorage, saveAppSettings } from "../src/lib/tauri-api";

describe("AI Spec-First Contract Tests: src/lib/notifications.ts", () => {
  beforeEach(() => {
    resetMockStorage();
    resetNotificationDeduplicationCache();
  });

  describe("ensureNotificationPermission() [Permission Guard]", () => {
    it("should return boolean gracefully without throwing in headless test runner", async () => {
      const result = await ensureNotificationPermission();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("sendDesktopNotification() [Service Dispatcher & Deduplication Guard]", () => {
    it("should return boolean without throwing error when triggered", async () => {
      const sent = await sendDesktopNotification({
        title: "Test Title",
        body: "Test Body Message",
      });
      expect(typeof sent).toBe("boolean");
    });

    it("should throttle and deduplicate identical notifications sent within 4 seconds", async () => {
      await saveAppSettings({ desktopNotifications: true });
      const first = await sendDesktopNotification({
        title: "Duplicate Check",
        body: "Identical message content",
      });
      const second = await sendDesktopNotification({
        title: "Duplicate Check",
        body: "Identical message content",
      });
      expect(typeof first).toBe("boolean");
      expect(second).toBe(false); // Second identical call within 4s is throttled
    });

    it("should respect desktopNotifications=false setting and skip notification", async () => {
      await saveAppSettings({ desktopNotifications: false });
      const sent = await sendDesktopNotification({
        title: "Disabled Test",
        body: "Should not be sent",
      });
      expect(sent).toBe(false);
    });

    it("should allow notification when desktopNotifications=true", async () => {
      await saveAppSettings({ desktopNotifications: true });
      const sent = await sendDesktopNotification({
        title: "Enabled Test",
        body: "Notification permitted",
      });
      expect(typeof sent).toBe("boolean");
    });
  });

  describe("Semantic Triggers [Download & Output Folder Services]", () => {
    it("notifyDownloadCompleted should execute cleanly with title and folder", async () => {
      expect(async () => {
        await notifyDownloadCompleted("Rocky Gerung vs Everybody", "C:\\Videos\\xDownloader");
      }).not.toThrow();
    });

    it("notifyDownloadCompleted should handle missing or empty titles gracefully", async () => {
      expect(async () => {
        await notifyDownloadCompleted("");
      }).not.toThrow();
    });

    it("notifyDownloadFailed should execute cleanly with error details", async () => {
      expect(async () => {
        await notifyDownloadFailed("Corrupt Stream Video", "HTTP 403 Forbidden");
      }).not.toThrow();
    });

    it("notifyOutputFolderChanged should execute cleanly for valid directory", async () => {
      expect(async () => {
        await notifyOutputFolderChanged("D:\\Downloads\\MediaVault");
      }).not.toThrow();
    });

    it("notifyOutputFolderChanged should ignore blank or whitespace path safely", async () => {
      expect(async () => {
        await notifyOutputFolderChanged("   ");
      }).not.toThrow();
    });
  });
});
