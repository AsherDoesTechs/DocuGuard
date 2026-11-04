"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";
process.env.DOCUMENT_ENCRYPTION_KEY =
  "docuguard-idempotency-controller-test-key-only";
delete process.env.DEBUG_LOG_FILE;

let beginResult;
let beginError;
let storeResult;
let storeError;

const beginCalls = [];
const storeCalls = [];
const databaseCalls = [];
const syncCalls = [];

let syncError;
let commitCount;
let rollbackCount;
let transactionCount;

const transactionEvents = [];

function stubModule(relativePath, exports) {
  const filename = require.resolve(relativePath);

  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

stubModule("../services/storageService", {
  generatePresignedUploadUrl: async () => ({}),
  getSignedDownloadUrl: async () => null,
  rehydrateFileUrls: async (rows) => rows,
  validateFileType: () => null,
  deleteStorageObject: async () => {},
});

stubModule("../services/logicEngine", {
  extractDocumentData: async () => ({}),
});

stubModule("../services/notificationService", {
  sendProcessingCompleteNotification: async () => {},
  sendVerificationNotification: async () => {},
});

stubModule("../services/dataSyncService", {
  syncDocument: async (...args) => {
    syncCalls.push(args);
    transactionEvents.push("sync");

    if (syncError) {
      throw syncError;
    }
  },
  syncDocumentFromAuthoritative: async () => {},
  broadcastDocumentDeletion: async () => {},
});

stubModule("../services/documentValidationService", {
  validateDocumentType: async () => ({
    status: "valid",
    httpStatus: 200,
    code: "DOCUMENT_TYPE_VALID",
    extractedData: {},
  }),
});

stubModule("../services/idempotencyService", {
  beginIdempotentRequest: async (...args) => {
    beginCalls.push(args);

    if (beginError) {
      throw beginError;
    }

    return beginResult;
  },

  storeIdempotentResponse: async (...args) => {
    storeCalls.push(args);

    if (storeError) {
      throw storeError;
    }

    return storeResult;
  },
});

const db = require("../config/db");
const controller = require("../controllers/documentController");
const { encrypt, decrypt } = require("../services/cryptoService");

const USER_ID = 91;
const KEY = "controller-idempotency-test-key";
const FINGERPRINT = "a".repeat(64);

const validBody = {
  title: "Passport",
  category: "identification",
  issuer: "Department of Passports",
  documentNumber: "X1234567",
  issueDate: "2020-05-04",
  expiryDate: "2030-05-03",
  notes: "Synthetic test document",
};

const insertedDocument = {
  id: 7001,
  title: "Passport",
  category: "identification",
  issuer: encrypt("Department of Passports"),
  documentNumber: encrypt("X1234567"),
  issueDate: "2020-05-04",
  expiryDate: "2030-05-03",
  status: "active",
  enableAlerts: true,
  updatedAt: "2026-10-30T00:00:00.123456Z",
};

function makeResponse() {
  return {
    statusCode: 200,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function drive(body = validBody, headers = {}) {
  const originalQuery = db.query;
  const originalWithTransaction = db.withTransaction;

  databaseCalls.length = 0;

  const transactionClient = {
    query: async (sql, params) => {
      databaseCalls.push({ sql, params });

      transactionEvents.push(
        /^\s*INSERT INTO documents/i.test(sql) ? "document-insert" : "query",
      );

      if (/^\s*INSERT INTO documents/i.test(sql)) {
        return {
          rows: [insertedDocument],
          rowCount: 1,
        };
      }

      return {
        rows: [],
        rowCount: 0,
      };
    },
  };

  db.withTransaction = async (callback) => {
    transactionCount += 1;
    transactionEvents.push("transaction-start");

    try {
      const result = await callback(transactionClient);

      commitCount += 1;
      transactionEvents.push("commit");

      return result;
    } catch (error) {
      rollbackCount += 1;
      transactionEvents.push("rollback");

      throw error;
    }
  };

  const req = {
    body,
    headers,
    params: {},
    user: {
      userId: USER_ID,
    },
  };

  const res = makeResponse();

  try {
    await controller.createDocument(req, res);
    return res;
  } finally {
    db.query = originalQuery;
    db.withTransaction = originalWithTransaction;
  }
}

test.beforeEach(() => {
  beginResult = {
    started: true,
    fingerprint: FINGERPRINT,
  };

  beginError = null;
  storeResult = true;
  storeError = null;
  syncError = null;

  commitCount = 0;
  rollbackCount = 0;
  transactionCount = 0;

  transactionEvents.length = 0;
  beginCalls.length = 0;
  storeCalls.length = 0;
  databaseCalls.length = 0;
  syncCalls.length = 0;
});

test("successful creation stores the response before returning 201", async () => {
  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message, "Document created successfully");
  // The persisted idempotency response must retain encrypted PII.
  const storedDocument = storeCalls[0][3].document;

  assert.notEqual(storedDocument.issuer, "Department of Passports");
  assert.notEqual(storedDocument.documentNumber, "X1234567");

  assert.equal(decrypt(storedDocument.issuer), "Department of Passports");
  assert.equal(decrypt(storedDocument.documentNumber), "X1234567");

  // The response copy must not mutate the stored document.
  assert.equal(decrypt(insertedDocument.issuer), "Department of Passports");

  assert.equal(beginCalls.length, 1);
  assert.equal(beginCalls[0][0], USER_ID);
  assert.equal(beginCalls[0][1], KEY);
  assert.deepEqual(beginCalls[0][2], validBody);

  const inserts = databaseCalls.filter(({ sql }) =>
    /^\s*INSERT INTO documents/i.test(sql),
  );

  assert.equal(inserts.length, 1);

  assert.equal(syncCalls.length, 1);
  assert.equal(storeCalls.length, 1);

  assert.equal(storeCalls[0][0], USER_ID);
  assert.equal(storeCalls[0][1], KEY);
  assert.equal(storeCalls[0][2], 201);
  assert.notDeepEqual(storeCalls[0][3], res.body);
  assert.equal(storeCalls[0][4], FINGERPRINT);
  assert.equal(storeCalls[0][5], true);

  assert.equal(beginCalls[0][3] !== undefined, true);
  assert.equal(storeCalls[0][6], beginCalls[0][3]);

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  assert.ok(
    transactionEvents.indexOf("commit") < transactionEvents.indexOf("sync"),
  );
});

test("completed request replays the stored response without inserting again", async () => {
  const replayBody = {
    message: "Document created successfully",
    document: {
      id: 7001,
      title: "Passport",
      issuer: encrypt("Department of Passports"),
      documentNumber: encrypt("X1234567"),
    },
  };

  beginResult = {
    replay: {
      response_status: 201,
      response_body: replayBody,
    },
  };

  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.document.issuer, "Department of Passports");
  assert.equal(res.body.document.documentNumber, "X1234567");

  // The original stored replay response must remain encrypted and unchanged.
  assert.equal(decrypt(replayBody.document.issuer), "Department of Passports");
  assert.equal(decrypt(replayBody.document.documentNumber), "X1234567");

  assert.notEqual(replayBody.document.issuer, res.body.document.issuer);
  assert.notEqual(
    replayBody.document.documentNumber,
    res.body.document.documentNumber,
  );

  assert.equal(databaseCalls.length, 0);
  assert.equal(syncCalls.length, 0);
  assert.equal(storeCalls.length, 0);

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("payload conflict returns 409 without inserting a document", async () => {
  beginResult = {
    conflict: true,
  };

  const res = await drive(
    {
      ...validBody,
      title: "Different Passport",
    },
    {
      "idempotency-key": KEY,
    },
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "IDEMPOTENCY_CONFLICT");

  assert.equal(databaseCalls.length, 0);
  assert.equal(syncCalls.length, 0);

  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("in-progress request returns 409 without inserting a duplicate", async () => {
  beginResult = {
    inProgress: true,
  };

  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "IDEMPOTENCY_IN_PROGRESS");

  assert.equal(databaseCalls.length, 0);
  assert.equal(syncCalls.length, 0);

  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("idempotency claim failure rolls back without inserting a document", async () => {
  beginError = new Error("Synthetic idempotency database failure");

  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 500);

  assert.equal(databaseCalls.length, 0);
  assert.equal(syncCalls.length, 0);

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
});

test("validation failure stores its response using the claimed fingerprint", async () => {
  const invalidBody = {
    ...validBody,
    documentNumber: "invalid number!",
  };

  const res = await drive(invalidBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 400);

  assert.equal(storeCalls.length, 1);
  assert.equal(storeCalls[0][2], 400);
  assert.equal(storeCalls[0][4], FINGERPRINT);
  assert.equal(storeCalls[0][5], true);

  assert.equal(databaseCalls.length, 0);
  assert.equal(syncCalls.length, 0);

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("response storage failure rolls back the document insertion", async () => {
  storeError = new Error("Synthetic response storage failure");

  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 500);

  const inserts = databaseCalls.filter(({ sql }) =>
    /^\s*INSERT INTO documents/i.test(sql),
  );

  assert.equal(inserts.length, 1);
  assert.equal(storeCalls.length, 1);

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);

  assert.equal(syncCalls.length, 0);
  assert.equal(transactionEvents.includes("rollback"), true);
  assert.equal(transactionEvents.includes("sync"), false);
});

test("response storage returning false rolls back the document insertion", async () => {
  storeResult = false;

  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 500);

  const inserts = databaseCalls.filter(({ sql }) =>
    /^\s*INSERT INTO documents/i.test(sql),
  );

  assert.equal(inserts.length, 1);
  assert.equal(storeCalls.length, 1);

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);

  assert.equal(syncCalls.length, 0);
  assert.equal(transactionEvents.includes("rollback"), true);
  assert.equal(transactionEvents.includes("sync"), false);
});

test("realtime failure after commit does not fail document creation", async () => {
  syncError = new Error("Synthetic realtime broadcast failure");

  const res = await drive(validBody, {
    "idempotency-key": KEY,
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message, "Document created successfully");

  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  assert.equal(storeCalls.length, 1);
  assert.equal(syncCalls.length, 1);

  assert.ok(
    transactionEvents.indexOf("commit") < transactionEvents.indexOf("sync"),
  );
});

test("creation without an idempotency key remains supported", async () => {
  const res = await drive(validBody);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.document.issuer, "Department of Passports");
  assert.equal(res.body.document.documentNumber, "X1234567");
  assert.equal(beginCalls.length, 0);
  assert.equal(storeCalls.length, 0);
  assert.equal(syncCalls.length, 1);

  const inserts = databaseCalls.filter(({ sql }) =>
    /^\s*INSERT INTO documents/i.test(sql),
  );

  assert.equal(inserts.length, 1);
  assert.equal(transactionCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("empty idempotency key returns 400 before starting a transaction", async () => {
  const res = await drive(validBody, {
    "idempotency-key": "",
  });

  assert.equal(res.statusCode, 400);
  assert.equal(beginCalls.length, 0);
  assert.equal(databaseCalls.length, 0);
  assert.equal(transactionCount, 0);
});

test("non-string idempotency key returns 400 before starting a transaction", async () => {
  const res = await drive(validBody, {
    "idempotency-key": 12345,
  });

  assert.equal(res.statusCode, 400);
  assert.equal(beginCalls.length, 0);
  assert.equal(databaseCalls.length, 0);
  assert.equal(transactionCount, 0);
});

test("idempotency key longer than 200 characters returns 400", async () => {
  const res = await drive(validBody, {
    "idempotency-key": "k".repeat(201),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(beginCalls.length, 0);
  assert.equal(databaseCalls.length, 0);
  assert.equal(transactionCount, 0);
});

test("empty idempotency header takes precedence over a valid body key", async () => {
  const res = await drive(
    {
      ...validBody,
      idempotencyKey: KEY,
    },
    {
      "idempotency-key": "",
    },
  );

  assert.equal(res.statusCode, 400);
  assert.equal(beginCalls.length, 0);
  assert.equal(databaseCalls.length, 0);
  assert.equal(transactionCount, 0);
});
