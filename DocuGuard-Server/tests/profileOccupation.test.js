"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const controllerPath = path.resolve(
  __dirname,
  "../controllers/profileController.js",
);

let queryImpl;
let syncProfileCalls = [];

const dbStub = {
  query: (...args) => queryImpl(...args),
};

const syncProfileStub = async (...args) => {
  syncProfileCalls.push(args);
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const parentFile = parent?.filename
    ? path.resolve(parent.filename)
    : "";

  if (parentFile === controllerPath) {
    if (request === "../config/db") return dbStub;

    if (request === "../services/dataSyncService") {
      return { syncProfile: syncProfileStub };
    }
  }

  return originalLoad.apply(this, arguments);
};

let controller;

try {
  delete require.cache[controllerPath];
  controller = require(controllerPath);
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

function setup() {
  syncProfileCalls = [];
  const queries = [];

  queryImpl = async (sql, values) => {
    queries.push({ sql, values });

    if (/UPDATE users/i.test(sql)) {
      return { rowCount: 1, rows: [] };
    }

    return { rowCount: 0, rows: [] };
  };

  return { queries };
}

test("profile update includes occupation in SQL and parameters", async () => {
  const { queries } = setup();
  const req = {
    user: { userId: 42 },
    body: { occupation: "Software Developer" },
  };
  const res = makeResponse();

  await controller.updateProfile(req, res);

  const update = queries.find((q) =>
    /UPDATE users/i.test(q.sql),
  );

  assert.ok(update, "Expected users UPDATE query");
  assert.match(update.sql, /occupation\s*=\s*\$1/i);
  assert.deepEqual(update.values, ["Software Developer", 42]);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, "Profile updated successfully");

  assert.equal(syncProfileCalls.length, 1);
  assert.deepEqual(syncProfileCalls[0], [
    42,
    {
      name: undefined,
      email: undefined,
      occupation: "Software Developer",
    },
  ]);
});

test("profile update returns 500 when database update throws", async () => {
  setup();

  queryImpl = async () => {
    throw new Error("Mock database failure");
  };

  const req = {
    user: { userId: 42 },
    body: { occupation: "Software Developer" },
  };
  const res = makeResponse();

  const originalError = console.error;
  console.error = () => {};

  try {
    await controller.updateProfile(req, res);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.equal(
    res.body.error,
    "Server error updating profile",
  );

  assert.equal(syncProfileCalls.length, 0);
});

test("profile update does not claim success when no user row is updated", async () => {
  setup();

  queryImpl = async () => ({
    rowCount: 0,
    rows: [],
  });

  const req = {
    user: { userId: 42 },
    body: { occupation: "Software Developer" },
  };
  const res = makeResponse();

  await controller.updateProfile(req, res);

  // Regression expectation:
  // The controller should detect that no user row was updated.
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "User not found");
});
