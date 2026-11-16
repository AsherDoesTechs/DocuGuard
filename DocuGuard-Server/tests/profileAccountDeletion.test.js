"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const db = require("../config/db");
const dataSyncServicePath = require.resolve(
  "../services/dataSyncService",
);

require.cache[dataSyncServicePath] = {
  id: dataSyncServicePath,
  filename: dataSyncServicePath,
  loaded: true,
  exports: {
    syncProfile: async () => {},
  },
};

const profileController = require("../controllers/profileController");

function makeResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function runDeleteAccount({ failOnSql } = {}) {
  const originalWithTransaction = db.withTransaction;
  const originalQuery = db.query;
  const originalCompare = bcrypt.compare;
  const queries = [];
  let transactionStarted = false;
  let transactionCommitted = false;
  let transactionRolledBack = false;

  bcrypt.compare = async () => true;
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    if (/SELECT password_hash FROM users/i.test(sql)) {
      return { rows: [{ password_hash: "hashed" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };

  db.withTransaction = async (callback) => {
    transactionStarted = true;

    const client = {
      query: async (sql, params) => {
        queries.push({ sql, params });

        if (failOnSql && sql.includes(failOnSql)) {
          throw new Error("Simulated account deletion failure");
        }

        return { rows: [], rowCount: 1 };
      },
    };

    try {
      const result = await callback(client);
      transactionCommitted = true;
      return result;
    } catch (error) {
      transactionRolledBack = true;
      throw error;
    }
  };

  const req = { user: { userId: 7 }, body: { password: "current-password" } };
  const res = makeResponse();

  try {
    await profileController.deleteAccount(req, res);
  } finally {
    db.withTransaction = originalWithTransaction;
    db.query = originalQuery;
    bcrypt.compare = originalCompare;
  }

  return {
    queries,
    res,
    transactionStarted,
    transactionCommitted,
    transactionRolledBack,
  };
}

test("account deletion runs all expected deletes in one transaction", async () => {
  const result = await runDeleteAccount();

  assert.equal(result.res.statusCode, 200);
  assert.equal(
    result.res.payload.message,
    "Account deleted successfully",
  );
  assert.equal(result.transactionStarted, true);
  assert.equal(result.transactionCommitted, true);
  assert.equal(result.transactionRolledBack, false);

  const tables = result.queries
    .filter(({ sql }) => /DELETE FROM\s+/i.test(sql))
    .map(({ sql }) => {
      const match = sql.match(/DELETE FROM\s+(\w+)/i);
      return match ? match[1] : null;
    });

  assert.deepEqual(tables, [
    "reminders",
    "documents",
    "user_settings",
    "login_sessions",
    "support_tickets",
    "transactions",
    "exports",
    "users",
  ]);

  for (const query of result.queries.filter(({ sql }) => /DELETE FROM\s+/i.test(sql))) {
    assert.deepEqual(query.params, [7]);
  }

  const userDelete = result.queries.find(({ sql }) => /DELETE FROM users/i.test(sql));
  assert.ok(userDelete);
  assert.match(userDelete.sql, /DELETE FROM users WHERE id = \$1/i);
});

test("account deletion reports failure and does not report success when a delete fails", async () => {
  const result = await runDeleteAccount({
    failOnSql: "DELETE FROM documents",
  });

  assert.equal(result.res.statusCode, 500);
  assert.equal(
    result.res.payload.error,
    "Server error deleting account",
  );
  assert.equal(result.transactionStarted, true);
  assert.equal(result.transactionCommitted, false);
  assert.equal(result.transactionRolledBack, true);

  // Later deletes, including the user row, must not be attempted.
  assert.equal(
    result.queries.some(({ sql }) => /DELETE FROM users/i.test(sql)),
    false,
  );
});
