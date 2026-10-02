const test = require("node:test");
const assert = require("node:assert/strict");

const {
  documentSyncSchema,
  loginSchema,
  validateSchema,
  emailSchema,
} = require("../../shared/validation/schemas");

const VALID_DOCUMENT = {
  title: "Passport",
  // Must be one of VALID_CATEGORIES. The client maps its own local categories
  // through formatCategoryForBackend before sending.
  category: "identification",
  issuer: "Department of State",
  documentNumber: "X1234567",
  issueDate: "2020-01-01",
  expiryDate: "2030-01-01",
  notes: "Renew before travel",
  enableAlerts: true,
  status: "active",
  s3Key: "1/abc.pdf",
  fileType: "application/pdf",
  processingStatus: "completed",
  riskScore: 0,
  riskLevel: "Low",
};

test("validateSchema accepts a well-formed document sync", () => {
  const result = validateSchema(documentSyncSchema, VALID_DOCUMENT);

  assert.equal(result.success, true, JSON.stringify(result.errors));
});

test("document sync uppercases the document number", () => {
  const result = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    documentNumber: "x1234567",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.documentNumber, "X1234567");
});

test("document sync rejects a non-URL fileUrl", () => {
  // A client-supplied fileUrl pointing at an attacker's host would make the
  // OCR analyzer fetch from an arbitrary origin (SSRF).
  const result = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    fileUrl: "http://169.254.169.254/latest/meta-data/",
  });

  assert.equal(result.success, false);
  assert.ok(result.errors.fileUrl);
});

test("document sync accepts the conflict-guard baseUpdatedAt", () => {
  const result = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    baseUpdatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.data.baseUpdatedAt, "2026-01-01T00:00:00.000Z");
});

test("document sync omits baseUpdatedAt when not supplied", () => {
  const result = validateSchema(documentSyncSchema, VALID_DOCUMENT);

  assert.equal(result.success, true);
  assert.equal(result.data.baseUpdatedAt, undefined);
});

test("document sync rejects an out-of-range risk score", () => {
  const tooHigh = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    riskScore: 101,
  });
  assert.equal(tooHigh.success, false);

  const negative = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    riskScore: -1,
  });
  assert.equal(negative.success, false);
});

test("document sync rejects an unknown risk level", () => {
  const result = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    riskLevel: "Critical",
  });

  assert.equal(result.success, false);
});

test("document sync rejects an unknown status", () => {
  // 'deleted' is a local tombstone value and must never be pushed as a
  // server-side status.
  const result = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    status: "deleted",
  });

  assert.equal(result.success, false);
});

test("document sync requires a title and issuer", () => {
  assert.equal(
    validateSchema(documentSyncSchema, { ...VALID_DOCUMENT, title: "" }).success,
    false,
  );
  assert.equal(
    validateSchema(documentSyncSchema, { ...VALID_DOCUMENT, issuer: "" }).success,
    false,
  );
});

test("document sync rejects expiry before issue", () => {
  const result = validateSchema(documentSyncSchema, {
    ...VALID_DOCUMENT,
    issueDate: "2025-01-01",
    expiryDate: "2024-01-01",
  });

  assert.equal(result.success, false);
});

test("document sync requires a positive integer cloudId when present", () => {
  assert.equal(
    validateSchema(documentSyncSchema, { ...VALID_DOCUMENT, cloudId: 0 }).success,
    false,
  );
  assert.equal(
    validateSchema(documentSyncSchema, { ...VALID_DOCUMENT, cloudId: -5 }).success,
    false,
  );
  assert.equal(
    validateSchema(documentSyncSchema, { ...VALID_DOCUMENT, cloudId: 2.5 }).success,
    false,
  );
  assert.equal(
    validateSchema(documentSyncSchema, { ...VALID_DOCUMENT, cloudId: 12 }).success,
    true,
  );
});

test("login schema rejects a malformed email", () => {
  assert.equal(validateSchema(loginSchema, { email: "nope", password: "Str0ng!Pass" }).success, false);
  assert.equal(validateSchema(loginSchema, { email: "a@b.co", password: "Str0ng!Pass" }).success, true);
});

test("login schema tolerates the optional 2FA code field", () => {
  // The 2FA code is read from req.body directly rather than the schema, but
  // the schema must still accept a request that carries one.
  const withCode = validateSchema(loginSchema, {
    email: "a@b.co",
    password: "Str0ng!Pass",
    totpCode: "123456",
  });

  assert.equal(withCode.success, true);
});

test("email schema rejects untrimmed and malformed input", () => {
  // Callers are responsible for normalising (the auth controller does
  // `email.trim().toLowerCase()` before validating), so the schema is strict
  // rather than silently repairing the value.
  assert.equal(validateSchema(emailSchema, "  User@Example.COM ").success, false);
  assert.equal(validateSchema(emailSchema, "not-an-email").success, false);
  assert.equal(validateSchema(emailSchema, "user@example.com").success, true);
});