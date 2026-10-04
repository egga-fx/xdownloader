import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauriEnvironment, getAppSettings } from "./tauri-api";

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
}

/**
 * Check and request notification permissions gracefully.
 * In Windows desktop shell, permissions are granted by default by OS policy.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        return permission === "granted";
      }
      return true;
    } catch {
      return false;
    }
  }

  // Web preview fallback
  if (typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") return true;
    if (Notification.permission !== "denied") {
      const perm = await Notification.requestPermission();
      return perm === "granted";
    }
  }
  return false;
}

// In-memory deduplication cache to prevent burst/duplicate notifications
const recentNotificationTimestamps = new Map<string, number>();

export function resetNotificationDeduplicationCache(): void {
  recentNotificationTimestamps.clear();
}

/**
 * Send native Windows OS Notification banner with sound/toast.
 * Respects user preferences in app settings (desktopNotifications flag).
 * Automatically throttles and deduplicates identical notifications sent within 4 seconds.
 */
export async function sendDesktopNotification(payload: NotificationPayload): Promise<boolean> {
  try {
    const dedupeKey = `${payload.title}:::${payload.body}`;
    const now = Date.now();
    const lastSent = recentNotificationTimestamps.get(dedupeKey) || 0;
    if (now - lastSent < 4000) {
      // Suppress rapid duplicate notifications
      return false;
    }
    recentNotificationTimestamps.set(dedupeKey, now);

    // Evict stale timestamps
    if (recentNotificationTimestamps.size > 30) {
      for (const [k, timestamp] of recentNotificationTimestamps.entries()) {
        if (now - timestamp > 15000) {
          recentNotificationTimestamps.delete(k);
        }
      }
    }

    const settings = await getAppSettings();
    if (settings.desktopNotifications === false) {
      return false;
    }

    if (isTauriEnvironment()) {
      const permitted = await ensureNotificationPermission();
      if (!permitted) return false;

      sendNotification({
        title: payload.title,
        body: payload.body,
        icon: payload.icon,
      });
      return true;
    }

    // Web preview simulation
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(payload.title, {
        body: payload.body,
        icon: payload.icon,
      });
      return true;
    }
  } catch (err) {
    console.warn("[NotificationService] Failed to send desktop notification:", err);
  }
  return false;
}

/**
 * Service trigger 1: Download completed notification
 */
export async function notifyDownloadCompleted(taskTitle: string, destinationFolder?: string): Promise<void> {
  const cleanTitle = (taskTitle || "Media").trim();
  const folderText = destinationFolder ? `\nDisimpan di: ${destinationFolder}` : "";
  await sendDesktopNotification({
    title: "Unduhan Selesai — xDownloader",
    body: `"${cleanTitle}" telah berhasil diunduh dan siap digunakan.${folderText}`,
  });
}

/**
 * Service trigger: Download failed notification
 */
export async function notifyDownloadFailed(taskTitle: string, error?: string): Promise<void> {
  const cleanTitle = (taskTitle || "Media").trim();
  const errorText = error ? `: ${error}` : "";
  await sendDesktopNotification({
    title: "Unduhan Gagal — xDownloader",
    body: `Gagal menyelesaikan unduhan "${cleanTitle}"${errorText}.`,
  });
}

/**
 * Service trigger 2: Output folder set notification
 */
export async function notifyOutputFolderChanged(newFolder: string): Promise<void> {
  const cleanFolder = (newFolder || "").trim();
  if (!cleanFolder) return;
  await sendDesktopNotification({
    title: "Folder Output Disetel — xDownloader",
    body: `Lokasi penyimpanan media berhasil dialihkan ke:\n${cleanFolder}`,
  });
}
