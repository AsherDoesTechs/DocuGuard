"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  validateBackup,
} = require("../shared/backup/schema.js");

const validBackup = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: "2026-11-02T01:00:00.000Z",
  documents: [
    {
      title: "Passport",
      category: "identification",
      issuer: "DFA",
      documentNumber: "P123",
      issueDate: "2024-01-01",
      expiryDate: "2030-01-01",
      notes: "",
      status: "active",
      enableAlerts: true,
      reminderIntervalDays: 7,
      reminderIntervals: [30, 7, 1],
      fileType: "application/pdf",
      processingStatus: "completed",
      riskScore: null,
      riskLevel: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      tags: ["travel"],
    },
  ],
  reminders: [
    {
      title: "Renew passport",
      description: "Prepare renewal requirements",
      dueDate: "2030-01-01",
      severity: "Valid",
      read: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

test("accepts a valid version 1 backup", () => {
  assert.equal(validateBackup(validBackup).success, true);
});

test("accepts an empty backup", () => {
  const result = validateBackup({
    ...validBackup,
    documents: [],
    reminders: [],
  });

  assert.equal(result.success, true);
});

test("rejects unsupported backup versions", () => {
  const result = validateBackup({
    ...validBackup,
    version: 999,
  });

  assert.equal(result.success, false);
});

test("rejects invalid calendar dates", () => {
  const result = validateBackup({
    ...validBackup,
    documents: [
      {
        ...validBackup.documents[0],
        issueDate: "2026-02-30",
      },
    ],
  });

  assert.equal(result.success, false);
});

test("rejects unexpected account and cloud identifiers", () => {
  const result = validateBackup({
    ...validBackup,
    documents: [
      {
        ...validBackup.documents[0],
        userId: "another-user",
        cloudId: 123,
      },
    ],
  });

  assert.equal(result.success, false);
});

test("rejects unexpected file storage references", () => {
  const result = validateBackup({
    ...validBackup,
    documents: [
      {
        ...validBackup.documents[0],
        s3Key: "another-account/private-document",
      },
    ],
  });

  assert.equal(result.success, false);
});

test("rejects malformed document fields", () => {
  const result = validateBackup({
    ...validBackup,
    documents: [
      {
        ...validBackup.documents[0],
        enableAlerts: "yes",
      },
    ],
  });

  assert.equal(result.success, false);
});

test("rejects malformed reminder dates", () => {
  const result = validateBackup({
    ...validBackup,
    reminders: [
      {
        ...validBackup.reminders[0],
        dueDate: "not-a-date",
      },
    ],
  });

  assert.equal(result.success, false);
});