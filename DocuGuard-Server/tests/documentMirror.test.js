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

stubModule("../services/logicEngine", {
  extractDocumentData: async () => {
    if (ocrError) {
      throw ocrError;
    }

    return ocrResult;
  },
  parseAzureOutput: () => ocrResult,
});

const db = require("../config/db");
const { supabaseAdmin } = require("../config/supabase");
const dataSyncService = require("../services/dataSyncService");
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
    sql.includes('WHERE id = $1 AND user_id = $2')
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
async function drive(handler, { body = {}, params = {}, script = () => [] } = {}) {
  const originalQuery = db.query;
  const calls = [];

  mirrorWrites.length = 0;

  db.query = async (sql, queryParams) => {
    calls.push({ sql, params: queryParams });
    const rows = script(sql, queryParams) || [];
    return { rows, rowCount: rows.length };
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
    await handler({ body, params, user: { userId: USER_ID } }, res);
  } finally {
    db.query = originalQuery;
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
  ocrError = null;
  mirrorResult = { error: null };
  mirrorWrites.length = 0;
});

/*
 * Test A - the verification handler must not erase the document.
 */
test("A: verifying a document mirrors the persisted row, not a partial payload", async () => {
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
        return [storedDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Document verified successfully");
  assert.equal(res.body.document.status, "verified");

  assert.equal(mirrorWrites.length, 1, "exactly one mirror write");
  assert.equal(mirrorWrites[0].table, "documents");

  const row = mirrorWrites[0].row;
  assert.deepEqual(row, expectedMirrorRow());

  // The values that the partial payload used to destroy.
  assert.equal(row.expiry_date, "2030-05-03");
  assert.equal(row.document_number, "X1234567");
  assert.equal(row.issuer, "Department of Passports");
  assert.equal(row.issue_date, "2020-05-04");
  assert.equal(row.s3_key, "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf");
  assert.equal(row.file_url, "https://example.com/passport.pdf");
  assert.equal(row.file_type, "application/pdf");
  assert.equal(row.risk_score, 12.5);
  assert.equal(row.risk_level, "Low");
  assert.equal(row.category, "identification");
  assert.equal(row.notes, "Renew before expiry");
  assert.equal(row.title, "Passport");

  // No field is replaced by a default.
  assert.notEqual(row.title, "Scanned Document");
  assert.notEqual(row.category, "other");
  assert.notEqual(row.notes, "");
  assert.notEqual(row.expiry_date, null);
  assert.notEqual(row.risk_score, null);
  assert.notEqual(row.risk_level, null);

  // The authoritative row is read scoped by the account.
  const authoritativeCall = calls.find((call) =>
    isAuthoritativeSelect(call.sql),
  );
  assert.ok(authoritativeCall, "the persisted row must be read");
  assert.deepEqual(authoritativeCall.params, [DOCUMENT_ID, USER_ID]);
});

/*
 * Test B - the OCR failure handler must not erase the document.
 */
test("B: a failed OCR mirrors the persisted row and keeps the title", async () => {
  ocrError = new Error("The analyzer could not read the document");

  const { res } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (isAuthoritativeSelect(sql)) {
        return [storedDocument({ status: "active", processingStatus: "failed" })];
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
      if (sql.includes("processing_status = 'failed'")) {
        return [];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.errorCode, "OCR_PROCESS_FAILED");

  assert.equal(mirrorWrites.length, 1, "exactly one mirror write");

  const row = mirrorWrites[0].row;
  assert.deepEqual(
    row,
    expectedMirrorRow({ status: "active", processing_status: "failed" }),
  );

  assert.equal(row.processing_status, "failed");
  assert.equal(row.title, "Passport");
  assert.notEqual(row.title, "Scanned Document");
  assert.equal(row.expiry_date, "2030-05-03");
  assert.equal(row.document_number, "X1234567");
  assert.equal(row.issuer, "Department of Passports");
  assert.equal(row.s3_key, "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf");
  assert.equal(row.risk_score, 12.5);
  assert.equal(row.risk_level, "Low");
  assert.equal(row.notes, "Renew before expiry");
});

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
    issuer: "Department of Passports",
    document_number: "X1234567",
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
    ocr_data: { recognizedText: "synthetic" },
  };

  const { res } = await drive(controller.processDocument, {
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
  assert.equal(mirrorWrites.length, 1);

  const row = mirrorWrites[0].row;
  assert.equal(row.title, "Passport");
  assert.equal(row.expiry_date, "2030-05-03");
  assert.equal(row.document_number, "X1234567");
  assert.equal(row.issuer, "Department of Passports");
  assert.equal(row.s3_key, "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf");
  assert.equal(row.risk_score, 12.5);
  assert.equal(row.risk_level, "Low");
  assert.equal(row.notes, "Renew before expiry");
  assert.equal(row.category, "identification");
  assert.equal(row.processing_status, "completed");
  assert.equal(
    row.updated_at,
    "2026-10-21T09:15:00.123456Z",
    "the mirror carries the stored revision, not a truncated one",
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

test("C: a failed OCR whose row cannot be read mirrors nothing", async () => {
  ocrError = new Error("The analyzer could not read the document");

  const { res } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (isAuthoritativeSelect(sql)) {
        // The row was deleted, or it belongs to another account.
        return [];
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
    "no document may be sent to the mirror without an authoritative row",
  );
});

/*
 * Test D - the mirror fails.
 */
test("D: a mirror failure is logged safely and does not fail the request", async () => {
  mirrorResult = { error: { message: "permission denied for table documents" } };

  const { result, lines } = await capturingErrors(() =>
    drive(controller.verifyDocument, {
      body: { documentId: DOCUMENT_ID },
      script: (sql) => {
        if (isAuthoritativeSelect(sql)) {
          return [storedDocument()];
        }
        if (sql.includes("SELECT title FROM documents")) {
          return [{ title: "Passport" }];
        }
        if (isUpdate(sql)) {
          return [{ id: DOCUMENT_ID, status: "verified" }];
        }
        return [];
      },
    }),
  );

  const { res } = result;

  // The primary write succeeded, so the request succeeds.
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.status, "verified");
  assert.equal(mirrorWrites.length, 1, "the mirror was still attempted");

  const logged = lines.join("\n");
  assert.match(logged, /mirror failed/i, "the failure is reported");
  assert.match(logged, /permission denied for table documents/);
  assert.match(logged, /42/, "the failed record is identified");

  // Nothing about the document itself is logged.
  assert.doesNotMatch(logged, /Passport/);
  assert.doesNotMatch(logged, /X1234567/);
  assert.doesNotMatch(logged, /2030-05-03/);
  assert.doesNotMatch(logged, /Renew before expiry/);
  assert.doesNotMatch(logged, /Department of Passports/);
  assert.doesNotMatch(logged, /2b0a2f0e/);

  // No credential is logged.
  assert.doesNotMatch(logged, /service[_-]?role/i);
  assert.doesNotMatch(logged, /eyJ[A-Za-z0-9_-]*\./);
  assert.doesNotMatch(logged, /placeholder-service-role/);
  assert.doesNotMatch(logged, /postgresql:\/\//);
});

test("D: the mirror outcome is returned to the caller", async () => {
  mirrorResult = { error: { message: "permission denied for table documents" } };

  const failed = await dataSyncService.syncDocumentFromAuthoritative(
    USER_ID,
    DOCUMENT_ID,
    "UPDATE",
    { fetch: async () => storedDocument() },
  );

  assert.equal(failed.ok, false);
  assert.match(failed.error, /permission denied/);
  assert.deepEqual(failed.row, storedDocument());

  mirrorResult = { error: null };

  const succeeded = await dataSyncService.syncDocumentFromAuthoritative(
    USER_ID,
    DOCUMENT_ID,
    "UPDATE",
    { fetch: async () => storedDocument() },
  );

  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.error, undefined);
});

test("D: a transport failure in the mirror does not fail the request", async () => {
  const originalFrom = supabaseAdmin.from;
  supabaseAdmin.from = () => ({
    upsert: async () => {
      throw new Error("fetch failed");
    },
  });

  try {
    const { res } = await drive(controller.verifyDocument, {
      body: { documentId: DOCUMENT_ID },
      script: (sql) => {
        if (sql.includes("SELECT title FROM documents")) {
          return [{ title: "Passport" }];
        }
        if (isUpdate(sql)) {
          return [{ id: DOCUMENT_ID, status: "verified" }];
        }
        if (isAuthoritativeSelect(sql)) {
          return [storedDocument()];
        }
        return [];
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.document.status, "verified");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

/*
 * Test E - a row that is created is mirrored in full.
 */
test("E: a typed creation mirrors the complete record", async () => {
  const inserted = {
    id: DOCUMENT_ID,
    title: "Passport",
    category: "identification",
    issuer: "Department of Passports",
    documentNumber: "X1234567",
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
  assert.equal(mirrorWrites.length, 1);

  const row = mirrorWrites[0].row;
  assert.equal(row.id, DOCUMENT_ID);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.title, "Passport");
  assert.equal(row.category, "identification");
  assert.equal(row.issuer, "Department of Passports");
  assert.equal(row.document_number, "X1234567");
  assert.equal(row.issue_date, "2020-05-04");
  assert.equal(row.expiry_date, "2030-05-03");
  assert.equal(row.notes, "Renew before expiry");
  assert.equal(row.status, "active");
  assert.equal(row.enable_alerts, true);
  assert.equal(row.file_url, "https://example.com/passport.pdf");
  assert.equal(row.file_type, "application/pdf");
  assert.equal(row.s3_key, "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf");
  assert.equal(row.processing_status, "completed");
  assert.equal(row.risk_score, null);
  assert.equal(row.risk_level, null);
  assert.equal(row.updated_at, "2026-10-21T09:15:00.123456Z");
});

test("E: an OCR draft mirrors the complete record", async () => {
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
  assert.equal(mirrorWrites.length, 1);

  const row = mirrorWrites[0].row;
  assert.equal(row.id, 77);
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.title, "Scanned Document");
  assert.equal(row.category, "other");
  assert.equal(row.issuer, null);
  assert.equal(row.document_number, null);
  assert.equal(row.issue_date, null);
  assert.equal(row.expiry_date, null);
  assert.equal(row.notes, "Scanned document awaiting OCR processing.");
  assert.equal(row.status, "active");
  assert.equal(row.enable_alerts, true);
  assert.equal(row.file_url, null);
  assert.equal(row.file_type, "image/jpeg");
  assert.equal(row.s3_key, "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.jpg");
  assert.equal(row.processing_status, "pending");
  assert.equal(row.risk_score, null);
  assert.equal(row.risk_level, null);
  assert.equal(
    row.updated_at,
    "2026-10-21T09:15:00.123456Z",
    "the insert carries the stored revision",
  );
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
