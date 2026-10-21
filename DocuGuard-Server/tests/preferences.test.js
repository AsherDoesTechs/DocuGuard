"use strict";

/**
 * The notification preferences.
 *
 * A preference request carries the fields the user actually changed. The
 * handlers used to write every column of the row, so a request that carried
 * one preference turned the other two into NULL - and a NULL is not TRUE, so
 * the server silently stopped sending that kind of notification.
 *
 * The handlers are driven with a scripted database so the statement that is
 * sent to the database can be inspected.
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

/*
 * The Supabase mirror is a side effect of the handler, not part of the
 * behaviour under test, and it would try to reach the network. It is stubbed
 * before the controllers are loaded, because they capture the function when
 * they are required.
 */
dataSyncService.syncProfile = async () => {};
dataSyncService.syncReminder = async () => {};

const profileController = require("../controllers/profileController");
const reminderController = require("../controllers/reminderController");

/**
 * Calls a handler with a scripted database and returns the statements that
 * were sent.
 */
async function call(handler, body) {
  const originalQuery = db.query;
  const calls = [];

  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  };

  const req = { user: { userId: 7 }, body };
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

  try {
    await handler(req, res);
  } finally {
    db.query = originalQuery;
  }

  return { calls, res };
}

test("a single notification preference leaves the other columns alone", async () => {
  const { calls, res } = await call(profileController.updatePreferences, {
    notifyEmail: false,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);

  const [statement] = calls;

  assert.match(statement.sql, /email_alerts = \$1/);
  assert.equal(
    statement.sql.includes("notifications_enabled ="),
    false,
    "the push preference was not part of the request and must not be written",
  );
  assert.equal(
    statement.sql.includes("expiry_alerts ="),
    false,
    "the expiry preference was not part of the request and must not be written",
  );
  assert.deepEqual(statement.params, [false, 7]);
});

test("every notification preference that was sent is written", async () => {
  const { calls } = await call(profileController.updatePreferences, {
    notifyEmail: true,
    notifyPush: false,
    notifyExpiry: true,
  });

  assert.equal(calls.length, 1);

  const [statement] = calls;

  assert.match(statement.sql, /email_alerts = \$1/);
  assert.match(statement.sql, /notifications_enabled = \$2/);
  assert.match(statement.sql, /expiry_alerts = \$3/);
  assert.deepEqual(statement.params, [true, false, true, 7]);
});

test("a request without any preference does not write to the database", async () => {
  const { calls, res } = await call(profileController.updatePreferences, {});

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 0);
});

test("a rejected preference does not reach the database", async () => {
  const { calls, res } = await call(profileController.updatePreferences, {
    notifyEmail: "yes please",
  });

  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("registering a push token does not switch the notifications off", async () => {
  const { calls, res } = await call(reminderController.updateNotificationPrefs, {
    fcmToken: "token-from-this-device",
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);

  const [statement] = calls;

  assert.match(statement.sql, /fcm_token = \$1/);
  assert.equal(
    statement.sql.includes("notifications_enabled ="),
    false,
    "the preference was not part of the request and must not be written",
  );
  assert.deepEqual(statement.params, ["token-from-this-device", 7]);
});

test("the push preference and the token are written together", async () => {
  const { calls } = await call(reminderController.updateNotificationPrefs, {
    notificationsEnabled: true,
    fcmToken: "token-from-this-device",
  });

  assert.equal(calls.length, 1);

  const [statement] = calls;

  assert.match(statement.sql, /notifications_enabled = \$1/);
  assert.match(statement.sql, /fcm_token = \$2/);
  assert.deepEqual(statement.params, [true, "token-from-this-device", 7]);
});
