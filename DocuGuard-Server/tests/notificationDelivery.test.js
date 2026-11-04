"use strict";

/**
 * The delivery of the expiry notices.
 *
 * Two rules are covered here:
 *
 *   1. A deleted document must not produce an expiry notice. The row of a
 *      deleted document stays in the database until the device has synced
 *      the deletion, and it still carries its expiry date - so without this
 *      filter the job kept sending expiry reminders for a document the user
 *      had already deleted.
 *
 *   2. A device that signs out must not keep receiving the notifications of
 *      the account it signed out of. The push token lives on the account
 *      row, so it has to be removed when the session ends.
 *
 * Configurable schedules:
 *
 *   3. Each user's `reminder_before_days` controls how far ahead the job
 *      looks for expiring documents (default 30).
 *   4. Users who disabled `notifications_enabled` or `expiry_alerts` are
 *      skipped entirely.
 *   5. Per-user interval flags (30/7/1/on_day) control which expiry
 *      intervals trigger a notice.
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
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-the-suite";

/*
 * The scheduler is replaced before the job is loaded: the real one would
 * register a daily timer that keeps the test process alive, and the job
 * itself is called directly below.
 */
const cronPath = require.resolve("node-cron");

require.cache[cronPath] = {
  id: cronPath,
  filename: cronPath,
  loaded: true,
  exports: { schedule: () => {} },
};

/*
 * The notification service is replaced so no real push is sent.
 */
const notificationServicePath = require.resolve("../services/notificationService");

let sentNotifications = [];
require.cache[notificationServicePath] = {
  id: notificationServicePath,
  filename: notificationServicePath,
  loaded: true,
  exports: {
    sendExpirationReminder: async (token, title, days) => {
      sentNotifications.push({ token, title, days });
      return { success: true };
    },
    sendVerificationNotification: async () => {},
    sendExpiryNotification: async () => {},
  },
};

const { runExpirationCheck, getExpiringDocumentsForUser } =
  require("../jobs/expirationChecker");
const notificationRoutes = require("../routes/notification");

/**
 * Replaces db.query so the expiration job's statements are observed.
 */
function recordQueries(rowsBySql = {}) {
  const calls = [];
  const originalQuery = db.query;

  db.query = async (sql, params) => {
    calls.push({ sql, params });

    // Match by distinctive SQL substring (template literals may have
    // leading whitespace/newlines, so startsWith is unreliable).
    for (const [key, rows] of Object.entries(rowsBySql)) {
      if (sql.includes(key)) {
        return { rows, rowCount: rows.length };
      }
    }

    return { rows: [], rowCount: 0 };
  };

  return {
    calls,
    restore: () => {
      db.query = originalQuery;
    },
  };
}

/**
 * Replaces db.withTransaction so the route runs against a fake client whose
 * queries are recorded.
 */
function recordClientQueries(rows = []) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
    release: () => {},
  };

  const original = db.withTransaction;
  db.withTransaction = async (fn) => fn(client);

  return {
    calls,
    restore: () => {
      db.withTransaction = original;
    },
  };
}

test("the daily job does not remind about a deleted document", async () => {
  sentNotifications.length = 0;
  const recorder = recordQueries({
    "SELECT u.id,": [
      {
        id: 1,
        email: "a@example.com",
        expo_push_token: "ExponentPushToken:abc",
        fcm_token: null,
        notifications_enabled: true,
        expiry_alerts: true,
        reminder_before_days: 30,
        reminder_30days: true,
        reminder_7days: true,
        reminder_1day: true,
        reminder_on_day: true,
      },
    ],
    "FROM documents d": [],
  });

  try {
    await runExpirationCheck();
  } finally {
    recorder.restore();
  }

  assert.equal(sentNotifications.length, 0, "no notices for deleted documents");

  // The documents query must exclude tombstones.
  const docCall = recorder.calls.find((c) =>
    c.sql.includes("FROM documents d")
  );
  assert.ok(docCall, "expected a documents query");
  assert.match(
    docCall.sql,
    /status <> 'deleted'/,
    "a tombstone must not produce an expiry notice",
  );
});

test("the daily job only notifies accounts that asked for it", async () => {
  sentNotifications.length = 0;
  const recorder = recordQueries({
    "SELECT u.id,": [
      {
        id: 1,
        email: "a@example.com",
        expo_push_token: "ExponentPushToken:abc",
        fcm_token: null,
        notifications_enabled: false,
        expiry_alerts: true,
        reminder_before_days: 30,
        reminder_30days: true,
        reminder_7days: true,
        reminder_1day: true,
        reminder_on_day: true,
      },
    ],
  });

  try {
    await runExpirationCheck();
  } finally {
    recorder.restore();
  }

  assert.equal(
    sentNotifications.length,
    0,
    "no notices when notifications are disabled",
  );
});

test("the daily job skips users with expiry_alerts disabled", async () => {
  sentNotifications.length = 0;
  const recorder = recordQueries({
    "SELECT u.id,": [
      {
        id: 1,
        email: "a@example.com",
        expo_push_token: "ExponentPushToken:abc",
        fcm_token: null,
        notifications_enabled: true,
        expiry_alerts: false,
        reminder_before_days: 30,
        reminder_30days: true,
        reminder_7days: true,
        reminder_1day: true,
        reminder_on_day: true,
      },
    ],
  });

  try {
    await runExpirationCheck();
  } finally {
    recorder.restore();
  }

  assert.equal(
    sentNotifications.length,
    0,
    "no notices when expiry alerts are disabled",
  );
});

test("the daily job uses per-user reminder_before_days window", async () => {
  sentNotifications.length = 0;
  const recorder = recordQueries({
    "SELECT u.id,": [
      {
        id: 1,
        email: "a@example.com",
        expo_push_token: "ExponentPushToken:abc",
        fcm_token: null,
        notifications_enabled: true,
        expiry_alerts: true,
        reminder_before_days: 7,
        reminder_30days: true,
        reminder_7days: true,
        reminder_1day: true,
        reminder_on_day: true,
      },
    ],
    "SELECT d.id, d.title, d.expiry_date": [],
  });

  try {
    await runExpirationCheck();
  } finally {
    recorder.restore();
  }

  // The user-specific query should use reminder_before_days = 7 as the window.
  const docCall = recorder.calls.find((c) =>
    c.sql.includes("FROM documents d")
  );
  assert.ok(docCall, "expected a documents query");
  assert.equal(
    docCall.params[1],
    7,
    "the per-user reminder_before_days window should be used",
  );
});

test("the daily job sends notifications for expiring documents", async () => {
  sentNotifications.length = 0;
  const recorder = recordQueries({
    "SELECT u.id,": [
      {
        id: 1,
        email: "a@example.com",
        expo_push_token: "ExponentPushToken:abc",
        fcm_token: null,
        notifications_enabled: true,
        expiry_alerts: true,
        reminder_before_days: 30,
        reminder_30days: true,
        reminder_7days: true,
        reminder_1day: true,
        reminder_on_day: true,
      },
    ],
    "SELECT d.id, d.title, d.expiry_date": [
      {
        id: 101,
        title: "Passport",
        expiry_date: "2026-11-01",
        days_until_expiry: 5,
      },
    ],
  });

  try {
    await runExpirationCheck();
  } finally {
    recorder.restore();
  }

  assert.equal(sentNotifications.length, 1);
  assert.equal(sentNotifications[0].token, "ExponentPushToken:abc");
  assert.equal(sentNotifications[0].title, "Passport");
  assert.equal(sentNotifications[0].days, 5);
});

/**
 * The handlers of a route in an Express router.
 */
function routeHandlers(router, path, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((entry) => entry.handle);
    }
  }

  throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
}

/**
 * Calls a route's business handler the way the server does, awaiting the full
 * async chain.
 */
async function callRoute(router, path, method, req) {
  const handlers = routeHandlers(router, path, method);

  const businessHandler = handlers[handlers.length - 1];

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  await businessHandler(req, res, () => {});

  return res;
}

test("signing out removes the push token of the account", async () => {
  const recorder = recordClientQueries([]);

  const token = jwt.sign({ userId: 7 }, process.env.JWT_SECRET, {
    expiresIn: "5m",
  });

  let res;

  try {
    res = await callRoute(notificationRoutes, "/push-token", "delete", {
      headers: { authorization: `Bearer ${token}` },
      path: "/push-token",
      user: { userId: 7 },
    });
  } finally {
    recorder.restore();
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "success");

  // The handler reads the owned tokens first (needed to detach them from
  // every other account), then nulls them for the signed-in account.
  assert.equal(
    recorder.calls.length,
    2,
    "expected a token read followed by a token-clearing update",
  );

  const [read, clear] = recorder.calls;

  assert.match(
    read.sql,
    /SELECT expo_push_token, fcm_token FROM users WHERE id = \$1/,
    "the handler must read the account's current tokens before clearing them",
  );
  assert.deepEqual(read.params, [7]);

  assert.match(
    clear.sql,
    /UPDATE users SET expo_push_token = NULL, fcm_token = NULL WHERE id = \$1/,
    "the push token must be cleared for the signed-in account only",
  );
  assert.deepEqual(clear.params, [7]);
});

test("registering a removal detaches the token from every other account", async () => {
  const recorder = recordClientQueries([
    { expo_push_token: "device-token-1", fcm_token: null },
  ]);

  const token = jwt.sign({ userId: 7 }, process.env.JWT_SECRET, {
    expiresIn: "5m",
  });

  let res;

  try {
    res = await callRoute(notificationRoutes, "/push-token", "delete", {
      headers: { authorization: `Bearer ${token}` },
      path: "/push-token",
      user: { userId: 7 },
    });
  } finally {
    recorder.restore();
  }

  assert.equal(res.statusCode, 200);

  const detach = recorder.calls.find((call) =>
    call.sql.includes("WHERE id <> $1 AND (expo_push_token = $2 OR fcm_token = $2)"),
  );

  assert.ok(detach, "an owned token must be detached from every other account");

  assert.match(
    detach.sql,
    /UPDATE users SET expo_push_token = NULL, fcm_token = NULL\s+WHERE id <> \$1 AND \(expo_push_token = \$2 OR fcm_token = \$2\)/,
  );
  assert.deepEqual(detach.params, [7, "device-token-1"]);
});

test("the push token cannot be removed without a session", async () => {
  const recorder = recordClientQueries([]);

  const handlers = routeHandlers(notificationRoutes, "/push-token", "delete");
  const authMiddleware = handlers[0];

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  // authMiddleware responds 401 synchronously when there is no bearer token.
  await authMiddleware({ headers: {}, path: "/push-token" }, res, () => {});

  recorder.restore();

  assert.equal(res.statusCode, 401);
  assert.equal(
    recorder.calls.length,
    0,
    "the token of an unknown account must not be removed",
  );
});
