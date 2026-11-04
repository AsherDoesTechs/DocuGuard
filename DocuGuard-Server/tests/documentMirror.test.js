"use strict";

/**
 * Regression tests for the document mirror.
 *
 * The mirror is a second write path into the `documents` table: it upserts
 * the row that the primary write has just updated. A PostgREST upsert writes
 * every column it is given, including explicit nulls, so a payload that does
 * not carry a field clears that field on the row.
 *
 * These tests drive the real controller and the real `dataSyncService`
 * mapping. Only the two boundaries are replaced: the database and the
 * Supabase client. Nothing here reaches a real database, the network, or
 * production data.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { encrypt, decrypt } = require("../services/cryptoService");

/*
 * The environment is prepared before anything is loaded.
 *
 * `DATABASE_URL` points at a host that cannot be resolved, so a query that
 * ever escaped the stub could not reach the real database even by accident.
 * `dotenv` does not override variables that are already set, so the
 * credentials in the local `.env` never take effect here either.
 */
process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";
process.env.DOCUMENT_ENCRYPTION_KEY = "docuguard-document-mirror-test-key-only";
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "placeholder-anon";
delete process.env.DEBUG_LOG_FILE;

/*
 * The services with an external side effect are replaced before the
 * controller is loaded, because the controller captures them when it is
 * required. The push notification service initialises the Firebase admin
 * SDK, the storage service talks to S3, and the logic engine talks to the
 * document analyzer.
 */
function stubModule(relativePath, exports) {
  const filename = require.resolve(relativePath);

  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

stubModule("../services/notificationService", {
  sendDocumentExpiryNotification: async () => {},
  sendVerificationNotification: async () => {},
  sendProcessingCompleteNotification: async () => {},
  sendExpiryNotification: async () => {},
});

stubModule("../services/storageService", {
  generatePresignedUploadUrl: async () => ({
    uploadUrl: "https://example.com/upload",
    fileUrl: "https://example.com/signed",
    storagePath: "1/upload.pdf",
    s3Key: "1/upload.pdf",
    fileType: "application/pdf",
    maxBytes: 1024,
  }),
  getSignedDownloadUrl: async () => "https://example.com/signed.pdf",
  rehydrateFileUrls: async (rows) => rows,
  validateFileType: () => null,
  deleteStorageObject: async () => {},
});

/*
 * The analyzer result is scripted per test. A test that wants the OCR to
 * fail sets `ocrError`; a test that wants it to succeed sets `ocrResult`.
 */
let ocrResult = {
  title: "Passport",
  category: "identification",
  issuer: "Department of Passports",
  documentNumber: "X1234567",
  issueDate: "2020-05-04",
  expiryDate: "2030-05-03",
  riskScore: 12.5,
  riskLevel: "Low",
  raw: { recognizedText: "synthetic" },
};
let ocrError = null;
let documentTypeValidationOverride = null;
stubModule("../services/logicEngine", {
  extractDocumentData: async () => {
    if (ocrError) {
      throw ocrError;
    }

    return ocrResult;
  },
  parseAzureOutput: () => ocrResult,
});

const broadcasts = [];

stubModule("../services/realtimeService", {
  broadcastToUser: (userId, table, payload) => {
    broadcasts.push({ userId, table, payload });
  },
});

stubModule("../services/documentValidationService", {
  validateDocumentType: async () => {
    if (documentTypeValidationOverride) {
      return documentTypeValidationOverride;
    }

    if (ocrError) {
      return {
        status: "processing_error",
        httpStatus: 502,
        code: "OCR_PROCESS_FAILED",
        message: "Document processing failed. Please try again.",
      };
    }

    return {
      status: "valid",
      httpStatus: 200,
      code: "DOCUMENT_TYPE_VALID",
      extractedData: ocrResult,
    };
  },
});
const db = require("../config/db");
const { supabaseAdmin } = require("../config/supabase");
const dataSyncService = require("../services/dataSyncService");
process.env.DOCUMENT_ENCRYPTION_KEY = "docuguard-document-mirror-test-key-only";
const controller = require("../controllers/documentController");

const USER_ID = 1;
const DOCUMENT_ID = 42;

/*
 * The mirror boundary. Every write the service makes is recorded, so a test
 * can assert on the exact payload that would have been written - including
 * that nothing was written at all.
 */
const mirrorWrites = [];
let mirrorResult = { error: null };

supabaseAdmin.from = (table) => ({
  upsert: async (row) => {
    mirrorWrites.push({ table, row });
    return mirrorResult;
  },
  delete: () => ({
    eq: () => ({
      eq: async () => ({ error: null }),
    }),
  }),
});

/**
 * The select that reads the authoritative row after a primary write.
 */
function isAuthoritativeSelect(sql) {
  return (
    sql.includes("FROM documents") &&
    sql.includes('risk_level AS "riskLevel"') &&
    sql.includes("WHERE id = $1 AND user_id = $2")
  );
}

function isUpdate(sql) {
  return /^\s*UPDATE\s+documents/i.test(sql);
}

/**
 * The row as it is stored, in the shape the authoritative select returns it.
 */
function storedDocument(overrides = {}) {
  return {
    id: DOCUMENT_ID,
    user_id: USER_ID,
    title: "Passport",
    category: "identification",
    issuer: "Department of Passports",
    documentNumber: "X1234567",
    issueDate: "2020-05-04",
    expiryDate: "2030-05-03",
    notes: "Renew before expiry",
    status: "verified",
    enableAlerts: true,
    fileUrl: "https://example.com/passport.pdf",
    fileType: "application/pdf",
    s3Key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    processingStatus: "completed",
    riskScore: 12.5,
    riskLevel: "Low",
    updatedAt: "2026-10-21T09:15:00.123456Z",
    ...overrides,
  };
}

/**
 * The same row as the mirror has to receive it: the persisted value of every
 * column, under the column's own name.
 */
function expectedMirrorRow(overrides = {}) {
  return {
    id: DOCUMENT_ID,
    user_id: USER_ID,
    title: "Passport",
    category: "identification",
    issuer: "Department of Passports",
    document_number: "X1234567",
    issue_date: "2020-05-04",
    expiry_date: "2030-05-03",
    notes: "Renew before expiry",
    status: "verified",
    enable_alerts: true,
    file_url: "https://example.com/passport.pdf",
    file_type: "application/pdf",
    s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    processing_status: "completed",
    risk_score: 12.5,
    risk_level: "Low",
    updated_at: "2026-10-21T09:15:00.123456Z",
    ...overrides,
  };
}

/**
 * Drives a controller with a scripted database.
 *
 * `script` receives the SQL and the parameters and answers with the rows the
 * query is supposed to return.
 */
async function drive(
  handler,
  { body = {}, params = {}, headers = {}, script = () => [] } = {},
) {
  const originalQuery = db.query;
  const originalWithTransaction = db.withTransaction;
  const calls = [];

  mirrorWrites.length = 0;

  const runQuery = async (sql, queryParams) => {
    calls.push({ sql, params: queryParams });

    const rows = script(sql, queryParams) || [];

    return {
      rows,
      rowCount: rows.length,
    };
  };

  // Preserve support for handlers that use db.query directly.
  db.query = runQuery;

  // Provide a mock transaction client for createDocument.
  db.withTransaction = async (callback) => {
    const transactionClient = {
      query: runQuery,
    };

    return callback(transactionClient);
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  try {
    await handler({ body, params, headers, user: { userId: USER_ID } }, res);
  } finally {
    db.query = originalQuery;
    db.withTransaction = originalWithTransaction;
  }

  return { res, calls };
}

/**
 * Runs a block with the error output captured, so the expected failures of
 * the handler do not fill the test report and so the log can be asserted on.
 */
async function capturingErrors(fn) {
  const originalError = console.error;
  const lines = [];

  console.error = (...args) => {
    lines.push(
      args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" "),
    );
  };

  try {
    return { result: await fn(), lines };
  } finally {
    console.error = originalError;
  }
}

test.beforeEach(() => {
  documentTypeValidationOverride = null;
  ocrError = null;
  mirrorResult = { error: null };
  mirrorWrites.length = 0;
  broadcasts.length = 0;
});

/*
 * Test A - the verification handler must not erase the document.
 */
/*
 * The OCR success path: the row the update returned is the whole row, and the
 * revision it carries has to be the stored one.
 */
test("B: a processed document is mirrored with its stored revision", async () => {
  const processed = {
    id: DOCUMENT_ID,
    user_id: USER_ID,
    title: "Passport",
    category: "identification",
    issuer: encrypt("Department of Passports"),
    document_number: encrypt("X1234567"),
    issue_date: "2020-05-04",
    expiry_date: "2030-05-03",
    notes: "Renew before expiry",
    status: "active",
    enable_alerts: true,
    file_url: "https://example.com/passport.pdf",
    file_type: "application/pdf",
    s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    processing_status: "completed",
    risk_score: 12.5,
    risk_level: "Low",
    created_at: new Date("2026-10-21T09:00:00.000Z"),
    // The raw column carries milliseconds; the canonical alias carries the
    // stored microsecond revision.
    updated_at: new Date("2026-10-21T09:15:00.123Z"),
    updatedAt: "2026-10-21T09:15:00.123456Z",
    storage_key: "internal/storage/path",
    unexpected_internal_field: "must not leak",
    ocr_data: { recognizedText: "synthetic" },
  };

  const { res, calls } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (isAuthoritativeSelect(sql)) {
        return [storedDocument()];
      }
      if (sql.includes("FROM documents") && sql.includes("s3_key")) {
        return [
          {
            id: DOCUMENT_ID,
            title: "Passport",
            s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
            file_url: null,
            file_type: "application/pdf",
          },
        ];
      }
      if (sql.includes("processing_status = 'processing'")) {
        return [];
      }
      if (sql.includes("ocr_data = $9")) {
        return [processed];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(
    res.body.document.issuer,
    "Department of Passports",
    "document response must return the readable issuer",
  );
  assert.equal(
    res.body.document.document_number,
    "X1234567",
    "document response must return the readable document number",
  );

  assert.equal(
    Object.hasOwn(res.body.document, "ocr_data"),
    false,
    "response must not expose persisted raw OCR data",
  );

  assert.equal(
    Object.hasOwn(res.body.extractedData, "raw"),
    false,
    "response must not expose the raw Azure analyzer payload",
  );
  assert.deepEqual(
    Object.keys(res.body.document).sort(),
    [
      "id",
      "title",
      "category",
      "issuer",
      "document_number",
      "issue_date",
      "expiry_date",
      "notes",
      "status",
      "enable_alerts",
      "file_type",
      "processing_status",
      "risk_score",
      "risk_level",
      "created_at",
      "updated_at",
      "updatedAt",
    ].sort(),
    "document response must contain only explicitly approved fields",
  );

  for (const field of [
    "user_id",
    "file_url",
    "s3_key",
    "storage_key",
    "ocr_data",
    "unexpected_internal_field",
  ]) {
    assert.equal(
      Object.hasOwn(res.body.document, field),
      false,
      `response must not expose ${field}`,
    );
  }

  const ocrUpdate = calls.find((call) => call.sql.includes("ocr_data = $9"));
  assert.ok(ocrUpdate, "OCR update query must be executed");
  assert.equal(
    decrypt(ocrUpdate.params[2]),
    "Department of Passports",
    "issuer SQL parameter must contain encrypted data",
  );
  assert.equal(
    decrypt(ocrUpdate.params[3]),
    "X1234567",
    "document number SQL parameter must contain encrypted data",
  );
  assert.notEqual(
    ocrUpdate.params[2],
    "Department of Passports",
    "issuer must not be sent to the database as plaintext",
  );
  assert.notEqual(
    ocrUpdate.params[3],
    "X1234567",
    "document number must not be sent to the database as plaintext",
  );
  assert.match(
    ocrUpdate.sql,
    /expiry_date\s*=\s*COALESCE\s*\(\s*expiry_date\s*,\s*NULLIF\(\$6,\s*''\)::date\s*\)/,
    "OCR must preserve an existing expiry date and only fill a missing one",
  );
  assert.equal(mirrorWrites.length, 0, "no secondary Supabase write");
  assert.notEqual(
    processed.issuer,
    "Department of Passports",
    "mocked database row must not contain plaintext issuer",
  );
  assert.notEqual(
    processed.document_number,
    "X1234567",
    "mocked database row must not contain plaintext document number",
  );
  assert.equal(
    decrypt(processed.issuer),
    "Department of Passports",
    "mocked database row must retain encrypted issuer data",
  );
  assert.equal(
    decrypt(processed.document_number),
    "X1234567",
    "mocked database row must retain encrypted document number",
  );
});

/*
 * Test C - the authoritative row cannot be read.
 */
test("C: a row that cannot be read is never replaced by a manufactured one", async () => {
  const { res, calls } = await drive(controller.verifyDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("SELECT title FROM documents")) {
        return [{ title: "Passport" }];
      }
      if (isUpdate(sql)) {
        return [{ id: DOCUMENT_ID, status: "verified" }];
      }
      if (isAuthoritativeSelect(sql)) {
        // The row was deleted, or it belongs to another account.
        return [];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200, "the primary update succeeded");
  assert.equal(res.body.document.status, "verified");
  assert.equal(
    mirrorWrites.length,
    0,
    "no document may be sent to the mirror without an authoritative row",
  );

  // The ownership check is unchanged: the read is scoped by the account.
  const authoritativeCall = calls.find((call) =>
    isAuthoritativeSelect(call.sql),
  );
  assert.ok(authoritativeCall, "the persisted row must still be read");
  assert.deepEqual(authoritativeCall.params, [DOCUMENT_ID, USER_ID]);
});

test("C: a document the caller does not own is not found and not mirrored", async () => {
  const { res } = await drive(controller.verifyDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("SELECT title FROM documents")) {
        return [];
      }
      if (isUpdate(sql)) {
        return [];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Document not found");
  assert.equal(mirrorWrites.length, 0);
});

test("C: rejected document types broadcast the failed processing status", async () => {
  documentTypeValidationOverride = {
    status: "mismatch",
    httpStatus: 422,
    code: "DOCUMENT_TYPE_MISMATCH",
    message: "The uploaded document does not match the selected category.",
  };

  const { res, calls } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (isAuthoritativeSelect(sql)) {
        return [
          storedDocument({
            processingStatus: "failed",
          }),
        ];
      }

      if (sql.includes("FROM documents") && sql.includes("s3_key")) {
        return [
          {
            id: DOCUMENT_ID,
            title: "Passport",
            s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
            file_url: null,
            file_type: "application/pdf",
          },
        ];
      }

      return [];
    },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "DOCUMENT_TYPE_MISMATCH");
  assert.equal(
    res.body.error,
    "The uploaded document does not match the selected category.",
  );

  const failedUpdate = calls.find(
    (call) =>
      /UPDATE\s+documents/i.test(call.sql) &&
      call.sql.includes("processing_status = 'failed'"),
  );

  assert.ok(failedUpdate, "the rejected document must be marked failed");
  assert.deepEqual(failedUpdate.params, [DOCUMENT_ID, USER_ID]);
  assert.ok(
    calls.indexOf(failedUpdate) <
      calls.findIndex((call) => isAuthoritativeSelect(call.sql)),
    "the failure update must happen before the authoritative fetch",
  );

  const authoritativeSelect = calls.find((call) =>
    isAuthoritativeSelect(call.sql),
  );

  assert.ok(
    authoritativeSelect,
    "the updated document must be fetched for authoritative synchronization",
  );
  assert.deepEqual(authoritativeSelect.params, [DOCUMENT_ID, USER_ID]);

  const event = broadcasts.find(
    (item) =>
      item.userId === USER_ID &&
      item.table === "documents" &&
      item.payload.eventType === "UPDATE",
  );

  assert.ok(event, "the rejected document must be broadcast");
  assert.equal(event.payload.new.id, DOCUMENT_ID);
  assert.equal(event.payload.new.processing_status, "failed");

  // Verify the broadcast belongs to the correct user
  // and no unnecessary mirror writes occurred.
  assert.equal(event.userId, USER_ID);
  assert.equal(mirrorWrites.length, 0);
});

test("C: a failed OCR preserves existing metadata in the authoritative broadcast", async () => {
  ocrError = new Error("The analyzer could not read the document");

  const { res } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (isAuthoritativeSelect(sql)) {
        return [
          storedDocument({
            status: "active",
            processingStatus: "failed",
          }),
        ];
      }

      if (sql.includes("FROM documents") && sql.includes("s3_key")) {
        return [
          {
            id: DOCUMENT_ID,
            title: "Passport",
            s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
            file_url: null,
            file_type: "application/pdf",
          },
        ];
      }

      return [];
    },
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.errorCode, "OCR_PROCESS_FAILED");

  assert.equal(
    mirrorWrites.length,
    0,
    "failed OCR must not trigger a secondary Supabase write",
  );

  const event = broadcasts.find(
    (item) =>
      item.userId === USER_ID &&
      item.table === "documents" &&
      item.payload.eventType === "UPDATE",
  );

  assert.ok(
    event,
    "expected the existing document to be broadcast after OCR failure",
  );

  assert.equal(event.payload.new.id, DOCUMENT_ID);
  assert.equal(event.payload.new.user_id, USER_ID);
  assert.equal(event.payload.new.title, "Passport");
  assert.equal(event.payload.new.issuer, "Department of Passports");
  assert.equal(event.payload.new.document_number, "X1234567");
  assert.equal(event.payload.new.expiry_date, "2030-05-03");
  assert.equal(event.payload.new.status, "active");
  assert.equal(event.payload.new.processing_status, "failed");
});

/*
 * Test D - document changes broadcast without a secondary database write.
 */
test("D: verification broadcasts the authoritative document without a secondary write", async () => {
  const { res } = await drive(controller.verifyDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (isAuthoritativeSelect(sql)) {
        return [storedDocument({ status: "verified" })];
      }
      if (sql.includes("SELECT title FROM documents")) {
        return [{ title: "Passport" }];
      }
      if (isUpdate(sql)) {
        return [{ id: DOCUMENT_ID, status: "verified" }];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.status, "verified");
  assert.equal(mirrorWrites.length, 0, "no secondary Supabase write");

  const event = broadcasts.find(
    (item) =>
      item.userId === USER_ID &&
      item.table === "documents" &&
      item.payload.eventType === "UPDATE",
  );

  assert.ok(event, "expected a document UPDATE broadcast");

  assert.deepEqual(
    event.payload.new,
    {
      id: DOCUMENT_ID,
      user_id: USER_ID,
      title: "Passport",
      category: "identification",
      issuer: "Department of Passports",
      document_number: "X1234567",
      issue_date: "2020-05-04",
      expiry_date: "2030-05-03",
      notes: "Renew before expiry",
      status: "verified",
      enable_alerts: true,
      file_url: "https://example.com/passport.pdf",
      file_type: "application/pdf",
      s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
      processing_status: "completed",
      risk_score: 12.5,
      risk_level: "Low",
      updated_at: "2026-10-21T09:15:00.123456Z",
    },
    "broadcast must contain the complete authoritative row",
  );

  assert.equal(event.payload.old, null);
  assert.equal(event.payload.eventType, "UPDATE");
  assert.equal(mirrorWrites.length, 0, "no secondary Supabase write");
});

test("D: syncing an authoritative document broadcasts the fetched row", async () => {
  const originalQuery = db.query;

  db.query = async (sql, params) => {
    assert.ok(
      isAuthoritativeSelect(sql),
      "expected an authoritative scoped SELECT",
    );
    assert.deepEqual(params, [DOCUMENT_ID, USER_ID]);

    return {
      rows: [storedDocument({ title: "Stored Passport" })],
      rowCount: 1,
    };
  };

  try {
    const result = await dataSyncService.syncDocumentFromAuthoritative(
      USER_ID,
      DOCUMENT_ID,
      "UPDATE",
    );

    assert.equal(result.ok, true);
    assert.equal(result.row.title, "Stored Passport");
    assert.equal(mirrorWrites.length, 0);

    const event = broadcasts.find(
      (item) =>
        item.userId === USER_ID &&
        item.table === "documents" &&
        item.payload.eventType === "UPDATE",
    );

    assert.ok(event, "expected an authoritative document broadcast");
    assert.equal(event.payload.new.title, "Stored Passport");
  } finally {
    db.query = originalQuery;
  }
});
test("E: a typed creation broadcasts the complete record", async () => {
  const inserted = {
    id: DOCUMENT_ID,
    title: "Passport",
    category: "identification",
    issuer: encrypt("Department of Passports"),
    documentNumber: encrypt("X1234567"),
    issueDate: "2020-05-04",
    expiryDate: "2030-05-03",
    notes: "Renew before expiry",
    status: "active",
    enableAlerts: true,
    fileUrl: "https://example.com/passport.pdf",
    fileType: "application/pdf",
    s3Key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    processingStatus: "completed",
    riskScore: null,
    riskLevel: null,
    updatedAt: "2026-10-21T09:15:00.123456Z",
  };

  const { res } = await drive(controller.createDocument, {
    body: {
      title: "Passport",
      category: "identification",
      issuer: "Department of Passports",
      documentNumber: "X1234567",
      issueDate: "2020-05-04",
      expiryDate: "2030-05-03",
      notes: "Renew before expiry",
      fileUrl: "https://example.com/passport.pdf",
      fileType: "application/pdf",
      s3Key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    },
    script: (sql) => {
      if (/^\s*INSERT INTO documents/i.test(sql)) {
        return [inserted];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(mirrorWrites.length, 0, "no secondary Supabase write");

  const event = broadcasts.find(
    (item) =>
      item.userId === USER_ID &&
      item.table === "documents" &&
      item.payload.eventType === "INSERT",
  );

  assert.ok(event, "expected a document INSERT broadcast");
  assert.equal(event.payload.new.issuer, "Department of Passports");
  assert.equal(event.payload.new.document_number, "X1234567");

  // Confirm the database-row fixture itself remains encrypted and unchanged.
  assert.equal(decrypt(inserted.issuer), "Department of Passports");
  assert.equal(decrypt(inserted.documentNumber), "X1234567");
  assert.notEqual(inserted.issuer, event.payload.new.issuer);
  assert.notEqual(inserted.documentNumber, event.payload.new.document_number);
});

test("E: an OCR draft broadcasts the complete record", async () => {
  const inserted = {
    id: 77,
    title: "Scanned Document",
    category: "other",
    issuer: null,
    documentNumber: null,
    issueDate: null,
    expiryDate: null,
    notes: "Scanned document awaiting OCR processing.",
    status: "active",
    enableAlerts: true,
    fileUrl: null,
    fileType: "image/jpeg",
    s3Key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.jpg",
    processingStatus: "pending",
    riskScore: null,
    riskLevel: null,
    updatedAt: "2026-10-21T09:15:00.123456Z",
  };

  const { res } = await drive(controller.createOcrDraft, {
    body: {
      s3Key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.jpg",
      fileType: "image/jpeg",
    },
    script: (sql) => {
      if (/^\s*INSERT INTO documents/i.test(sql)) {
        return [inserted];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(mirrorWrites.length, 0, "no secondary Supabase write");
});

/*
 * The mapping itself, independent of any handler.
 */
test("the update mapping leaves a column the source does not carry alone", () => {
  const row = dataSyncService.authoritativeDocumentRow(
    { id: 7, title: "Passport", status: "verified" },
    USER_ID,
  );

  assert.deepEqual(row, {
    id: 7,
    user_id: USER_ID,
    title: "Passport",
    status: "verified",
  });

  assert.equal(
    "expiry_date" in row,
    false,
    "a column that is not in the source must not be written",
  );
  assert.equal("risk_score" in row, false);
  assert.equal("notes" in row, false);
});

test("the update mapping keeps a stored NULL as NULL", () => {
  const row = dataSyncService.authoritativeDocumentRow(
    {
      id: 7,
      user_id: USER_ID,
      title: "Passport",
      category: null,
      notes: null,
      issuer: null,
      expiryDate: null,
      riskScore: null,
      riskLevel: null,
      enableAlerts: null,
    },
    USER_ID,
  );

  assert.equal(row.category, null);
  assert.equal(row.notes, null);
  assert.equal(row.issuer, null);
  assert.equal(row.expiry_date, null);
  assert.equal(row.risk_score, null);
  assert.equal(row.risk_level, null);
  assert.equal(row.enable_alerts, null);
});

test("authoritative document broadcasts decrypt encrypted PII and preserve legacy plaintext", () => {
  const encryptedIssuer = encrypt("Department of Passports");
  const encryptedNumber = encrypt("X1234567");

  const encryptedRow = dataSyncService.authoritativeDocumentRow(
    {
      id: DOCUMENT_ID,
      user_id: USER_ID,
      issuer: encryptedIssuer,
      document_number: encryptedNumber,
    },
    USER_ID,
  );

  assert.equal(
    encryptedRow.issuer,
    "Department of Passports",
    "broadcast issuer must be readable",
  );
  assert.equal(
    encryptedRow.document_number,
    "X1234567",
    "broadcast document number must be readable",
  );

  assert.notEqual(encryptedIssuer, encryptedRow.issuer);
  assert.notEqual(encryptedNumber, encryptedRow.document_number);
  assert.equal(decrypt(encryptedIssuer), encryptedRow.issuer);
  assert.equal(decrypt(encryptedNumber), encryptedRow.document_number);

  const legacyRow = dataSyncService.authoritativeDocumentRow(
    {
      id: DOCUMENT_ID,
      user_id: USER_ID,
      issuer: "Legacy Issuer",
      document_number: "LEGACY-123",
    },
    USER_ID,
  );

  assert.equal(legacyRow.issuer, "Legacy Issuer");
  assert.equal(legacyRow.document_number, "LEGACY-123");

  const nullRow = dataSyncService.authoritativeDocumentRow(
    {
      id: DOCUMENT_ID,
      user_id: USER_ID,
      issuer: null,
      document_number: null,
    },
    USER_ID,
  );

  assert.equal(nullRow.issuer, null);
  assert.equal(nullRow.document_number, null);
});
