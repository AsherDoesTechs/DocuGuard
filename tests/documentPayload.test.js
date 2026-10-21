"use strict";

/**
 * The payload the client builds, and the rules for uploading a file the user
 * picked.
 *
 * The payload is the contract with the server: a field that is sent in the
 * wrong shape fails the whole request with a 400, and a field that is left out
 * when it is needed makes the server create a second row for the same
 * document.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDocumentSyncPayload,
} = require("../shared/sync/syncPolicy");
const {
  validateUploadFile,
  isAllowedFileType,
  needsStorageUpload,
  buildUploadFileName,
  normalizeFileType,
  ALLOWED_FILE_TYPES,
  MAX_FILE_BYTES,
} = require("../shared/sync/documentFileUpload");
const {
  validateSchema,
} = require("../shared/validation/schemas.js");

function document(overrides) {
  return {
    id: 1,
    title: "Passport",
    category: "identification",
    issuer: "DFA",
    documentNumber: "P123",
    issueDate: "2024-01-01",
    expiryDate: null,
    notes: "",
    status: "active",
    enableAlerts: true,
    processingStatus: "completed",
    riskScore: null,
    riskLevel: null,
    fileUrl: null,
    fileType: null,
    s3Key: null,
    cloudId: null,
    serverUpdatedAt: null,
    ...overrides,
  };
}

test("the payload of a scanned document is accepted by the server schema", () => {
  const payload = buildDocumentSyncPayload(
    document({
      s3Key: "7/abc.jpg",
      fileUrl: "https://example.test/signed.pdf",
      fileType: "image/jpeg",
      cloudId: 42,
      serverUpdatedAt: "2026-10-20T15:27:11.123456Z",
    }),
  );

  const validation = validateSchema(
    require("../shared/validation/schemas.js").documentSyncSchema,
    payload,
  );

  assert.equal(
    validation.success,
    true,
    `the server rejected the payload: ${JSON.stringify(validation.errors)}`,
  );
  assert.equal(payload.cloudId, 42);
  assert.equal(payload.s3Key, "7/abc.jpg");
  assert.equal(payload.processingStatus, "completed");
});

test("a scanned document is never pushed as processing", () => {
  const payload = buildDocumentSyncPayload(
    document({ processingStatus: "processing", s3Key: "7/abc.jpg" }),
  );

  assert.equal(
    payload.processingStatus,
    "completed",
    "the OCR already ran on the server, so the row must not be downgraded",
  );
});

test("a document whose upload failed is reported as failed", () => {
  const payload = buildDocumentSyncPayload(
    document({ processingStatus: "failed" }),
  );

  assert.equal(payload.processingStatus, "failed");
});

test("a picked file does not send its local path to the server", () => {
  const payload = buildDocumentSyncPayload(
    document({
      fileUrl: "file:///data/user/0/com.docuguard/cache/picked.pdf",
      fileType: "application/pdf",
    }),
  );

  assert.equal(
    "fileUrl" in payload,
    false,
    "a local path is not a URL the server can store",
  );
  assert.equal(payload.fileType, "application/pdf");
});

test("a cloud id is only sent when it is a usable id", () => {
  assert.equal(buildDocumentSyncPayload(document({ cloudId: 42 })).cloudId, 42);
  assert.equal(
    buildDocumentSyncPayload(document({ cloudId: "42" })).cloudId,
    42,
    "a PostgreSQL id arrives as a string",
  );
  assert.equal("cloudId" in buildDocumentSyncPayload(document({ cloudId: null })), false);
  assert.equal(
    "cloudId" in buildDocumentSyncPayload(document({ cloudId: "nonsense" })),
    false,
  );
});

test("only the file types the storage service accepts are allowed", () => {
  for (const type of ALLOWED_FILE_TYPES) {
    assert.equal(isAllowedFileType(type), true, type);
  }

  for (const type of [
    "application/x-msdownload",
    "application/octet-stream",
    "text/html",
    "image/svg+xml",
    "application/javascript",
  ]) {
    assert.equal(isAllowedFileType(type), false, type);
  }
});

test("a file type is normalised the way the server normalises it", () => {
  assert.equal(normalizeFileType("IMAGE/PNG"), "image/png");
  assert.equal(normalizeFileType("image/jpeg; charset=binary"), "image/jpeg");
  assert.equal(normalizeFileType(undefined), "");
});

test("a file that is too large is refused before it is uploaded", () => {
  assert.equal(
    validateUploadFile({ fileType: "application/pdf", size: 1024 }),
    null,
  );

  const tooLarge = validateUploadFile({
    fileType: "application/pdf",
    size: MAX_FILE_BYTES + 1,
  });

  assert.ok(tooLarge, "a file over the limit must be refused");
  assert.match(tooLarge, /larger than/i);
});

test("a file with an unsupported type is refused", () => {
  const invalid = validateUploadFile({
    fileType: "application/x-msdownload",
    size: 1024,
  });

  assert.ok(invalid);
  assert.match(invalid, /Unsupported file type/);
});

test("a document is uploaded only when it has no storage key yet", () => {
  assert.equal(
    needsStorageUpload({ s3Key: null, fileUrl: "file:///local.pdf" }),
    true,
    "a picked file was never uploaded",
  );
  assert.equal(
    needsStorageUpload({ s3Key: "7/abc.pdf", fileUrl: null }),
    false,
    "a document with a storage key must not be uploaded again",
  );
  assert.equal(
    needsStorageUpload({
      s3Key: null,
      fileUrl: "https://example.test/signed.pdf",
    }),
    false,
    "a document whose file is already remote must not be uploaded again",
  );
});

test("the uploaded file name keeps only the extension", () => {
  assert.equal(
    buildUploadFileName({ name: "My Passport (1).PDF", fileType: "application/pdf" }),
    "document.pdf",
  );
  assert.equal(
    buildUploadFileName({ name: "scan.png", fileType: "image/png" }),
    "document.png",
  );
  assert.equal(
    buildUploadFileName({ name: "", fileType: "image/jpeg" }),
    "document.jpeg",
  );
});
