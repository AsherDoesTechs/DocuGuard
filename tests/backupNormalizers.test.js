"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeBackupDate,
  normalizeBackupTimestamp,
} = require("../shared/backup/normalizers.js");

test("accepts valid calendar dates", () => {
  assert.equal(normalizeBackupDate("2026-11-02"), "2026-11-02");
});

test("rejects impossible calendar dates", () => {
  assert.equal(normalizeBackupDate("2026-02-30"), null);
});

test("rejects empty and non-string dates", () => {
  assert.equal(normalizeBackupDate(""), null);
  assert.equal(normalizeBackupDate(null), null);
});

test("normalizes valid timestamps to ISO format", () => {
  assert.equal(
    normalizeBackupTimestamp("2026-11-02 10:00:00"),
    "2026-11-02T10:00:00.000Z",
  );
});

test("rejects invalid timestamps", () => {
  assert.equal(normalizeBackupTimestamp("not-a-date"), null);
  assert.equal(normalizeBackupTimestamp(null), null);
});