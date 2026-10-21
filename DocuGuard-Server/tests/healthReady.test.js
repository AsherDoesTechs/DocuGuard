"use strict";

/**
 * Readiness route diagnostics.
 *
 * Verifies that /health/ready returns HTTP 503 when the database query
 * fails, and that the diagnostic log output does not expose connection
 * strings, passwords, or other secrets.
 *
 * The route logs error.name, error.code, error.errno, and a sanitized
 * error.message. The sanitization redacts connection URLs and password
 * fragments before they reach stderr / Render logs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// Required by DocuGuard-Server/config/env.js assertEnvOrExit(), which runs
// when app.js is required.
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "placeholder-anon-key";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-the-suite-32-chars!!";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder";
process.env.FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || "placeholder-project";
process.env.FIREBASE_CLIENT_EMAIL =
  process.env.FIREBASE_CLIENT_EMAIL || "placeholder@placeholder.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\\nplaceholder\\n-----END PRIVATE KEY-----\\n";

// Mock config/firebase.js before app.js is required, because firebase-admin
// cert() needs a valid PEM private key that a placeholder cannot provide.
// The readiness route does not use Firebase, so this mock is safe.
const firebasePath = require.resolve("../config/firebase");
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {},
};

// Mock node-cron before app.js is required, because app.js loads
// jobs/expirationChecker which calls cron.schedule() and sets up a recurring
// timer that would keep the test process alive. The readiness route does not
// use cron, so this mock is safe.
const cronPath = require.resolve("node-cron");
require.cache[cronPath] = {
  id: cronPath,
  filename: cronPath,
  loaded: true,
  exports: { schedule: () => {} },
};

const db = require("../config/db");
const app = require("../app");

let server;
let port;

/**
 * Start one HTTP server for the whole suite. server.unref() ensures it does
 * not keep the Node event loop alive after the tests complete.
 */
test.before(async () => {
  server = http.createServer(app);
  server.unref();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

/**
 * Close the server after all tests so outstanding connections are released
 * and the process exits naturally.
 */
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // End the pg pool so it does not hold event-loop handles.
  await db.pool.end();
});

/**
 * Make a real HTTP request to the shared Express server and return
 * { statusCode, payload }. fetch() with an AbortController timeout guards
 * against a hung request if the server is not responding.
 */
async function callReadyRoute() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`, {
      signal: controller.signal,
    });
    const body = await res.json();
    return { statusCode: res.status, payload: body };
  } finally {
    clearTimeout(timeout);
  }
}

test("/health/ready returns 503 when the database query fails", async () => {
  const originalQuery = db.query;
  const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");
  error.name = "Error";
  error.code = "ECONNREFUSED";
  error.errno = -111;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503, "readiness failure must return 503");
  assert.equal(res.payload.status, "not_ready");
  assert.equal(res.payload.database, "unavailable");
  assert.equal(res.payload.error, "The database did not answer the readiness check.");

  assert.equal(logged.length, 1, "exactly one diagnostic log line");
  const [label, detail] = logged[0];
  assert.equal(label, "Readiness check failed:");
  assert.equal(detail.name, "Error");
  assert.equal(detail.code, "ECONNREFUSED");
  assert.equal(detail.errno, -111);
  assert.equal(detail.message, "connect ECONNREFUSED 127.0.0.1:5432");
});

test("/health/ready returns 200 when the database query succeeds", async () => {
  const originalQuery = db.query;
  db.query = async () => ({ rows: [], rowCount: 0 });

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
  }

  assert.equal(res.statusCode, 200, "readiness success must return 200");
  assert.equal(res.payload.status, "ready");
  assert.equal(res.payload.database, "ok");
});

test("/health/ready diagnostic log does not expose connection strings or passwords", async () => {
  const originalQuery = db.query;
  // A pg error message that hypothetically contains a connection URL and a password.
  const error = new Error(
    "Failed to connect to postgresql://dbuser:super-secret-pw@db-host.example.com:5432/production?sslmode=require; password=super-secret-pw",
  );
  error.name = "Error";
  error.code = "ECONNREFUSED";
  error.errno = -111;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(
    !message.includes("postgresql://"),
    "connection URL must be redacted",
  );
  assert.ok(
    !message.includes("super-secret-pw"),
    "password must be redacted",
  );
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready redacts DATABASE_URL prefixed connection strings", async () => {
  const originalQuery = db.query;
  const error = new Error(
    "DATABASE_URL=postgresql://dbuser:fake-pw-12345@db.internal:5432/app_db connection failed",
  );
  error.name = "Error";
  error.code = "ECONNREFUSED";
  error.errno = -111;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(!message.includes("fake-pw-12345"), "password must be redacted");
  assert.ok(!message.includes("postgresql://"), "connection URL must be redacted");
  assert.ok(!message.includes("db.internal"), "host must be redacted");
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready redacts password values with spaces around equals", async () => {
  const originalQuery = db.query;
  const error = new Error(
    "password = fake-pw-with-spaces failed to authenticate",
  );
  error.name = "Error";
  error.code = "28P01";
  error.errno = undefined;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(!message.includes("fake-pw-with-spaces"), "password must be redacted");
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready redacts quoted password values", async () => {
  const originalQuery = db.query;
  const error = new Error(
    "pwd='fake-pw-quoted' is invalid for user dbuser",
  );
  error.name = "Error";
  error.code = "28P01";
  error.errno = undefined;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(!message.includes("fake-pw-quoted"), "password must be redacted");
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready redacts quoted password values containing spaces", async () => {
  const originalQuery = db.query;
  const error = new Error(
    'password = "my secret pass phrase" failed to authenticate',
  );
  error.name = "Error";
  error.code = "28P01";
  error.errno = undefined;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(
    !message.includes("my secret pass phrase"),
    "password with spaces inside quotes must be redacted",
  );
  assert.ok(!message.includes("my"), "partial password must not leak");
  assert.ok(!message.includes("pass"), "partial password must not leak");
  assert.ok(!message.includes("phrase"), "partial password must not leak");
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready redacts quoted pwd values containing spaces", async () => {
  const originalQuery = db.query;
  const error = new Error(
    "pwd='fake pwd with spaces' is invalid for user dbuser",
  );
  error.name = "Error";
  error.code = "28P01";
  error.errno = undefined;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(
    !message.includes("fake pwd with spaces"),
    "single-quoted password with spaces must be redacted",
  );
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready redacts secret values with spaces around equals", async () => {
  const originalQuery = db.query;
  const error = new Error(
    "secret = fake-token-abcde-12345 is malformed",
  );
  error.name = "Error";
  error.code = "28P01";
  error.errno = undefined;

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  const message = detail.message;

  assert.ok(!message.includes("fake-token-abcde-12345"), "secret must be redacted");
  assert.ok(message.includes("[REDACTED]"), "redacted marker must be present");
});

test("/health/ready diagnostic log omits stack traces", async () => {
  const originalQuery = db.query;
  const error = new Error("connect ETIMEDOUT");
  error.name = "Error";
  error.code = "ETIMEDOUT";
  error.errno = -60;
  error.stack = "Error: connect ETIMEDOUT\n    at Object.<anonymous> (/app/server.js:1:1)";

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  assert.ok(!("stack" in detail), "stack trace must not be logged");
  assert.equal(detail.message, "connect ETIMEDOUT");
});

test("/health/ready logs missing code and errno as undefined when absent", async () => {
  const originalQuery = db.query;
  const error = new Error("getaddrinfo ENOTFOUND db-host.example.com");
  error.name = "Error";
  // Intentionally omit code and errno.

  db.query = async () => {
    throw error;
  };

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);

  let res;
  try {
    res = await callReadyRoute();
  } finally {
    db.query = originalQuery;
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 503);

  const [, detail] = logged[0];
  assert.equal(detail.name, "Error");
  assert.equal(detail.code, undefined);
  assert.equal(detail.errno, undefined);
  assert.equal(detail.message, "getaddrinfo ENOTFOUND db-host.example.com");
});
