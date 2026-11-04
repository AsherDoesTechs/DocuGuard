"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

let userQueryImpl;
let transactionImpl;
let recoveryVerifier;
let signedPayload;
let signCalls;
let sessionCalls;
let transactionCalls;
let consumedRows;

const dbStub = {
  query: async (...args) => userQueryImpl(...args),
  withTransaction: async (callback) => {
    transactionCalls += 1;
    return transactionImpl(callback);
  },
};

const bcryptStub = {
  compare: async (password, hash) =>
    password === "TestPassword123!" && hash === "test-hash",
};

const jwtStub = {
  sign: (payload) => {
    signCalls += 1;
    signedPayload = payload;
    return "mock-recovery-login-token";
  },
  decode: (token) => {
    if (token !== "mock-recovery-login-token") return null;

    return {
      userId: signedPayload?.userId,
      role: signedPayload?.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    };
  },
};

const validationStub = {
  registerSchema: {},
  loginSchema: {},
  verifyEmailSchema: {},
  resendVerificationSchema: {},
  forgotPasswordSchema: {},
  resetPasswordSchema: {},
  checkEmailSchema: {},
  updateFcmTokenSchema: {},
  validateSchema: (_schema, data) => ({
    success: true,
    data: {
      email: data.email,
      password: data.password,
    },
  }),
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const filename = (parent?.filename || "").replaceAll("/", "\\");

  if (filename.endsWith("controllers\\authController.js")) {
    if (request === "../config/db") return dbStub;

    if (request === "../services/sessionService") {
      return {
        createSession: async () => {
          sessionCalls += 1;
          return { id: 1 };
        },
        revokeSession: async () => true,
      };
    }

    if (request === "bcryptjs") return bcryptStub;
    if (request === "jsonwebtoken") return jwtStub;

    if (request === "../utils/totp") {
      return { verifyTOTP: () => true };
    }

    if (request === "../utils/twoFactorRecovery") {
      return {
        verifyRecoveryCode: (...args) => recoveryVerifier(...args),
      };
    }

    if (request === "../../shared/validation/schemas") {
      return validationStub;
    }

    if (request === "../config/email") {
      return {
        sendVerificationEmail: async () => {},
        sendPasswordResetEmail: async () => {},
        APP_DEEPLINK_SCHEME: "docuguard",
        buildVerificationLink: () => "",
        buildPasswordResetLink: () => "",
        escapeHtml: (value) => value,
      };
    }
  }

  return originalLoad.apply(this, arguments);
};

let authController;

try {
  const controllerPath = require.resolve("../controllers/authController");
  delete require.cache[controllerPath];
  authController = require("../controllers/authController");
} finally {
  Module._load = originalLoad;
}

function reset() {
  userQueryImpl = async (sql) => {
    assert.match(sql, /SELECT \* FROM public\.users/i);
    return { rows: [makeUser()] };
  };

  transactionImpl = async (callback) =>
    callback({
      query: async (sql) => {
        if (/SELECT id, code_hash/i.test(sql)) {
          return {
            rows: [{ id: 91, code_hash: "stored-recovery-hash" }],
          };
        }

        if (/UPDATE public\.user_two_factor_recovery_codes/i.test(sql)) {
          consumedRows += 1;
          return { rowCount: 1 };
        }

        throw new Error(`Unexpected transaction query: ${sql}`);
      },
    });

  recoveryVerifier = async (code, hashes) => {
    assert.equal(code, "AABBCCDDEEFF00112233445566778899");
    assert.deepEqual(hashes, ["stored-recovery-hash"]);
    return 0;
  };

  signedPayload = undefined;
  signCalls = 0;
  sessionCalls = 0;
  transactionCalls = 0;
  consumedRows = 0;
}

function makeUser(overrides = {}) {
  return {
    id: 42,
    email: "user@example.com",
    name: "Test User",
    password_hash: "test-hash",
    is_verified: true,
    role: "user",
    two_factor: true,
    two_factor_secret: "TESTTOTPSECRET",
    two_factor_enabled_at: new Date(),
    ...overrides,
  };
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

function makeRequest(body = {}) {
  return {
    body: {
      email: "user@example.com",
      password: "TestPassword123!",
      ...body,
    },
    headers: {
      "user-agent": "DocuGuard-Recovery-Test",
      "x-platform": "test",
    },
    ip: "127.0.0.1",
  };
}

async function invoke(handler, req) {
  const res = makeResponse();
  let nextError;

  await handler(req, res, (error) => {
    nextError = error;
  });

  return { res, nextError };
}

test("valid recovery code is consumed before token and session issuance", async () => {
  reset();

  const { res, nextError } = await invoke(
    authController.login,
    makeRequest({
      recoveryCode: "AABBCCDDEEFF00112233445566778899",
    }),
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, "mock-recovery-login-token");
  assert.equal(signedPayload.userId, 42);
  assert.equal(signedPayload.role, "user");
  assert.equal(transactionCalls, 1);
  assert.equal(consumedRows, 1);
  assert.equal(signCalls, 1);
  assert.equal(sessionCalls, 1);
});

test("invalid or already-used recovery code is rejected without issuing a token", async () => {
  reset();

  transactionImpl = async (callback) =>
    callback({
      query: async (sql) => {
        assert.match(sql, /SELECT id, code_hash/i);
        return { rows: [] };
      },
    });

  recoveryVerifier = async (_code, hashes) => {
    assert.deepEqual(hashes, []);
    return -1;
  };

  const { res, nextError } = await invoke(
    authController.login,
    makeRequest({
      recoveryCode: "AABBCCDDEEFF00112233445566778899",
    }),
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /invalid verification code/i);
  assert.equal(signCalls, 0);
  assert.equal(sessionCalls, 0);
  assert.equal(consumedRows, 0);
});

test("recovery-code transaction failure prevents token and session issuance", async () => {
  reset();

  transactionImpl = async () => {
    throw new Error("Simulated recovery transaction failure");
  };

  const { res, nextError } = await invoke(
    authController.login,
    makeRequest({
      recoveryCode: "AABBCCDDEEFF00112233445566778899",
    }),
  );

  assert.ok(nextError instanceof Error);
  assert.equal(signCalls, 0);
  assert.equal(sessionCalls, 0);
  assert.equal(transactionCalls, 1);
});

test("login rejects simultaneous TOTP and recovery codes", async () => {
  reset();

  const { res, nextError } = await invoke(
    authController.login,
    makeRequest({
      totpCode: "123456",
      recoveryCode: "AABBCCDDEEFF00112233445566778899",
    }),
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /either an authenticator code or a recovery code/i);
  assert.equal(transactionCalls, 0);
  assert.equal(signCalls, 0);
  assert.equal(sessionCalls, 0);
});

test("administrator login cannot authenticate with a recovery code", async () => {
  reset();

  const { res, nextError } = await invoke(
    authController.adminLogin,
    makeRequest({
      recoveryCode: "AABBCCDDEEFF00112233445566778899",
    }),
  );

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /invalid verification code/i);
  assert.equal(transactionCalls, 0);
  assert.equal(signCalls, 0);
  assert.equal(sessionCalls, 0);
});
