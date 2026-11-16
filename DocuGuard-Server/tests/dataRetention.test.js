"use strict";

// Prevent scheduled jobs from starting during unit tests.
process.env.NODE_ENV = "test";

/**
 * Unit tests for the data retention cleanup job.
 *
 * The database layer is stubbed so no real database, network, or production
 * data is touched. The retention job is exercised with scripted query
 * results to verify that purge decisions are driven by the TTL settings.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const dbCalls = [];

function makeDb(users, deleteResults = {}) {
  const queryFn = async (sql, params) => {
    dbCalls.push({ sql, params });

    if (sql.includes("FROM users u")) {
      return { rows: users };
    }
    if (sql.includes("status = 'deleted'")) {
      return { rows: deleteResults.deleted || [] };
    }
    if (sql.includes("status <> 'deleted'")) {
      return { rows: deleteResults.expired || [] };
    }
    return { rows: [] };
  };

  return {
    query: queryFn,
    withTransaction: async (fn) => {
      const client = { query: queryFn };
      return await fn(client);
    },
  };
}

const Module = require("module");
const originalLoad = Module._load;

process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";
delete process.env.DEBUG_LOG_FILE;

function assertDeletedPurge(calls, userId, ttlDays) {
  const call = calls.find(
    (c) => c.sql.includes("status = 'deleted'") && c.params[0] === userId
  );
  assert.ok(call, `Expected deleted-documents purge for user ${userId}`);
  assert.equal(call.params[0], userId);
  assert.equal(call.params[2], ttlDays);
  assert.equal(typeof call.params[1], "string");
  assert.ok(call.params[1].length > 0);
  return call;
}

function assertNoExpiredPurge(calls, userId) {
  const call = calls.find(
    (c) => c.sql.includes("status <> 'deleted'") && c.params[0] === userId
  );
  assert.equal(
    call,
    undefined,
    `Expired documents must not be auto-purged for user ${userId}`,
  );
}

test("retention cleanup purges soft-deleted documents past their TTL", async () => {
  dbCalls.length = 0;

  const users = [{ id: 1, email: "a@example.com" }];
  const db = makeDb(users, {
    deleted: [{ id: 101 }, { id: 102 }],
    expired: [],
  });

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return db;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../jobs/dataRetention")];
  const { runRetentionCleanup } = require("../jobs/dataRetention");
  Module._load = originalLoad;

  await runRetentionCleanup();

  assertDeletedPurge(dbCalls, 1, 30);
  assertNoExpiredPurge(dbCalls, 1);
});

test("retention cleanup does not auto-purge expired documents", async () => {
  dbCalls.length = 0;

  const users = [{ id: 2, email: "b@example.com" }];
  const db = makeDb(users, {
    deleted: [],
    expired: [{ id: 201 }],
  });

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return db;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../jobs/dataRetention")];
  const { runRetentionCleanup } = require("../jobs/dataRetention");
  Module._load = originalLoad;

  await runRetentionCleanup();

  assertNoExpiredPurge(dbCalls, 2);
});

test("retention cleanup uses per-user deleted TTL and never purges expired rows", async () => {
  dbCalls.length = 0;

  const users = [
    { id: 1, email: "a@example.com", expired_ttl_days: 60, deleted_ttl_days: 7 },
    { id: 2, email: "b@example.com" },
  ];
  const db = makeDb(users, {
    deleted: [],
    expired: [],
  });

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return db;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../jobs/dataRetention")];
  const { runRetentionCleanup } = require("../jobs/dataRetention");
  Module._load = originalLoad;

  await runRetentionCleanup();

  const userQuery = dbCalls.find((c) => c.sql.includes("FROM users u"));
  assert.ok(userQuery, "Expected user lookup with retention join");

  assertDeletedPurge(dbCalls, 1, 7);
  assertDeletedPurge(dbCalls, 2, 30);
  assertNoExpiredPurge(dbCalls, 1);
  assertNoExpiredPurge(dbCalls, 2);
});

test("retention cleanup handles empty user list gracefully", async () => {
  dbCalls.length = 0;

  const db = makeDb([], {});

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return db;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../jobs/dataRetention")];
  const { runRetentionCleanup } = require("../jobs/dataRetention");
  Module._load = originalLoad;

  await runRetentionCleanup();
  assert.equal(dbCalls.filter((c) => c.sql.includes("status = 'deleted'")).length, 0);
});

test("retention cleanup continues when one user fails", async () => {
  dbCalls.length = 0;

  const users = [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ];

  const db = {
    query: async (sql, params) => {
      dbCalls.push({ sql, params });

      if (sql.includes("FROM users u")) {
        return { rows: users };
      }

      if (params && params[0] === 1) {
        throw new Error("connection lost for user 1");
      }

      if (sql.includes("status = 'deleted'")) {
        return { rows: [{ id: 99 }] };
      }

      return { rows: [] };
    },
    withTransaction: async (fn) => {
      const client = {
        query: async (sql, params) => {
          if (params && params[0] === 1) {
            throw new Error("connection lost for user 1");
          }
          return { rows: [] };
        },
      };
      return await fn(client);
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return db;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../jobs/dataRetention")];
  const { runRetentionCleanup } = require("../jobs/dataRetention");
  Module._load = originalLoad;

  await runRetentionCleanup();

  const user2Queries = dbCalls.filter((c) => c.params && c.params[0] === 2);
  assert.ok(user2Queries.length > 0, "Expected user 2 to be processed");
});

/**
 * Audit-log authorization tests.
 */

test("audit service only issues INSERT statements against audit_log", async () => {
  const sqlStatements = [];

  const dbStub = {
    query: async (sql, params) => {
      sqlStatements.push({ sql, params });
      return { rows: [] };
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return dbStub;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../services/auditService")];
  const { log, logAuthenticated } = require("../services/auditService");

  Module._load = originalLoad;

  await log({
    userId: 1,
    actorUserId: 1,
    eventType: "doc_delete",
    outcome: "success",
    resource: { type: "document", id: "42" },
  });

  await logAuthenticated({
    req: { user: { userId: 1 }, headers: {}, connection: { remoteAddress: null }, ip: null },
    userId: 1,
    eventType: "doc_read",
    outcome: "success",
  });

  for (const stmt of sqlStatements) {
    if (stmt.sql.includes("audit_log")) {
      assert.match(
        stmt.sql,
        /^\s*INSERT\s+INTO\s+audit_log/i,
        `audit_log statement must be INSERT, got: ${stmt.sql}`,
      );
    }
  }

  assert.ok(
    sqlStatements.some((s) => s.sql.includes("INSERT INTO audit_log")),
    "expected at least one INSERT into audit_log",
  );
});

test("audit service never issues UPDATE or DELETE against audit_log", async () => {
  const sqlStatements = [];

  const dbStub = {
    query: async (sql, params) => {
      sqlStatements.push({ sql, params });
      return { rows: [] };
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === "../config/db") return dbStub;
    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve("../services/auditService")];
  const { log } = require("../services/auditService");

  Module._load = originalLoad;

  await log({
    userId: 1,
    actorUserId: 1,
    eventType: "doc_delete",
    outcome: "success",
  });

  const mutating = sqlStatements.filter(
    (s) =>
      s.sql.includes("audit_log") &&
      /^\s*(UPDATE|DELETE)\s+/i.test(s.sql),
  );
  assert.equal(mutating.length, 0, "no UPDATE or DELETE against audit_log");
});
