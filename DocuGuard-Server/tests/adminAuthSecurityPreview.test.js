"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");

const previewPath = path.resolve(
  __dirname,
  "../controllers/adminAuthController.security-preview.js",
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
    return "test-only-admin-session-token";
  },
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const parentFile = parent?.filename
    ? path.resolve(parent.filename)
    : "";

  if (parentFile === previewPath) {
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
  delete require.cache[previewPath];
  controller = require(previewPath);
} finally {
  Module._load = originalLoad;
}

const originalJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "test-only-secret-with-more-than-32-characters";

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
const challengeValue = "test-challenge-value";

function setup(options = {}) {
  signCalls = [];
  commitCount = 0;
  rollbackCount = 0;
  transactionQueries = [];

  const keyPair = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const publicKeyPem = options.publicKeyPem ||
    keyPair.publicKey.export({
      type: "spki",
      format: "pem",
    });

  const attempt = {
    attempt_id: 101,
    user_id: 42,
    expires_at: options.attemptExpired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 60_000),
    used_at: options.attemptUsed ? new Date() : null,
    email: "admin-test@example.invalid",
    name: "Local Test Admin",
    role: "admin",
    admin_id: "LOCAL-ADMIN-001",
    is_verified: true,
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
            rows: options.challengeConsumeFails ? [] : [{ challenge_id: challengeId }],
            rowCount: options.challengeConsumeFails ? 0 : 1,
          };
        }

        return { rows: [], rowCount: 1 };
      }

      if (/INSERT INTO public\.admin_device_challenges/i.test(sql)) {
        if (options.challengeInsertFails) {
          throw new Error("Simulated challenge insert failure");
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
      return {
        rows: [{
          id: 42,
          email: "admin-test@example.invalid",
          name: "Local Test Admin",
          password_hash: "mock-hash",
          is_verified: true,
          role: "admin",
          admin_id: "LOCAL-ADMIN-001",
          two_factor_secret: null,
          two_factor_enabled_at: null,
        }],
        rowCount: 1,
      };
    }

    if (/INSERT INTO public\.admin_login_attempts/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error("Unexpected database query: " + sql);
  };

  const signature = crypto.sign(
    "sha256",
    Buffer.from(challengeValue, "utf8"),
    keyPair.privateKey,
  ).toString("base64");

  return {
    keyPair,
    signature,
    attempt,
    device,
    challenge,
  };
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

test("valid P-256 proof issues an admin token only after verification", async () => {
  const fixture = setup();
  const res = makeResponse();

  await controller.verifyDevice(
    makeVerifyRequest(fixture.signature),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, "test-only-admin-session-token");
  assert.equal(signCalls.length, 1);
  assert.equal(signCalls[0][0].userId, 42);
  assert.equal(signCalls[0][0].role, "admin");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("challenge lookup binds the challenge to the user, device, and pending login", async () => {
  const fixture = setup();
  const res = makeResponse();

  await controller.verifyDevice(
    makeVerifyRequest(fixture.signature),
    res,
  );

  assert.equal(res.statusCode, 200);

  const challengeLookup = transactionQueries.find(
    (entry) => /SELECT challenge_id, challenge_value/i.test(entry.sql),
  );

  assert.ok(challengeLookup, "challenge lookup query should be recorded");
  assert.match(challengeLookup.sql, /challenge_id\s*=\s*\$1/i);
  assert.match(challengeLookup.sql, /AND user_id\s*=\s*\$2/i);
  assert.match(challengeLookup.sql, /AND device_id\s*=\s*\$3/i);
  assert.match(challengeLookup.sql, /AND login_attempt_id\s*=\s*\$4/i);
  assert.deepEqual(challengeLookup.params, [challengeId, 42, "7", 101]);
  assert.equal(signCalls.length, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("invalid signature is rejected without issuing a token", async () => {
  const fixture = setup();
  const wrongSignature = crypto.sign(
    "sha256",
    Buffer.from("different-message", "utf8"),
    fixture.keyPair.privateKey,
  ).toString("base64");

  const res = makeResponse();
  await controller.verifyDevice(makeVerifyRequest(wrongSignature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
  assert.equal(commitCount, 1);
});

test("RSA public key is rejected even when the algorithm label claims P-256", async () => {
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

test("unauthorized or revoked device is rejected without issuing a token", async () => {
  const fixture = setup({ deviceMissing: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ADMIN_DEVICE_NOT_AUTHORIZED");
  assert.equal(signCalls.length, 0);
});

test("challenge consumption failure rolls back and issues no token", async () => {
  const fixture = setup({ challengeConsumeFails: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
  assert.equal(rollbackCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(signCalls.length, 0);
});

test("pending-login consumption failure rolls back and issues no token", async () => {
  const fixture = setup({ attemptConsumeFails: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 503);
  assert.equal(rollbackCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(signCalls.length, 0);
});

test("device last-used update failure rolls back and issues no token", async () => {
  const fixture = setup({ deviceUpdateFails: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 503);
  assert.equal(rollbackCount, 1);
  assert.equal(commitCount, 0);
  assert.equal(signCalls.length, 0);
});

test("Admin ID/password stage returns a pending token, not a session JWT", async () => {
  setup();
  const res = makeResponse();

  await controller.adminLogin({
    body: {
      adminId: "LOCAL-ADMIN-001",
      password: "test-password",
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.pendingToken, "string");
  assert.equal(res.body.requiresDeviceVerification, true);
  assert.equal(Object.hasOwn(res.body, "token"), false);
  assert.equal(signCalls.length, 0);
});


test("missing JWT secret fails closed without issuing a token", async () => {
  const fixture = setup();
  const originalSecret = process.env.JWT_SECRET;

  try {
    delete process.env.JWT_SECRET;

    const res = makeResponse();
    await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
    assert.equal(signCalls.length, 0);
    assert.equal(commitCount, 1);
    assert.equal(rollbackCount, 0);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("weak JWT secret fails closed without issuing a token", async () => {
  const fixture = setup();
  const originalSecret = process.env.JWT_SECRET;

  try {
    process.env.JWT_SECRET = "short-secret";

    const res = makeResponse();
    await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
    assert.equal(signCalls.length, 0);
    assert.equal(commitCount, 1);
    assert.equal(rollbackCount, 0);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("expired pending login is rejected without issuing a token", async () => {
  const fixture = setup({ attemptExpired: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
});

test("expired challenge is rejected without issuing a token", async () => {
  const fixture = setup({ challengeExpired: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
});

test("already-used challenge is rejected without issuing a token", async () => {
  const fixture = setup({ challengeUsed: true });
  const res = makeResponse();

  await controller.verifyDevice(makeVerifyRequest(fixture.signature), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_DEVICE_PROOF_INVALID");
  assert.equal(signCalls.length, 0);
});
function makeChallengeRequest(overrides = {}) {
  return {
    body: {
      pendingToken,
      deviceId: "7",
      ...overrides,
    },
  };
}

test("createChallenge creates a challenge transactionally and invalidates older challenges first", async () => {
  setup();
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.challengeId, "string");
  assert.match(res.body.challengeId, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof res.body.challenge, "string");
  assert.equal(Buffer.from(res.body.challenge, "base64url").length, 32);
  assert.equal(res.body.expiresIn, 90);
  assert.equal(signCalls.length, 0);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  const invalidationIndex = transactionQueries.findIndex(
    (entry) => /UPDATE public\.admin_device_challenges/i.test(entry.sql) &&
      /SET used_at = NOW\(\)/i.test(entry.sql) &&
      !/RETURNING\s+challenge_id/i.test(entry.sql),
  );
  const insertIndex = transactionQueries.findIndex(
    (entry) => /INSERT INTO public\.admin_device_challenges/i.test(entry.sql),
  );

  assert.ok(invalidationIndex >= 0, "previous challenges should be invalidated");
  assert.ok(insertIndex > invalidationIndex, "new challenge should be inserted after invalidation");
});

test("createChallenge rejects an expired pending login", async () => {
  setup({ attemptExpired: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_PENDING_LOGIN_INVALID");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
  assert.equal(
    transactionQueries.some((entry) => /INSERT INTO public\.admin_device_challenges/i.test(entry.sql)),
    false,
  );
});

test("createChallenge rejects an already-used pending login", async () => {
  setup({ attemptUsed: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_PENDING_LOGIN_INVALID");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
  assert.equal(
    transactionQueries.some((entry) => /INSERT INTO public\.admin_device_challenges/i.test(entry.sql)),
    false,
  );
});

test("createChallenge rejects an unauthorized device", async () => {
  setup({ deviceMissing: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ADMIN_DEVICE_NOT_AUTHORIZED");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
  assert.equal(
    transactionQueries.some((entry) => /INSERT INTO public\.admin_device_challenges/i.test(entry.sql)),
    false,
  );
});

test("createChallenge rolls back if inserting the new challenge fails", async () => {
  setup({ challengeInsertFails: true });
  const res = makeResponse();

  await controller.createChallenge(makeChallengeRequest(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
  assert.equal(Object.hasOwn(res.body, "challenge"), false);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
  assert.equal(signCalls.length, 0);
});
