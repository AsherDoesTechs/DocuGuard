"use strict";

/**
 * Unit tests for the audit logging service.
 *
 * The database layer is stubbed so no real database, network, or production
 * data is touched.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// Stub the database before loading the service.
const dbCalls = [];
const dbStub = {
  query: async (sql, params) => {
    dbCalls.push({ sql, params });
    return { rows: [] };
  },
};

process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";
delete process.env.DEBUG_LOG_FILE;

// Intercept require cache to inject the stub.
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "../config/db") {
    return dbStub;
  }
  return originalLoad.apply(this, arguments);
};

const {
  log,
  logAuthenticated,
  EVENT_TYPE,
  EVENT_CATEGORY,
} = require("../services/auditService");

test("audit log writes a row with the provided fields", async () => {
  dbCalls.length = 0;

  await log({
    userId: 42,
    actorUserId: 42,
    eventType: EVENT_TYPE.LOGIN_SUCCESS,
    outcome: "success",
    resource: { type: "user", id: "42" },
    request: {
      headers: {
        "x-forwarded-for": "198.51.100.99",
        "user-agent": "DocuGuard/1.0",
      },
      connection: { remoteAddress: "192.0.2.10" },
      ip: "203.0.113.5",
    },
    details: { email: "user@example.com" },
  });

  assert.equal(dbCalls.length, 1);
  const call = dbCalls[0];
  assert.match(call.sql, /INSERT INTO audit_log/);
  assert.deepEqual(call.params, [
    42,
    42,
    "login_success",
    "authentication",
    "user",
    "42",
    "203.0.113.5",
    "DocuGuard/1.0",
    "success",
    JSON.stringify({ email: "user@example.com" }),
  ]);
});

test("audit log does not trust forwarded IP when Express IP is unavailable", async () => {
  dbCalls.length = 0;

  await log({
    userId: 42,
    actorUserId: 42,
    eventType: EVENT_TYPE.LOGIN_SUCCESS,
    outcome: "success",
    request: {
      headers: {
        "x-forwarded-for": "198.51.100.99",
        "user-agent": "DocuGuard/1.0",
      },
      connection: { remoteAddress: "192.0.2.10" },
      ip: undefined,
    },
  });

  assert.equal(dbCalls.length, 1);
  assert.equal(dbCalls[0].params[6], "192.0.2.10");
});

test("audit log derives event category from event type", async () => {
  dbCalls.length = 0;

  await log({
    userId: 1,
    actorUserId: null,
    eventType: EVENT_TYPE.DOC_DELETE,
    outcome: "success",
  });

  assert.equal(dbCalls.length, 1);
  assert.equal(dbCalls[0].params[3], EVENT_CATEGORY.DATA_DELETION);
});

test("audit log uses SYSTEM category for unknown event types", async () => {
  dbCalls.length = 0;

  await log({
    userId: 1,
    actorUserId: null,
    eventType: "custom_unknown_event",
    outcome: "success",
  });

  assert.equal(dbCalls.length, 1);
  assert.equal(dbCalls[0].params[3], EVENT_CATEGORY.SYSTEM);
});

test("audit log swallows database failures and never throws", async () => {
  const failingDb = {
    query: async () => {
      throw new Error("database connection lost");
    },
  };

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") {
      return failingDb;
    }
    return origLoad.apply(this, arguments);
  };

  // Re-require to pick up the failing db. Clear the cache first.
  delete require.cache[require.resolve("../services/auditService")];
  const { log: failingLog } = require("../services/auditService");

  Module._load = origLoad;

  // Should not throw.
  await failingLog({
    userId: 1,
    actorUserId: null,
    eventType: EVENT_TYPE.LOGIN_SUCCESS,
    outcome: "success",
  });
});

test("logAuthenticated uses req.user.userId as actor", async () => {
  dbCalls.length = 0;

  await logAuthenticated({
    req: {
      user: { userId: 77 },
      headers: {},
      connection: { remoteAddress: null },
      ip: null,
    },
    userId: 77,
    eventType: EVENT_TYPE.DOC_UPDATE,
    outcome: "success",
  });

  assert.equal(dbCalls.length, 1);
  assert.equal(dbCalls[0].params[1], 77);
  assert.equal(dbCalls[0].params[0], 77);
});

test("logAuthenticated falls back to null actor when req.user is absent", async () => {
  dbCalls.length = 0;

  await logAuthenticated({
    req: {
      user: null,
      headers: {},
      connection: { remoteAddress: null },
      ip: null,
    },
    userId: null,
    eventType: EVENT_TYPE.REGISTER,
    outcome: "success",
  });

  assert.equal(dbCalls.length, 1);
  assert.equal(dbCalls[0].params[1], null);
  assert.equal(dbCalls[0].params[0], null);
});
