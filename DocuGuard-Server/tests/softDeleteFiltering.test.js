"use strict";

/**
 * Regression tests for soft-delete filtering on document endpoints.
 *
 * A document with status = 'deleted' must not be readable, verifiable,
 * processable, or downloadable through any endpoint. These tests drive the
 * real controller with a stubbed database. Nothing here reaches a real
 * database, the network, or production data.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "placeholder-anon";
process.env.DOCUMENT_ENCRYPTION_KEY =
  process.env.DOCUMENT_ENCRYPTION_KEY || "test-encryption-key-12345";
delete process.env.DEBUG_LOG_FILE;

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

stubModule("../services/logicEngine", {
  classifyDocument: async () => ({
    status: "classified",
    classification: { docType: "passport", confidence: 0.95, threshold: 0.85 },
    modelId: "prebuilt-idDocument",
  }),
  extractClassifiedDocumentData: async () => ({
    extractedFields: {
      documentNumber: {
        value: "X1234567",
        confidence: 0.96,
        needsReview: false,
      },
    },
    title: "Passport",
    category: "identification",
    issuer: "Department of Passports",
    documentNumber: "X1234567",
    issueDate: "2020-05-04",
    expiryDate: "2030-05-03",
    riskScore: 12.5,
    riskLevel: "Low",
    raw: { recognizedText: "synthetic" },
  }),
  extractDocumentData: async () => ({
    title: "Passport",
    category: "identification",
    issuer: "Department of Passports",
    documentNumber: "X1234567",
    issueDate: "2020-05-04",
    expiryDate: "2030-05-03",
    riskScore: 12.5,
    riskLevel: "Low",
    raw: { recognizedText: "synthetic" },
  }),
  parseAzureOutput: () => ({}),
});

const db = require("../config/db");
const { supabaseAdmin } = require("../config/supabase");
const controller = require("../controllers/documentController");

const USER_ID = 1;
const DOCUMENT_ID = 42;

supabaseAdmin.from = () => ({
  upsert: async () => ({ error: null }),
  delete: () => ({
    eq: () => ({
      eq: async () => ({ error: null }),
    }),
  }),
});

/**
 * Drives a controller with a scripted database.
 */
async function drive(handler, { body = {}, params = {}, script = () => [] } = {}) {
  const originalQuery = db.query;
  const calls = [];

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
 * A soft-deleted document row: status = 'deleted', deleted_at set.
 */
function softDeletedDocument(overrides = {}) {
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
    status: "deleted",
    enable_alerts: true,
    file_url: "https://example.com/passport.pdf",
    file_type: "application/pdf",
    s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    processing_status: "completed",
    risk_score: 12.5,
    risk_level: "Low",
    deleted_at: "2026-10-20T09:15:00.123456Z",
    updated_at: "2026-10-21T09:15:00.123456Z",
    ...overrides,
  };
}

/**
 * An active document row: status = 'active', no deleted_at.
 */
function activeDocument(overrides = {}) {
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
    status: "active",
    enable_alerts: true,
    file_url: "https://example.com/passport.pdf",
    file_type: "application/pdf",
    s3_key: "1/2b0a2f0e-1b1a-4f4b-9a3a-0d9f3f2c1a55.pdf",
    processing_status: "completed",
    risk_score: 12.5,
    risk_level: "Low",
    deleted_at: null,
    updated_at: "2026-10-21T09:15:00.123456Z",
    ...overrides,
  };
}

test("getDocumentById returns 404 for a soft-deleted document", async () => {
  const { res, calls } = await drive(controller.getDocumentById, {
    params: { id: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("FROM documents WHERE id = $1 AND user_id = $2 AND status <> 'deleted'")) {
        return [];
      }
      if (sql.includes("FROM documents WHERE id = $1 AND user_id = $2")) {
        return [softDeletedDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Document not found");
  assert.equal(res.body.code, 2001);

  // The query must include the status filter.
  const filteredCall = calls.find((c) =>
    c.sql.includes("status <> 'deleted'")
  );
  assert.ok(filteredCall, "the query must filter out soft-deleted documents");
});

test("getDocumentById returns 200 for an active document", async () => {
  const { res, calls } = await drive(controller.getDocumentById, {
    params: { id: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [activeDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.title, "Passport");
  assert.equal(res.body.status, "active");
});

test("getDocumentFileUrl returns 404 for a soft-deleted document", async () => {
  const { res } = await drive(controller.getDocumentFileUrl, {
    params: { id: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [];
      }
      if (sql.includes("SELECT s3_key, file_url FROM documents")) {
        return [softDeletedDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Document not found");
});

test("getDocumentFileUrl returns a signed URL for an active document", async () => {
  const { res } = await drive(controller.getDocumentFileUrl, {
    params: { id: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [activeDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.fileUrl, "https://example.com/signed.pdf");
  assert.equal(res.body.expiresIn, 15 * 60);
});

test("processDocument returns 404 for a soft-deleted document", async () => {
  const { res } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [];
      }
      if (sql.includes("FROM documents") && sql.includes("s3_key")) {
        return [softDeletedDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Document not found");
});

test("processDocument returns 200 for an active document", async () => {
  const { res } = await drive(controller.processDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [activeDocument()];
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
        return [activeDocument()];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
});

test("verifyDocument returns 404 for a soft-deleted document", async () => {
  const { res } = await drive(controller.verifyDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [];
      }
      if (sql.includes("SELECT title FROM documents")) {
        return [{ title: "Passport" }];
      }
      if (/^\s*UPDATE\s+documents/i.test(sql)) {
        return [{ id: DOCUMENT_ID, status: "verified" }];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Document not found");
});

test("verifyDocument returns 200 for an active document", async () => {
  const { res, calls } = await drive(controller.verifyDocument, {
    body: { documentId: DOCUMENT_ID },
    script: (sql) => {
      if (sql.includes("status <> 'deleted'")) {
        return [activeDocument()];
      }
      if (sql.includes("SELECT title FROM documents")) {
        return [{ title: "Passport" }];
      }
      if (/^\s*UPDATE\s+documents/i.test(sql)) {
        return [{ id: DOCUMENT_ID, status: "verified" }];
      }
      return [];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Document verified successfully");

  // The UPDATE must also include the status filter.
  const updateCall = calls.find((c) =>
    /^\s*UPDATE\s+documents/i.test(c.sql)
  );
  assert.ok(updateCall, "an UPDATE must be issued");
  assert.ok(
    updateCall.sql.includes("status <> 'deleted'"),
    "the UPDATE must filter out soft-deleted documents",
  );
});
