"use strict";

function normalizeBackupDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const dateOnly = value.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
    ? dateOnly
    : null;
}

function normalizeBackupTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const normalized = value.trim();

  // SQLite datetime('now') stores UTC without a timezone suffix.
  const sqliteTimestamp =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(normalized);

  const timestampInput = sqliteTimestamp
    ? `${sqliteTimestamp[1]}T${sqliteTimestamp[2]}Z`
    : normalized;

  const timestamp = new Date(timestampInput);

  return Number.isNaN(timestamp.getTime())
    ? null
    : timestamp.toISOString();
}
module.exports = {
  normalizeBackupDate,
  normalizeBackupTimestamp,
};