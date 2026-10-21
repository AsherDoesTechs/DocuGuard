/**
 * The calendar rules of the expiry alerts.
 */

/** The time of day the reminders are delivered at. */
export declare const REMINDER_HOUR: number;
export declare const REMINDER_MINUTE: number;

/** The lead times used for a document that does not carry any. */
export declare const DEFAULT_REMINDER_INTERVALS: number[];

export declare const ALERT_ACTION: {
  WITHDRAW: "withdraw";
  EXPIRE: "expire";
  SCHEDULE: "schedule";
};

/** Formats a date as its local calendar date (`YYYY-MM-DD`). */
export declare function toLocalDateString(date?: Date | number | string): string | null;

/** Parses a calendar date (`YYYY-MM-DD`) as a local moment. */
export declare function parseLocalCalendarDate(
  value?: Date | number | string | null,
): Date | null;

/** The local calendar date `days` from `from`, as `YYYY-MM-DD`. */
export declare function localDateStringAfterDays(
  days: number,
  from?: Date | number | string,
): string | null;

/** Whether a stored expiry date falls inside the window. */
export declare function isWithinExpiryWindow(
  expiryDate: string | null | undefined,
  today: string | null | undefined,
  days: number,
): boolean;

/** The moment a "N days before expiry" alert is delivered. */
export declare function getMilestoneDate(
  expiry: Date,
  days: number,
  now?: Date,
): Date | null;

/** The lead times of a document. */
export declare function getReminderIntervals(doc: {
  reminderIntervals?: number[] | null;
  reminderIntervalDays?: number | null;
} | null | undefined): number[];

/** What the scheduler has to do with a document. */
export declare function resolveDocumentAlertAction(
  doc: { enableAlerts?: boolean } | null | undefined,
  daysUntilExpiry: number | null | undefined,
): "withdraw" | "expire" | "schedule";
