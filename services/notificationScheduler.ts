import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import {
  getDocumentsEligibleForAlerts,
  getExpiredDocuments,
  getAllReminders,
  LocalDocument,
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
import { isRunningInExpoGo } from "expo";

if (!isRunningInExpoGo()) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function checkAndScheduleAlerts() {
  if (!(await isNotificationsEnabled())) {
    // Alerts are off, so anything already scheduled must be withdrawn too.
    // Returning early left previously scheduled expiry alerts firing after the
    // user had turned notifications off.
    await cancelAllNotifications();
    return;
  }

  /*
   * Every document with an expiry date ahead of it, not only the ones inside
   * the 30-day window.
   *
   * The window used to be the filter, and the lead time is a property of the
   * document: a user who asked to be reminded 60 or 90 days before expiry -
   * both are offered by the app - never got the alert for a document that
   * expires further out, because the document was never looked at.
   */
  const eligibleDocs = await getDocumentsEligibleForAlerts();
  const expiredDocs = await getExpiredDocuments();

  for (const doc of eligibleDocs) {
    if (doc.id == null) {
      continue;
    }

    const action = resolveDocumentAlertAction(doc, getDaysUntilExpiry(doc.expiryDate || ""));

    if (action === ALERT_ACTION.WITHDRAW) {
      // The user turned the alerts of this document off. Anything that is
      // still scheduled for it has to be withdrawn, otherwise it keeps
      // arriving after the user said it should not.
      await cancelDocumentNotifications(doc.id);
      continue;
    }

    await scheduleExpiringSoonNotification(doc);
  }

  for (const doc of expiredDocs) {
    if (doc.id == null) {
      continue;
    }

    const action = resolveDocumentAlertAction(doc, getDaysUntilExpiry(doc.expiryDate || ""));

    if (action === ALERT_ACTION.WITHDRAW) {
      await cancelDocumentNotifications(doc.id);
      continue;
    }

    // The document has expired, so the "expiring soon" alerts are no longer
    // the right ones. The daily expiry notice replaces them.
    await cancelExpiringSoonNotifications(doc.id);
    await scheduleExpirationNotification(doc);
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

  // Reschedules from scratch so an edited expiry date replaces the old
  // reminder. Scheduling again without cancelling left both the previous and
  // the updated alert pending, so the user got two notifications for one
  // document.
  await cancelDocumentNotifications(doc.id);

  const expiry = parseLocalDate(doc.expiryDate || "");

  if (!expiry) {
    // No expiry date: there is nothing to remind about. The alerts that were
    // scheduled before the date was removed have been withdrawn above.
    return;
  }

  const action = resolveDocumentAlertAction(
    doc,
    getDaysUntilExpiry(doc.expiryDate || ""),
  );

  if (action === ALERT_ACTION.WITHDRAW) {
    // The user turned the alerts of this document off.
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
  // Drop previously scheduled intervals first so deselected ones do not linger.
  await cancelIntervalNotifications(doc.id!);

  const intervals = getReminderIntervals(doc);

  for (const days of intervals) {
    // Parsed as local midnight so the reminder fires on the intended local
    // date rather than one day early in negative-UTC-offset timezones.
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
      // A reminder that has been dealt with must not still fire.
      await Notifications.cancelScheduledNotificationAsync(identifier);
      continue;
    }

    await Notifications.cancelScheduledNotificationAsync(identifier);

    const dueDate = parseLocalDate(reminder.dueDate || "");
    const now = new Date();

    if (dueDate === null) {
      // No parseable due date: skip rather than schedule a bogus trigger.
      // `new Date(null)` is epoch, which made every undated reminder look
      // decades overdue and fire daily at 9am forever.
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

/**
 * Withdraws the "expiring soon" alerts of a document and leaves the expiry
 * notice alone.
 *
 * The documents screen uses this when a document has expired: the "expiring
 * soon" alerts no longer apply, but the daily expiry notice does - and
 * cancelling that one meant the user was never told that the document had
 * expired.
 */
export async function cancelExpiringSoonNotifications(docId: number) {
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
