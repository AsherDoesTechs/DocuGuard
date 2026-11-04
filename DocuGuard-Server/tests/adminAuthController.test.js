"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");

const controllerPath = path.resolve(
  __dirname,
  "../controllers/adminAuthController.js",
);

let queryImpl;
let transactionImpl;
let signCalls = [];
let commitCount = 0;
let rollbackCount = 0;
let transactionQueries = [];

const dbStub = {
  query: (...args) => queryImpl(...args),
  withTransaction: (...args) => transactionImpl(...args),
};

const bcryptStub = {
  compare: async () => true,
};

const jwtStub = {
  sign: (...args) => {
    signCalls.push(args);
    return "local-test-admin-session-token";
  },
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const parentFile = parent?.filename ? path.resolve(parent.filename) : "";

  if (parentFile === controllerPath) {
    if (request === "../config/db") return dbStub;
    if (request === "bcryptjs") return bcryptStub;
    if (request === "jsonwebtoken") return jwtStub;
    if (request === "../utils/totp") {
      return { verifyTOTP: () => true };
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

const originalJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "local-test-secret-longer-than-thirty-two-characters";

test.after(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

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

const pendingToken = "P".repeat(43);
const challengeId = "challenge-test-123456789";
const challengeValue = "local-test-challenge-value";

function setup(options = {}) {
  signCalls = [];
  commitCount = 0;
  rollbackCount = 0;
  transactionQueries = [];

  const keyPair = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const publicKeyPem =
    options.publicKeyPem ||
    keyPair.publicKey.export({ type: "spki", format: "pem" });

  const attempt = {
    attempt_id: 101,
    user_id: 42,
    expires_at: options.attemptExpired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 60_000),
    used_at: options.attemptUsed ? new Date() : null,
    email: "admin-test@example.invalid",
    name: "Local Test Admin",
    role: options.role || "admin",
    admin_id: "LOCAL-ADMIN-001",
    is_verified: options.unverified ? false : true,
  };

  const device = {
    id: 7,
    public_key_pem: publicKeyPem,
    key_algorithm: options.keyAlgorithm || "ECDSA_P256_SHA256",
  };

  const challenge = {
    challenge_id: challengeId,
    challenge_value: challengeValue,
    expires_at: options.challengeExpired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 60_000),
    used_at: options.challengeUsed ? new Date() : null,
  };

  const client = {
    query: async (sql, params = []) => {
      transactionQueries.push({ sql, params: [...params] });

      if (/SELECT a\.id AS attempt_id/i.test(sql)) {
        return {
          rows: options.pendingMissing ? [] : [attempt],
          rowCount: options.pendingMissing ? 0 : 1,
        };
      }

      if (/SELECT id\s+FROM public\.admin_devices/i.test(sql)) {
        return {
          rows: options.deviceMissing ? [] : [{ id: 7 }],
          rowCount: options.deviceMissing ? 0 : 1,
        };
      }

      if (/SELECT id, public_key_pem, key_algorithm/i.test(sql)) {
        return {
          rows: options.deviceMissing ? [] : [device],
          rowCount: options.deviceMissing ? 0 : 1,
        };
      }

      if (/SELECT challenge_id, challenge_value/i.test(sql)) {
        return {
          rows: options.challengeMissing ? [] : [challenge],
          rowCount: options.challengeMissing ? 0 : 1,
        };
      }

      if (/UPDATE public\.admin_device_challenges/i.test(sql)) {
        if (/RETURNING\s+challenge_id/i.test(sql)) {
          return {
            rows: options.challengeConsumeFails
              ? []
              : [{ challenge_id: challengeId }],
            rowCount: options.challengeConsumeFails ? 0 : 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }

      if (/UPDATE public\.admin_login_attempts/i.test(sql)) {
        return {
          rows: options.attemptConsumeFails ? [] : [{ id: 101 }],
          rowCount: options.attemptConsumeFails ? 0 : 1,
        };
      }

      if (/UPDATE public\.admin_devices/i.test(sql)) {
        return {
          rows: options.deviceUpdateFails ? [] : [{ id: 7 }],
          rowCount: options.deviceUpdateFails ? 0 : 1,
        };
      }

      if (/INSERT INTO public\.admin_device_challenges/i.test(sql)) {
        if (options.challengeInsertFails) {
          throw new Error("Simulated local challenge insert failure");
        }
        return { rows: [], rowCount: 1 };
      }

      throw new Error("Unexpected transaction query: " + sql);
    },
  };

  transactionImpl = async (callback) => {
    try {
      const result = await callback(client);
      commitCount += 1;
      return result;
    } catch (error) {
      rollbackCount += 1;
      throw error;
    }
  };

  queryImpl = async (sql) => {
    if (/SELECT id, email, name, password_hash/i.test(sql)) {
      const user = {
        id: 42,
        email: "admin-test@example.invalid",
        name: "Local Test Admin",
        password_hash: "mock-hash",
        is_verified: !options.unverified,
        role: options.role || "admin",
        admin_id: "LOCAL-ADMIN-001",
        two_factor_secret: null,
        two_factor_enabled_at: null,
      };
      return {
        rows: options.userMissing ? [] : [user],
        rowCount: options.userMissing ? 0 : 1,
      };
    }

    if (/INSERT INTO public\.admin_login_attempts/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error("Unexpected database query: " + sql);
  };

  const signature = crypto
    .sign("sha256", Buffer.from(challengeValue, "utf8"), keyPair.privateKey)
    .toString("base64");

  return { keyPair, signature };
}

function makeVerifyRequest(signature, overrides = {}) {
  return {
    body: {
      pendingToken,
      challengeId,
      deviceId: "7",
      signature,
      ...overrides,
    },
  };
}

function makeChallengeRequest(overrides = {}) {
  return {
    body: {
      pendingToken,
      deviceId: "7",
      ...overrides,
    },
  };
}

test("active controller exports all three authentication stages", () => {
  assert.equal(typeof controller.adminLogin, "function");
  assert.equal(typeof controller.createChallenge, "function");
  assert.equal(typeof controller.verifyDevice, "function");
});

test("Stage 1 returns a pending token without issuing a session JWT", async () => {
  setup();
  const res = makeResponse();

  await controller.adminLogin(
    {
      body: {
        adminId: "LOCAL-ADMIN-001",
        password: "local-test-password",
      },
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.pendingToken, "string");
  assert.equal(res.body.requiresDeviceVerification, true);
  assert.equal(res.body.expiresIn, 300);
  assert.equal(signCalls.length, 0);
});

test("Stage 2 creates a challenge and invalidates older challenges first", async () => {
  setup();
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.challengeId, /^[0-9a-f-]{36}$/i);
  assert.equal(Buffer.from(res.body.challenge, "base64url").length, 32);
  assert.equal(res.body.expiresIn, 90);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  const invalidationIndex = transactionQueries.findIndex(
    (entry) =>
      /UPDATE public\.admin_device_challenges/i.test(entry.sql) &&
      /SET used_at = NOW\(\)/i.test(entry.sql) &&
      !/RETURNING\s+challenge_id/i.test(entry.sql),
  );
  const insertIndex = transactionQueries.findIndex((entry) =>
    /INSERT INTO public\.admin_device_challenges/i.test(entry.sql),
  );

  assert.ok(invalidationIndex >= 0);
  assert.ok(insertIndex > invalidationIndex);
});

test("Stage 2 rejects a pending login that has expired", async () => {
  setup({ attemptExpired: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_PENDING_LOGIN_INVALID");
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_device_challenges/i.test(entry.sql),
    ),
    false,
  );
});

test("Stage 2 rejects an unauthorized device", async () => {
  setup({ deviceMissing: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ADMIN_DEVICE_NOT_AUTHORIZED");
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_device_challenges/i.test(entry.sql),
    ),
    false,
  );
});

test("Stage 2 rolls back when challenge insertion throws", async () => {
  setup({ challengeInsertFails: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
});

test("Stage 3 issues a JWT only after valid P-256 proof and transaction commit", async () => {
  const fixture = setup();
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, "local-test-admin-session-token");
  assert.equal(res.body.expiresIn, 8 * 60 * 60);
  assert.equal(signCalls.length, 1);
  assert.equal(signCalls[0][0].userId, 42);
  assert.equal(signCalls[0][0].role, "admin");
  assert.equal(signCalls[0][0].deviceId, "7");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  const consumption = transactionQueries.find(
    (entry) =>
      /UPDATE public\.admin_device_challenges/i.test(entry.sql) &&
      /RETURNING\s+challenge_id/i.test(entry.sql),
  );

  assert.ok(consumption, "valid proof should consume its challenge");
  assert.match(consumption.sql, /challenge_id\s*=\s*\$1/i);
  assert.match(consumption.sql, /AND user_id\s*=\s*\$2/i);
  assert.match(consumption.sql, /AND device_id\s*=\s*\$3/i);
  assert.match(consumption.sql, /AND login_attempt_id\s*=\s*\$4/i);
  assert.deepEqual(consumption.params, [challengeId, 42, "7", 101]);
});

test("Stage 3 binds the challenge to the user, device, and pending attempt", async () => {
  const fixture = setup();
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  const lookup = transactionQueries.find((entry) =>
    /SELECT challenge_id, challenge_value/i.test(entry.sql),
  );

  assert.ok(lookup);
  assert.match(lookup.sql, /challenge_id\s*=\s*\$1/i);
  assert.match(lookup.sql, /AND user_id\s*=\s*\$2/i);
  assert.match(lookup.sql, /AND device_id\s*=\s*\$3/i);
  assert.match(lookup.sql, /AND login_attempt_id\s*=\s*\$4/i);
  assert.deepEqual(lookup.params, [challengeId, 42, "7", 101]);
});

test("Stage 3 consumes a challenge after invalid signature without consuming pending login or issuing a JWT", async () => {
  setup();
  const res = makeResponse();

  const wrongSignature = crypto
    .sign(
      "sha256",
      Buffer.from("different-message", "utf8"),
      crypto.generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
      }).privateKey,
    )
    .toString("base64");

  await controller.verifyDevice(makeVerifyRequest(wrongSignature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  const consumption = transactionQueries.find(
    (entry) =>
      /UPDATE public\.admin_device_challenges/i.test(entry.sql) &&
      /RETURNING\s+challenge_id/i.test(entry.sql),
  );

  assert.ok(consumption, "invalid proof should consume its challenge");
  assert.match(consumption.sql, /challenge_id\s*=\s*\$1/i);
  assert.match(consumption.sql, /AND user_id\s*=\s*\$2/i);
  assert.match(consumption.sql, /AND device_id\s*=\s*\$3/i);
  assert.match(consumption.sql, /AND login_attempt_id\s*=\s*\$4/i);
  assert.deepEqual(consumption.params, [challengeId, 42, "7", 101]);

  assert.equal(
    transactionQueries.some((entry) =>
      /UPDATE public\.admin_login_attempts/i.test(entry.sql),
    ),
    false,
    "invalid proof must not consume the pending login",
  );
});

test("Stage 3 rejects an RSA key labelled as P-256", async () => {
  const rsaPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const fixture = setup({
    publicKeyPem: rsaPair.publicKey.export({
      type: "spki",
      format: "pem",
    }),
    keyAlgorithm: "ECDSA_P256_SHA256",
  });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(signCalls.length, 0);
});

test("Stage 3 rejects an unauthorized device", async () => {
  const fixture = setup({ deviceMissing: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ADMIN_DEVICE_NOT_AUTHORIZED");
  assert.equal(signCalls.length, 0);
});

test("Stage 3 rejects an expired challenge", async () => {
  const fixture = setup({ challengeExpired: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
});

test("Stage 3 rejects an already-used challenge", async () => {
  const fixture = setup({ challengeUsed: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
});

test("Stage 3 rolls back when challenge consumption fails", async () => {
  const fixture = setup({ challengeConsumeFails: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
  assert.equal(signCalls.length, 0);
});

test("Stage 3 rolls back when pending-login consumption fails", async () => {
  const fixture = setup({ attemptConsumeFails: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 503);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
  assert.equal(signCalls.length, 0);
});

test("Stage 3 rolls back when updating device last-used fails", async () => {
  const fixture = setup({ deviceUpdateFails: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 503);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
  assert.equal(signCalls.length, 0);
});

test("Stage 3 fails closed when JWT_SECRET is missing", async () => {
  const fixture = setup();
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  try {
    const res = makeResponse();

    await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
    assert.equal(signCalls.length, 0);
    assert.equal(transactionQueries.length, 0);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});

test("Stage 3 fails closed when JWT_SECRET is too short", async () => {
  const fixture = setup();
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "too-short";

  try {
    const res = makeResponse();

    await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
    assert.equal(signCalls.length, 0);
    assert.equal(transactionQueries.length, 0);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});
