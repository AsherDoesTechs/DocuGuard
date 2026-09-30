import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import {
  getExpiringDocuments,
  getExpiredDocuments,
  getAllReminders,
  LocalDocument,
} from "./localDatabase";
import { getDaysUntilExpiry } from "@/utils";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function checkAndScheduleAlerts() {
  const notifSetting = await SecureStore.getItemAsync("notificationsEnabled");
  if (notifSetting === "false") return;

  const expiringDocs = await getExpiringDocuments(30);
  const expiredDocs = await getExpiredDocuments();

  for (const doc of expiredDocs) {
    if (doc.enableAlerts) {
      await scheduleExpirationNotification(doc);
    }
  }

  for (const doc of expiringDocs) {
    if (doc.enableAlerts) {
      await scheduleExpiringSoonNotification(doc);
    }
  }

  await scheduleReminderNotifications();
}

export async function scheduleRemindersForDocument(doc: LocalDocument) {
  const notifSetting = await SecureStore.getItemAsync("notificationsEnabled");
  if (notifSetting === "false") return;

  if (!doc.enableAlerts) {
    await cancelDocumentNotifications(doc.id!);
    return;
  }

  const daysUntilExpiry = getDaysUntilExpiry(doc.expiryDate || "");
  if (daysUntilExpiry < 0) {
    await scheduleExpirationNotification(doc);
  } else if (daysUntilExpiry <= 30) {
    await scheduleExpiringSoonNotification(doc);
  }
}

async function scheduleExpirationNotification(doc: LocalDocument) {
  const identifier = `expired_${doc.id}`;
  await Notifications.cancelScheduledNotificationAsync(identifier);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Document Expired",
      body: `${doc.title} expired on ${doc.expiryDate}. Please review.`,
      data: { documentId: doc.id, type: "expired" },
      sound: "default",
    },
    identifier,
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour: 9,
      minute: 0,
    },
  });
}

async function scheduleExpiringSoonNotification(doc: LocalDocument) {
  // Drop previously scheduled intervals first so deselected ones do not linger.
  await cancelIntervalNotifications(doc.id!);

  const intervals = Array.isArray(doc.reminderIntervals) && doc.reminderIntervals.length > 0
    ? doc.reminderIntervals
    : [doc.reminderIntervalDays || 30, 7, 1];

  for (const days of intervals) {
    const triggerDate = new Date(doc.expiryDate);
    triggerDate.setDate(triggerDate.getDate() - days);

    const now = new Date();
    if (Number.isNaN(triggerDate.getTime())) continue;
    if (triggerDate <= now) continue;

    const notifIdentifier = `expiring_${doc.id}_${days}d`;

    await Notifications.cancelScheduledNotificationAsync(notifIdentifier);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Document Expiring Soon",
        body: `${doc.title} expires on ${doc.expiryDate}. Time to renew.`,
        data: { documentId: doc.id, type: "expiring" },
        sound: "default",
      },
      identifier: notifIdentifier,
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });
  }
}

async function scheduleReminderNotifications() {
  const reminders = await getAllReminders();

  for (const reminder of reminders) {
    if (!reminder.read) {
      const identifier = `reminder_${reminder.id}`;
      await Notifications.cancelScheduledNotificationAsync(identifier);

      const dueDate = new Date(reminder.dueDate);
      const now = new Date();

      if (dueDate > now) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: reminder.title,
            body: reminder.description || "Reminder: action needed",
            data: { reminderId: reminder.id, type: "reminder" },
            sound: "default",
          },
          identifier,
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: dueDate,
          },
        });
      } else {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: reminder.title,
            body: reminder.description || "Past due reminder",
            data: { reminderId: reminder.id, type: "reminder" },
            sound: "default",
          },
          identifier,
          trigger: {
            type: SchedulableTriggerInputTypes.DAILY,
            hour: 9,
            minute: 0,
          },
        });
      }
    }
  }
}

export async function cancelDocumentNotifications(docId: number) {
  await Notifications.cancelScheduledNotificationAsync(`expired_${docId}`);
  await cancelIntervalNotifications(docId);
}

/**
 * Cancels every interval-specific reminder for a document, including intervals
 * the user removed since the last scheduling pass.
 */
async function cancelIntervalNotifications(docId: number) {
  const prefix = `expiring_${docId}_`;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if (notif.identifier?.startsWith(prefix)) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }
}

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
