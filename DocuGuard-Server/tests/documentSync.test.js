"use strict";

/**
 * Integration tests for the document sync endpoint.
 *
 * The handler is driven with a stubbed database so the whole request path is
 * exercised: payload validation, target resolution, the conditional update and
 * the conflict answer. The revision rules are the part that silently broke
 * before, so they are covered in detail.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "placeholder-anon";

const db = require("../config/db");
const dataSyncService = require("../services/dataSyncService");
const {
  canonicalizeServerRevision,
  revisionsMatch,
} = require("../../shared/sync/serverRevision");

/*
 * The push notification service is a side effect of the handler, not part of
 * the behaviour under test.
 *
 * It is replaced before the controller is loaded, because loading the real one
 * initialises the Firebase admin SDK, which needs a real service account and
 * would make this test depend on the working directory the `.env` file is
 * found in. The stub keeps the test runnable from anywhere.
 */
const notificationServicePath = require.resolve("../services/notificationService");

require.cache[notificationServicePath] = {
  id: notificationServicePath,
  filename: notificationServicePath,
  loaded: true,
  exports: {
    sendDocumentExpiryNotification: async () => {},
    sendVerificationNotification: async () => {},
    sendExpiryNotification: async () => {},
  },
};

/*
 * The Supabase mirror is a side effect of the handler, not part of the
 * behaviour under test, and it would try to reach the network. It is stubbed
 * before the controller is loaded because the controller captures the
 * function when it is required.
 */
dataSyncService.syncDocument = async () => {};

const controller = require("../controllers/documentController");

const CANONICAL = "2026-10-20T15:27:11.123456Z";
const LEGACY_MILLISECONDS = "2026-10-20T15:27:11.123Z";

/**
 * Drives the controller with a scripted database.
 *
 * `script` receives the SQL and the parameters and returns the rows the query
 * should answer with.
 */
async function callSync(body, script) {
  const originalQuery = db.query;
  const calls = [];

  db.query = async (sql, params) => {
    calls.push({ sql, params });
    const rows = script(sql, params) || [];
    return { rows, rowCount: rows.length };
  };

  const req = {
    body,
    user: { userId: 1 },
    params: {},
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
    await controller.syncDocument(req, res);
  } finally {
    db.query = originalQuery;
  }

  return { res, calls };
}

function validPayload(overrides) {
  return {
    title: "Passport",
    category: "identification",
    issuer: "DFA",
    documentNumber: "P123",
    issueDate: "2024-01-01",
    expiryDate: null,
    status: "active",
    enableAlerts: true,
    processingStatus: "completed",
    ...overrides,
  };
}

test("the revision format is shared between client and server", () => {
  assert.equal(canonicalizeServerRevision(CANONICAL), CANONICAL);
  assert.equal(
    canonicalizeServerRevision(LEGACY_MILLISECONDS),
    "2026-10-20T15:27:11.123000Z",
  );
  assert.equal(canonicalizeServerRevision("nonsense"), null);
});

test("revisions are compared with millisecond precision", () => {
  assert.equal(revisionsMatch(CANONICAL, CANONICAL), true);
  assert.equal(
    revisionsMatch(CANONICAL, LEGACY_MILLISECONDS),
    true,
    "a legacy revision describes the same millisecond as the canonical one",
  );
  assert.equal(
    revisionsMatch(CANONICAL, "2026-10-20T15:27:11.124456Z"),
    false,
    "a revision in the next millisecond is a different revision",
  );
  assert.equal(
    revisionsMatch(CANONICAL, "2026-10-20T15:27:12.123456Z"),
    false,
  );
});

test("an update with a matching revision succeeds and returns the revision", async () => {
  const { res, calls } = await callSync(
    validPayload({ cloudId: 42, baseUpdatedAt: CANONICAL }),
    (sql) => {
      if (sql.includes("SELECT id FROM documents WHERE id = $1 AND user_id = $2")) {
        return [{ id: 42 }];
      }
      if (sql.startsWith("UPDATE documents")) {
        return [{ id: 42, title: "Passport", updatedAt: CANONICAL }];
      }
      return [];
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.updatedAt, CANONICAL);

  const update = calls.find((call) => call.sql.startsWith("UPDATE documents"));
  assert.ok(update, "the document must be updated in place");
  assert.equal(update.params[update.params.length - 2], CANONICAL);
  assert.equal(
    update.params[update.params.length - 1],
    true,
    "a canonical revision is compared exactly",
  );
});

test("a legacy millisecond revision is accepted and compared", async () => {
  const { res, calls } = await callSync(
    validPayload({ cloudId: 42, baseUpdatedAt: LEGACY_MILLISECONDS }),
    (sql) => {
      if (sql.includes("SELECT id FROM documents WHERE id = $1 AND user_id = $2")) {
        return [{ id: 42 }];
      }
      if (sql.startsWith("UPDATE documents")) {
        return [{ id: 42, updatedAt: CANONICAL }];
      }
      return [];
    },
  );

  assert.equal(res.statusCode, 200);

  const update = calls.find((call) => call.sql.startsWith("UPDATE documents"));
  assert.equal(
    update.params[update.params.length - 2],
    "2026-10-20T15:27:11.123000Z",
    "the revision is normalised before it reaches the database",
  );
  assert.equal(
    update.params[update.params.length - 1],
    false,
    "a legacy revision can only be compared with millisecond precision",
  );
});

test("an unusable revision is rejected with a 400 instead of a database error", async () => {
  const { res } = await callSync(
    validPayload({ cloudId: 42, baseUpdatedAt: "not-a-revision" }),
    () => [],
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /revision/i);
});

test("a revision that no longer matches the row is answered with a conflict", async () => {
  const { res, calls } = await callSync(
    validPayload({ cloudId: 42, baseUpdatedAt: CANONICAL }),
    (sql) => {
      if (sql.includes("SELECT id FROM documents WHERE id = $1 AND user_id = $2")) {
        return [{ id: 42 }];
      }
      if (sql.startsWith("UPDATE documents")) {
        // The revision guard matched no row.
        return [];
      }
      if (sql.includes('AS "updatedAt"')) {
        return [{ updatedAt: "2026-10-21T09:00:00.500000Z" }];
      }
      return [];
    },
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.conflict, true);
  assert.equal(res.body.serverUpdatedAt, "2026-10-21T09:00:00.500000Z");

  const update = calls.find((call) => call.sql.startsWith("UPDATE documents"));
  assert.ok(
    update.sql.includes("updated_at = $18::timestamptz"),
    "a canonical revision is compared exactly",
  );
  assert.ok(
    update.sql.includes("date_trunc('milliseconds', updated_at AT TIME ZONE 'UTC')"),
    "a legacy revision is compared with millisecond precision",
  );
});

test("a push without a revision updates the row unconditionally", async () => {
  const { res, calls } = await callSync(
    validPayload({ cloudId: 42 }),
    (sql) => {
      if (sql.includes("SELECT id FROM documents WHERE id = $1 AND user_id = $2")) {
        return [{ id: 42 }];
      }
      if (sql.startsWith("UPDATE documents")) {
        return [{ id: 42, updatedAt: CANONICAL }];
      }
      return [];
    },
  );

  assert.equal(res.statusCode, 200);

  const update = calls.find((call) => call.sql.startsWith("UPDATE documents"));
  assert.equal(update.params[update.params.length - 2], null);
  assert.equal(
    update.params[update.params.length - 1],
    true,
    "the comparison mode is irrelevant when there is no revision",
  );
});

test("a row the client no longer owns is answered with a conflict", async () => {
  const { res } = await callSync(
    validPayload({ cloudId: 42, baseUpdatedAt: CANONICAL }),
    (sql) => {
      if (sql.includes("WHERE id = $1 AND user_id = $2")) {
        return [];
      }
      if (sql.includes("WHERE id = $1 LIMIT 1")) {
        return [{ id: 42 }];
      }
      return [];
    },
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.conflict, true);
});

test("the payload of a scanned document resolves to its own draft", async () => {
  const { res, calls } = await callSync(
    validPayload({
      s3Key: "1/abc.jpg",
      fileType: "image/jpeg",
    }),
    (sql) => {
      if (sql.includes("WHERE s3_key = $1 AND user_id = $2")) {
        return [{ id: 77 }];
      }
      if (sql.startsWith("UPDATE documents")) {
        return [{ id: 77, updatedAt: CANONICAL }];
      }
      return [];
    },
  );

  assert.equal(res.statusCode, 200);

  const update = calls.find((call) => call.sql.startsWith("UPDATE documents"));
  assert.ok(update, "the draft must be updated, not duplicated");
  assert.equal(update.params[15], 77, "the draft row is the target");
});
