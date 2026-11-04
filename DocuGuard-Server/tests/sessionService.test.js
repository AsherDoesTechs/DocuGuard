"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");

const servicePath = path.resolve(
  __dirname,
  "../services/sessionService.js",
);

function loadService(mockDb) {
  const originalLoad = Module._load;

  try {
    Module._load = function (request, parent, isMain) {
      if (
        request === "../config/db" &&
        parent &&
        parent.filename === servicePath
      ) {
        return mockDb;
      }

      return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[servicePath];
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
}

test("hashSessionToken returns a SHA-256 hash, not the original token", () => {
  const service = loadService({ query: async () => ({ rows: [] }) });
  const token = "example-session-token";
  const expected = crypto
    .createHash("sha256")
    .update(token, "utf8")
    .digest("hex");

  assert.equal(service.hashSessionToken(token), expected);
  assert.notEqual(service.hashSessionToken(token), token);
  assert.throws(() => service.hashSessionToken(""), /token is required/i);
  assert.throws(() => service.hashSessionToken(null), /token is required/i);
});

test("createSession inserts a hashed token and session expiry", async () => {
  let capturedQuery;
  let capturedParams;

  const service = loadService({
    query: async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return { rows: [{ id: 42 }] };
    },
  });

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const result = await service.createSession({
    userId: 7,
    token: "test-jwt",
    expiresAt,
    deviceName: "Test device",
    platform: "android",
    ipAddress: "127.0.0.1",
  });

  assert.deepEqual(result, { id: 42 });
  assert.match(capturedQuery, /INSERT INTO login_sessions/i);
  assert.match(capturedQuery, /session_token_hash/i);
  assert.match(capturedQuery, /expires_at/i);
  assert.equal(capturedParams[0], 7);
  assert.equal(capturedParams[1], "Test device");
  assert.equal(capturedParams[2], "android");
  assert.equal(capturedParams[5], service.hashSessionToken("test-jwt"));
  assert.equal(capturedParams[6], expiresAt.toISOString());
  assert.notEqual(capturedParams[5], "test-jwt");
});

test("createSession rejects missing user IDs and invalid expiries", async () => {
  let queryCount = 0;
  const service = loadService({
    query: async () => {
      queryCount += 1;
      return { rows: [] };
    },
  });

  await assert.rejects(
    service.createSession({
      userId: null,
      token: "test-jwt",
      expiresAt: new Date(Date.now() + 60_000),
    }),
    /user ID is required/i,
  );

  await assert.rejects(
    service.createSession({
      userId: 7,
      token: "test-jwt",
      expiresAt: new Date(Date.now() - 60_000),
    }),
    /valid future session expiry/i,
  );

  await assert.rejects(
    service.createSession({
      userId: 7,
      token: "test-jwt",
      expiresAt: "not-a-date",
    }),
    /valid future session expiry/i,
  );

  assert.equal(queryCount, 0);
});

test("isSessionActive returns true when a matching active session exists", async () => {
  let capturedParams;

  const service = loadService({
    query: async (sql, params) => {
      assert.match(sql, /revoked\s*=\s*FALSE/i);
      assert.match(sql, /expires_at\s*>\s*NOW\(\)/i);
      capturedParams = params;
      return { rows: [{ id: 42 }] };
    },
  });

  const active = await service.isSessionActive({
    userId: 7,
    token: "test-jwt",
  });

  assert.equal(active, true);
  assert.deepEqual(capturedParams, [
    7,
    service.hashSessionToken("test-jwt"),
  ]);
});

test("isSessionActive returns false when no matching session exists", async () => {
  const service = loadService({
    query: async () => ({ rows: [] }),
  });

  assert.equal(
    await service.isSessionActive({ userId: 7, token: "unknown-jwt" }),
    false,
  );

  assert.equal(
    await service.isSessionActive({ userId: null, token: "unknown-jwt" }),
    false,
  );
});

test("revokeSession marks the matching session revoked", async () => {
  let capturedQuery;
  let capturedParams;

  const service = loadService({
    query: async (sql, params) => {
      capturedQuery = sql;
      capturedParams = params;
      return { rows: [{ id: 42 }] };
    },
  });

  const revoked = await service.revokeSession({
    userId: 7,
    token: "test-jwt",
  });

  assert.equal(revoked, true);
  assert.match(capturedQuery, /UPDATE login_sessions/i);
  assert.match(capturedQuery, /revoked\s*=\s*TRUE/i);
  assert.match(capturedQuery, /revoked_at/i);
  assert.deepEqual(capturedParams, [
    7,
    service.hashSessionToken("test-jwt"),
  ]);
});

test("revokeSession returns false when no matching session exists", async () => {
  const service = loadService({
    query: async () => ({ rows: [] }),
  });

  assert.equal(
    await service.revokeSession({ userId: 7, token: "unknown-jwt" }),
    false,
  );

  assert.equal(
    await service.revokeSession({ userId: null, token: "unknown-jwt" }),
    false,
  );
});

test("database errors are propagated instead of treated as successful checks", async () => {
  const databaseError = new Error("simulated database failure");
  const service = loadService({
    query: async () => {
      throw databaseError;
    },
  });

  await assert.rejects(
    service.isSessionActive({ userId: 7, token: "test-jwt" }),
    (error) => error === databaseError,
  );

  await assert.rejects(
    service.revokeSession({ userId: 7, token: "test-jwt" }),
    (error) => error === databaseError,
  );
});
