"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSchema,
  documentSchema,
  documentSyncSchema,
  documentUpdateSchema,
} = require("../shared/validation/schemas.js");

const baseDocument = {
  title: "Passport",
  category: "identification",
  issuer: "DFA",
  documentNumber: "P123",
  issueDate: "2024-01-01",
  expiryDate: "2030-01-01",
  notes: "",
  enableAlerts: true,
  status: "active",
  processingStatus: "completed",
};

test("a document without an expiry date is accepted", () => {
  const result = validateSchema(documentSchema, {
    ...baseDocument,
    expiryDate: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.expiryDate, null);
});

test("an empty expiry date becomes null instead of an invalid date literal", () => {
  const result = validateSchema(documentSchema, {
    ...baseDocument,
    expiryDate: "",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.expiryDate, null);
});

test("a sync payload without an expiry date is accepted", () => {
  const result = validateSchema(documentSyncSchema, {
    ...baseDocument,
    expiryDate: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.expiryDate, null);
});

test("an update that clears the expiry date is accepted", () => {
  const result = validateSchema(documentUpdateSchema, { id: 1, expiryDate: null });

  assert.equal(result.success, true);
  assert.equal(result.data.expiryDate, null);
});

test("an explicit null risk score means not assessed, not a rejected document", () => {
  const result = validateSchema(documentSyncSchema, {
    ...baseDocument,
    riskScore: null,
    riskLevel: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.riskScore, undefined);
  assert.equal(result.data.riskLevel, undefined);
});

test("an expiry date before the issue date is still rejected", () => {
  const result = validateSchema(documentSyncSchema, {
    ...baseDocument,
    issueDate: "2024-01-01",
    expiryDate: "2023-01-01",
  });

  assert.equal(result.success, false);
});

test("a malformed date is still rejected", () => {
  const result = validateSchema(documentSyncSchema, {
    ...baseDocument,
    expiryDate: "01-01-2030",
  });

  assert.equal(result.success, false);
});
