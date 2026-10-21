"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDocumentSyncPayload } = require("../shared/sync/syncPolicy");
const { validateSchema } = require("../shared/validation/schemas.js");
const {
  SYNC_TARGET,
  resolveSyncTarget,
} = require("../DocuGuard-Server/services/documentSyncResolver");

/**
 * The contract between the client and the server.
 *
 * The payload the client builds has to be accepted by the validation schema
 * the server uses, and it has to resolve to exactly one server row. Both were
 * broken: the payload sent `riskScore: null` and `expiryDate: null`, which
 * the schema rejected with a 400, and the server resolved the row by
 * document number only, so a document without one produced a second row.
 */

const localDocument = {
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
  processingStatus: "processing",
  riskScore: null,
  riskLevel: null,
  fileUrl: "file:///data/user/0/com.docuguard/cache/scan.jpg",
  fileType: "image/jpeg",
  s3Key: "1/0f8f0b2c-1f2e-4f6a-9d0e-1234567890ab.jpg",
  cloudId: 42,
  serverUpdatedAt: "2026-10-20T15:27:11.123456Z",
};

test("the payload the client builds is accepted by the server schema", () => {
  const payload = buildDocumentSyncPayload(localDocument);
  const validation = validateSchema(
    require("../shared/validation/schemas.js").documentSyncSchema,
    payload,
  );

  assert.equal(
    validation.success,
    true,
    `server rejected the client payload: ${JSON.stringify(validation.errors)}`,
  );
  assert.equal(validation.data.expiryDate, null);
  assert.equal(validation.data.cloudId, 42);
  assert.equal(validation.data.baseUpdatedAt, "2026-10-20T15:27:11.123456Z");
  assert.equal(validation.data.riskScore, undefined);
});

test("a document that was never uploaded still produces a valid payload", () => {
  const payload = buildDocumentSyncPayload({
    ...localDocument,
    s3Key: null,
    cloudId: null,
    serverUpdatedAt: null,
    fileUrl: "file:///data/user/0/picked.pdf",
  });

  const validation = validateSchema(
    require("../shared/validation/schemas.js").documentSyncSchema,
    payload,
  );

  assert.equal(validation.success, true);
  assert.equal("fileUrl" in payload, false);
});

test("a scanned document resolves to the draft that already holds the file", async () => {
  const payload = buildDocumentSyncPayload(localDocument);

  const db = {
    async query(sql, params) {
      if (sql.includes("WHERE id = $1 AND user_id = $2")) {
        const found = params[0] === 42;
        return { rows: found ? [{ id: 42 }] : [] };
      }

      if (sql.includes("WHERE s3_key = $1 AND user_id = $2")) {
        return { rows: [{ id: 42 }] };
      }

      return { rows: [] };
    },
  };

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: payload.cloudId,
    s3Key: payload.s3Key,
    documentNumber: payload.documentNumber,
    title: payload.title,
  });

  assert.equal(target.action, SYNC_TARGET.UPDATE);
  assert.equal(target.rowId, 42);
});

test("a retry that lost the cloud id still resolves to the same row", async () => {
  const payload = buildDocumentSyncPayload(localDocument);

  const db = {
    async query(sql, params) {
      if (sql.includes("WHERE id = $1 AND user_id = $2")) {
        return { rows: [] };
      }

      if (sql.includes("WHERE s3_key = $1 AND user_id = $2")) {
        return { rows: [{ id: 42 }] };
      }

      return { rows: [] };
    },
  };

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: null,
    s3Key: payload.s3Key,
    documentNumber: payload.documentNumber,
    title: payload.title,
  });

  assert.equal(target.action, SYNC_TARGET.UPDATE);
  assert.equal(target.rowId, 42);
  assert.equal(target.matchedBy, "s3Key");
});
