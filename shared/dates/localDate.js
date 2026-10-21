"use strict";

/**
 * The calendar rules of the expiry alerts.
 *
 * Everything in here is pure, so the rules can be tested without a device,
 * a notification permission or a database.
 *
 * Two rules matter and both were broken:
 *
 *   1. The expiry window has to be anchored on the local calendar date.
 *      `date('now')` is the UTC date, so for part of every day the window
 *      was a whole day off: a document expiring today was still reported as
 *      valid, and the last day of the window was cut off.
 *
 *   2. The alert belongs to a calendar day and is delivered in the morning
 *      of that day. Local midnight of the current day is always in the
 *      past, so the alert for a milestone that fell on today was dropped
 *      without a trace.
 */

/** The time of day the reminders are delivered at. */
const REMINDER_HOUR = 9;
const REMINDER_MINUTE = 0;

/**
 * The lead times used for a document that does not carry any.
 *
 * Older documents stored a single "reminder interval" column, so they were
 * given the usual ladder. Documents created by the app store their own list
 * and keep it.
 */
const DEFAULT_REMINDER_INTERVALS = [30, 7, 1];

/**
 * Formats a date as its local calendar date (`YYYY-MM-DD`).
 */
function toLocalDateString(date) {
  const value = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Parses a calendar date (`YYYY-MM-DD`) as a local moment.
 *
 * The date-only strings are parsed at local midnight, so a timezone offset
 * cannot move them onto a different day.
 */
function parseLocalCalendarDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const parsed = new Date(year, month - 1, day);

      if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
      ) {
        return null;
      }

      return parsed;
    }
  }

  if (value === undefined || value === null) {
    return new Date();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns the local calendar date `days` from `from`, as `YYYY-MM-DD`.
 *
 * The arithmetic goes through the local calendar rather than through
 * milliseconds, so a daylight-saving change cannot move the result onto the
 * wrong day.
 */
function localDateStringAfterDays(days, from) {
  const date = parseLocalCalendarDate(from);

  if (!date) {
    return null;
  }

  const offset = Number.isFinite(days) ? days : 0;

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);

  return toLocalDateString(date);
}

/**
 * Whether a stored expiry date falls inside the window that ends `days`
 * after `today`.
 *
 * The comparison is a plain string comparison, which is what the database
 * does as well: `expiry_date` is stored as `YYYY-MM-DD`, so the lexical
 * order is the calendar order.
 */
function isWithinExpiryWindow(expiryDate, today, days) {
  if (!expiryDate || !today) {
    return false;
  }

  const end = localDateStringAfterDays(days, today);

  return expiryDate >= today && expiryDate <= end;
}

/**
 * The moment a "N days before expiry" alert is delivered.
 *
 * A milestone whose day has passed is gone and is not delivered. A milestone
 * of today whose moment has passed is moved to the next morning, because a
 * late alert is better than no alert.
 */
function getMilestoneDate(expiry, days, now) {
  if (!(expiry instanceof Date) || Number.isNaN(expiry.getTime())) {
    return null;
  }

  const reference = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  const milestone = new Date(expiry.getTime());
  milestone.setDate(milestone.getDate() - days);
  milestone.setHours(REMINDER_HOUR, REMINDER_MINUTE, 0, 0);

  if (Number.isNaN(milestone.getTime())) {
    return null;
  }

  const today = toLocalDateString(reference);
  const milestoneDay = toLocalDateString(milestone);

  if (milestoneDay === null || today === null || milestoneDay < today) {
    return null;
  }

  if (milestone.getTime() <= reference.getTime()) {
    const nextMorning = new Date(reference.getTime());
    nextMorning.setDate(nextMorning.getDate() + 1);
    nextMorning.setHours(REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
    return nextMorning;
  }

  return milestone;
}

/**
 * The lead times of a document.
 *
 * The list is taken from the document itself, so the alert fires exactly as
 * far ahead of the expiry date as the user asked for. The previous code
 * always fell back to a fixed 30-day window, which meant a document that
 * expires in half a year never got an alert at all.
 */
function getReminderIntervals(doc) {
  const stored = Array.isArray(doc && doc.reminderIntervals)
    ? doc.reminderIntervals.filter(
        (days) => typeof days === "number" && Number.isFinite(days) && days > 0,
      )
    : [];

  if (stored.length > 0) {
    return Array.from(new Set(stored)).sort((a, b) => b - a);
  }

  const legacy = doc && doc.reminderIntervalDays;

  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
    return [legacy, ...DEFAULT_REMINDER_INTERVALS.filter((d) => d !== legacy)];
  }

  return [...DEFAULT_REMINDER_INTERVALS];
}

/**
 * What the scheduler has to do with a document.
 *
 * `withdraw` - every alert of the document has to be cancelled.
 * `expire`   - the daily expiry notice has to be scheduled.
 * `schedule` - the "expiring soon" alerts have to be scheduled.
 */
const ALERT_ACTION = {
  WITHDRAW: "withdraw",
  EXPIRE: "expire",
  SCHEDULE: "schedule",
};

function resolveDocumentAlertAction(doc, daysUntilExpiry) {
  if (!doc || doc.enableAlerts === false) {
    return ALERT_ACTION.WITHDRAW;
  }

  if (
    typeof daysUntilExpiry !== "number" ||
    !Number.isFinite(daysUntilExpiry)
  ) {
    // No usable expiry date: there is nothing to remind about, and whatever
    // was scheduled for the document before has to go.
    return ALERT_ACTION.WITHDRAW;
  }

  if (daysUntilExpiry < 0) {
    // The expiry date has passed, so the document is expired.
    return ALERT_ACTION.EXPIRE;
  }

  // Zero means it expires today, which is not expired yet.
  return ALERT_ACTION.SCHEDULE;
}

module.exports = {
  REMINDER_HOUR,
  REMINDER_MINUTE,
  DEFAULT_REMINDER_INTERVALS,
  ALERT_ACTION,
  toLocalDateString,
  parseLocalCalendarDate,
  localDateStringAfterDays,
  isWithinExpiryWindow,
  getMilestoneDate,
  getReminderIntervals,
  resolveDocumentAlertAction,
};
