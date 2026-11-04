"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

let queryImpl;
let queryCalls = 0;

const dbStub = {
  query: async (...args) => {
    queryCalls += 1;
    return queryImpl(...args);
  },
};

// Inject the database stub before loading the middleware.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (
    request === "../config/db" &&
    parent &&
    parent.filename.endsWith("middleware\\requireAdmin.js")
  ) {
    return dbStub;
  }
  return originalLoad.apply(this, arguments);
};

let requireAdmin;

try {
  requireAdmin = require("../middleware/requireAdmin");
} finally {
  Module._load = originalLoad;
}

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
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

function resetQuery(implementation) {
  queryCalls = 0;
  queryImpl = implementation;
}

test("allows an administrator after checking the database role", async () => {
  resetQuery(async (sql, params) => {
    assert.match(sql, /SELECT role FROM public\.users/i);
    assert.deepEqual(params, [42]);
    return { rows: [{ role: "admin" }] };
  });

  const req = { user: { userId: 42, role: "user" } };
  const res = makeResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(queryCalls, 1);
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("denies a regular user even if the JWT claims admin", async () => {
  resetQuery(async () => ({ rows: [{ role: "user" }] }));

  const req = { user: { userId: 7, role: "admin" } };
  const res = makeResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ADMIN_ACCESS_REQUIRED");
  assert.equal(nextCalled, false);
});

test("rejects a user ID missing from the database", async () => {
  resetQuery(async () => ({ rows: [] }));

  const req = { user: { userId: 99 } };
  const res = makeResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("rejects a missing user ID without querying the database", async () => {
  resetQuery(async () => ({ rows: [{ role: "admin" }] }));

  const req = { user: {} };
  const res = makeResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(queryCalls, 0);
  assert.equal(nextCalled, false);
});

test("rejects a non-integer user ID without querying the database", async () => {
  resetQuery(async () => ({ rows: [{ role: "admin" }] }));

  const req = { user: { userId: "1.5" } };
  const res = makeResponse();
  let nextCalled = false;

  await requireAdmin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(queryCalls, 0);
  assert.equal(nextCalled, false);
});

test("fails closed when the database query fails", async () => {
  resetQuery(async () => {
    throw new Error("simulated database failure");
  });

  const req = { user: { userId: 42 } };
  const res = makeResponse();
  let nextCalled = false;
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    await requireAdmin(req, res, () => {
      nextCalled = true;
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
  assert.equal(nextCalled, false);
});
