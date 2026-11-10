import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import {
  getDocumentsEligibleForAlerts,
  getExpiredDocuments,
  getAllReminders,
  getAllDocuments,
  upsertExpiredDocumentReminder,
  type LocalDocument,
} from "./localDatabase";
import { isNotificationsEnabled } from "./notificationPreferences";
import { getDaysUntilExpiry, parseLocalDate } from "@/utils";
import {
  ALERT_ACTION,
  REMINDER_HOUR,
  REMINDER_MINUTE,
  getMilestoneDate,
  getReminderIntervals,
  resolveDocumentAlertAction,
} from "@/shared/dates/localDate";

export async function checkAndScheduleAlerts() {
  if (!(await isNotificationsEnabled())) {
    // Alerts are off, so anything already scheduled must be withdrawn too.
    await cancelAllNotifications();
    return;
  }

  /*
   * Pull all documents so that active/valid documents and reminders
   * are always actively tracked and fetched, not just expiring ones.
   */
  const allDocs = await getAllDocuments();
  const eligibleDocs = await getDocumentsEligibleForAlerts();
  const expiredDocs = await getExpiredDocuments();

  for (const doc of allDocs) {
    if (doc.id == null) {
      continue;
    }

    const daysUntil = getDaysUntilExpiry(doc.expiryDate || "");
    const action = resolveDocumentAlertAction(doc, daysUntil);

    if (action === ALERT_ACTION.WITHDRAW) {
      await cancelDocumentNotifications(doc.id);
      continue;
    }

    if (daysUntil < 0) {
      await cancelExpiringSoonNotifications(doc.id);

      // Create/update the SQLite reminder so it appears
      // in reminders.tsx as well as the OS notification.
      await upsertExpiredDocumentReminder(doc.title, doc.expiryDate || "");

      await scheduleExpirationNotification(doc);
    } else {
      await scheduleExpiringSoonNotification(doc);
    }
  }

  await scheduleReminderNotifications();
}

export async function scheduleRemindersForDocument(doc: LocalDocument) {
  if (doc.id == null) {
    return;
  }

  if (!(await isNotificationsEnabled())) {
    await cancelDocumentNotifications(doc.id);
    return;
  }

  await cancelDocumentNotifications(doc.id);

  const expiry = parseLocalDate(doc.expiryDate || "");

  if (!expiry) {
    return;
  }

  const action = resolveDocumentAlertAction(
    doc,
    getDaysUntilExpiry(doc.expiryDate || ""),
  );

  if (action === ALERT_ACTION.WITHDRAW) {
    return;
  }

  if (action === ALERT_ACTION.EXPIRE) {
    await scheduleExpirationNotification(doc);
    return;
  }

  await scheduleExpiringSoonNotification(doc);
}

/**
 * Schedules the daily notice for a document that has expired.
 */
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
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
    },
  });
}

async function scheduleExpiringSoonNotification(doc: LocalDocument) {
  await cancelIntervalNotifications(doc.id!);

  const intervals = getReminderIntervals(doc);

  for (const days of intervals) {
    const expiry = parseLocalDate(doc.expiryDate || "");
    if (!expiry) continue;

    const triggerDate = getMilestoneDate(expiry, days);
    if (!triggerDate) continue;

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
    const identifier = `reminder_${reminder.id}`;

    if (reminder.read) {
      await Notifications.cancelScheduledNotificationAsync(identifier);
      continue;
    }

    await Notifications.cancelScheduledNotificationAsync(identifier);

    const dueDate = parseLocalDate(reminder.dueDate || "");
    const now = new Date();

    if (dueDate === null) {
      continue;
    }

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
          hour: REMINDER_HOUR,
          minute: REMINDER_MINUTE,
        },
      });
    }
  }
}

export async function cancelDocumentNotifications(docId: number) {
  await Notifications.cancelScheduledNotificationAsync(`expired_${docId}`);
  await cancelExpiringSoonNotifications(docId);
}

export async function cancelExpiringSoonNotifications(docId: number) {
  await cancelIntervalNotifications(docId);
}

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
