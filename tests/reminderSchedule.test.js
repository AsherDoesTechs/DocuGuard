"use strict";

/**
 * The calendar rules of the expiry alerts.
 *
 * The expiry window, the lead time of a document and the moment an alert is
 * delivered are the rules that decide whether a user is told about an
 * expiring document at all. They are pure, so they are tested here without a
 * device, a notification permission or a database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALERT_ACTION,
  REMINDER_HOUR,
  toLocalDateString,
  localDateStringAfterDays,
  isWithinExpiryWindow,
  getMilestoneDate,
  getReminderIntervals,
  resolveDocumentAlertAction,
} = require("../shared/dates/localDate");

/** A local moment on the given calendar day. */
function localMoment(year, month, day, hours = 0, minutes = 0) {
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

test("a calendar date is read in the local timezone, not in UTC", () => {
  // Built with the local constructor, so the answer does not depend on the
  // timezone the test happens to run in.
  const evening = localMoment(2026, 1, 15, 23, 30);

  assert.equal(toLocalDateString(evening), "2026-01-15");
});

test("a day is added on the local calendar", () => {
  const today = localMoment(2026, 1, 15, 18, 0);

  assert.equal(localDateStringAfterDays(30, today), "2026-02-14");
  assert.equal(localDateStringAfterDays(0, today), "2026-01-15");
  assert.equal(localDateStringAfterDays(-1, today), "2026-01-14");
});

test("the expiry window is anchored on the local calendar date", () => {
  const today = "2026-01-15";

  assert.equal(isWithinExpiryWindow("2026-01-15", today, 30), true);
  assert.equal(isWithinExpiryWindow("2026-02-14", today, 30), true);
  assert.equal(isWithinExpiryWindow("2026-02-15", today, 30), false);
  assert.equal(isWithinExpiryWindow("2026-01-14", today, 30), false);
  assert.equal(isWithinExpiryWindow(null, today, 30), false);
});

test("a milestone that has passed is not delivered", () => {
  const expiry = localMoment(2026, 2, 1);
  const now = localMoment(2026, 1, 15, 10, 0);

  // 30 days before the expiry date is in January, which is over.
  assert.equal(getMilestoneDate(expiry, 30, now), null);
});

test("a milestone of today is delivered in the morning of that day", () => {
  const expiry = localMoment(2026, 2, 14);
  const now = localMoment(2026, 1, 15, 7, 0);

  const milestone = getMilestoneDate(expiry, 30, now);

  assert.notEqual(milestone, null);
  assert.equal(milestone.getFullYear(), 2026);
  assert.equal(milestone.getMonth(), 0);
  assert.equal(milestone.getDate(), 15);
  assert.equal(milestone.getHours(), REMINDER_HOUR);
});

test("a milestone of today whose moment has passed moves to the next morning", () => {
  const expiry = localMoment(2026, 2, 14);
  const now = localMoment(2026, 1, 15, 18, 0);

  const milestone = getMilestoneDate(expiry, 30, now);

  assert.notEqual(milestone, null);
  assert.equal(milestone.getDate(), 16);
  assert.equal(milestone.getHours(), REMINDER_HOUR);
});

test("a milestone in the future keeps its day", () => {
  const expiry = localMoment(2026, 4, 20);
  const now = localMoment(2026, 1, 15, 18, 0);

  const milestone = getMilestoneDate(expiry, 30, now);

  assert.notEqual(milestone, null);
  assert.equal(milestone.getMonth(), 2);
  assert.equal(milestone.getDate(), 21);
  assert.equal(milestone.getHours(), REMINDER_HOUR);
});

test("the lead time of a document is the one the user chose", () => {
  // 60 and 90 days are offered by the app, so they have to be honoured.
  assert.deepEqual(getReminderIntervals({ reminderIntervals: [90] }), [90]);
  assert.deepEqual(getReminderIntervals({ reminderIntervals: [7, 30, 14] }), [30, 14, 7]);
});

test("a document without a lead time falls back to the usual ladder", () => {
  assert.deepEqual(getReminderIntervals({ reminderIntervalDays: 60 }), [60, 30, 7, 1]);
  assert.deepEqual(getReminderIntervals({}), [30, 7, 1]);
  assert.deepEqual(getReminderIntervals(null), [30, 7, 1]);
});

test("a broken lead time is ignored instead of producing a broken alert", () => {
  assert.deepEqual(getReminderIntervals({ reminderIntervals: [0, -5, 30] }), [30]);
  assert.deepEqual(getReminderIntervals({ reminderIntervals: ["30"] }), [30, 7, 1]);
});

test("the alerts of a document with the alerts switched off are withdrawn", () => {
  const action = resolveDocumentAlertAction({ enableAlerts: false }, 10);

  assert.equal(action, ALERT_ACTION.WITHDRAW);
});

test("an expired document gets the expiry notice", () => {
  assert.equal(
    resolveDocumentAlertAction({ enableAlerts: true }, -1),
    ALERT_ACTION.EXPIRE,
  );
});

test("a document that expires today is not expired yet", () => {
  assert.equal(
    resolveDocumentAlertAction({ enableAlerts: true }, 0),
    ALERT_ACTION.SCHEDULE,
  );
});

test("a document that expires in half a year still gets its alert", () => {
  // The 30-day window used to drop this one, so a 90-day lead time never
  // reached the user.
  assert.equal(
    resolveDocumentAlertAction({ enableAlerts: true }, 180),
    ALERT_ACTION.SCHEDULE,
  );
});

test("a document without a usable expiry date has nothing to remind about", () => {
  assert.equal(
    resolveDocumentAlertAction({ enableAlerts: true }, Number.NaN),
    ALERT_ACTION.WITHDRAW,
  );
});
