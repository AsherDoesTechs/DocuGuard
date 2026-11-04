"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const middlewarePath = path.resolve(__dirname, "../middleware/auth.js");

function loadMiddleware({
  verifyImpl,
  isSessionActiveImpl,
  isAdminDeviceActiveImpl = async () => false,
}) {
  const originalLoad = Module._load;

  try {
    Module._load = function (request, parent, isMain) {
      const parentFile = parent?.filename ? path.resolve(parent.filename) : "";

      if (parentFile === middlewarePath) {
        if (request === "jsonwebtoken") {
          return { verify: verifyImpl };
        }

        if (request === "../services/sessionService") {
          return { isSessionActive: isSessionActiveImpl };
        }

        if (request === "../services/adminDeviceSessionService") {
          return {
            isAdminDeviceActive: isAdminDeviceActiveImpl,
          };
        }

        if (request === "../utils/debugLogger") {
          return {
            debug: () => {},
            warn: () => {},
            error: () => {},
          };
        }
      }

      return originalLoad.apply(this, arguments);
    };

    delete require.cache[middlewarePath];
    return require(middlewarePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[middlewarePath];
  }
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

function makeRequest(token = "test-jwt") {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: "/documents",
    method: "GET",
  };
}

test("rejects requests without a bearer token", () => {
  const middleware = loadMiddleware({
    verifyImpl: () => {
      throw new Error("Should not verify a missing token");
    },
    isSessionActiveImpl: async () => true,
  });

  const req = makeRequest(null);
  const res = makeResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("rejects invalid JWTs without checking session storage", () => {
  const middleware = loadMiddleware({
    verifyImpl: () => {
      throw new Error("invalid token");
    },
    isSessionActiveImpl: async () => {
      assert.fail("Session lookup must not run for an invalid JWT");
    },
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("allows a valid JWT with an active session", async () => {
  const middleware = loadMiddleware({
    verifyImpl: () => ({ userId: 7, role: "user" }),
    isSessionActiveImpl: async ({ userId, token }) => {
      assert.equal(userId, 7);
      assert.equal(token, "test-jwt");
      return true;
    },
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, { userId: 7, role: "user" });
});

test("rejects a valid JWT whose session has been revoked", async () => {
  const middleware = loadMiddleware({
    verifyImpl: () => ({ userId: 7, role: "user" }),
    isSessionActiveImpl: async () => false,
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("fails closed when session storage is unavailable", async () => {
  const middleware = loadMiddleware({
    verifyImpl: () => ({ userId: 7, role: "user" }),
    isSessionActiveImpl: async () => {
      throw new Error("sensitive database details");
    },
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 503);
  assert.equal(nextCalled, false);
  assert.doesNotMatch(JSON.stringify(res.body), /sensitive database details/);
});

test("allows an admin JWT only when its device is active", async () => {
  let deviceLookupCalled = false;

  const middleware = loadMiddleware({
    verifyImpl: () => ({
      userId: 42,
      role: "admin",
      deviceId: "7",
    }),
    isSessionActiveImpl: async () => {
      assert.fail("Device-bound admin JWTs must use device validation");
    },
    isAdminDeviceActiveImpl: async ({ userId, deviceId }) => {
      deviceLookupCalled = true;
      assert.equal(userId, 42);
      assert.equal(deviceId, "7");
      return true;
    },
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(deviceLookupCalled, true);
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, "admin");
});

test("rejects an admin JWT whose device has been revoked", async () => {
  const middleware = loadMiddleware({
    verifyImpl: () => ({
      userId: 42,
      role: "admin",
      deviceId: "7",
    }),
    isSessionActiveImpl: async () => {
      assert.fail("Device-bound admin JWTs must use device validation");
    },
    isAdminDeviceActiveImpl: async () => false,
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("does not let an admin role claim bypass session validation", async () => {
  let sessionLookupCalled = false;

  const middleware = loadMiddleware({
    verifyImpl: () => ({
      userId: 42,
      role: "admin",
    }),
    isSessionActiveImpl: async ({ userId, token }) => {
      sessionLookupCalled = true;
      assert.equal(userId, 42);
      assert.equal(token, "test-jwt");
      return false;
    },
  });

  const req = makeRequest();
  const res = makeResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(sessionLookupCalled, true);
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});
