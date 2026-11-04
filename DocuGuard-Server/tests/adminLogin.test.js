"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

let queryImpl;
let queryCalls;
let signedPayload;
let signCalls;

const dbStub = {
  query: async (...args) => {
    queryCalls += 1;
    return queryImpl(...args);
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
    return "mock-token";
  },
  decode: (token) => {
    if (token !== "mock-token") return null;

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
    data: { email: data.email, password: data.password },
  }),
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const filename = (parent?.filename || "").replaceAll("/", "\\");

  if (filename.endsWith("controllers\\authController.js")) {
    if (request === "../config/db") return dbStub;
    if (request === "../services/sessionService") {
      return {
        createSession: async () => ({ id: 1 }),
        revokeSession: async () => true,
      };
    }
    if (request === "bcryptjs") return bcryptStub;
    if (request === "jsonwebtoken") return jwtStub;
    if (request === "../utils/totp") {
      return { verifyTOTP: () => true };
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

function reset(implementation) {
  queryImpl = implementation;
  queryCalls = 0;
  signCalls = 0;
  signedPayload = undefined;
}

function makeUser(overrides = {}) {
  return {
    id: 42,
    email: "admin@example.com",
    name: "Test User",
    password_hash: "test-hash",
    is_verified: true,
    role: "user",
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
      email: "admin@example.com",
      password: "TestPassword123!",
      ...body,
    },
    headers: {
      "user-agent": "DocuGuard-Test",
      "x-platform": "test",
    },
    ip: "127.0.0.1",
  };
}

test("admin login issues a token only after database role verification", async () => {
  reset(async (sql) => {
    if (/SELECT \* FROM public\.users/i.test(sql)) {
      return { rows: [makeUser()] };
    }

    if (/SELECT role FROM public\.users/i.test(sql)) {
      return { rows: [{ role: "admin" }] };
    }

    throw new Error("Unexpected query");
  });

  const req = makeRequest();
  const res = makeResponse();

  await authController.adminLogin(req, res, (err) => {
    throw err || new Error("Unexpected next()");
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, "mock-token");
  assert.equal(signedPayload.role, "admin");
  assert.equal(signCalls, 1);
  assert.equal(queryCalls, 2);
});

test("admin login denies a regular user without issuing a token", async () => {
  reset(async (sql) => {
    if (/SELECT \* FROM public\.users/i.test(sql)) {
      return { rows: [makeUser({ role: "admin" })] };
    }

    if (/SELECT role FROM public\.users/i.test(sql)) {
      return { rows: [{ role: "user" }] };
    }

    throw new Error("Unexpected query");
  });

  const res = makeResponse();

  await authController.adminLogin(makeRequest(), res, (err) => {
    throw err || new Error("Unexpected next()");
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ADMIN_ACCESS_REQUIRED");
  assert.equal(signCalls, 0);
});

test("admin login fails closed if role verification fails", async () => {
  reset(async (sql) => {
    if (/SELECT \* FROM public\.users/i.test(sql)) {
      return { rows: [makeUser()] };
    }

    if (/SELECT role FROM public\.users/i.test(sql)) {
      throw new Error("simulated database failure");
    }

    throw new Error("Unexpected query");
  });

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const res = makeResponse();

    await authController.adminLogin(makeRequest(), res, (err) => {
      throw err || new Error("Unexpected next()");
    });

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "ADMIN_AUTH_UNAVAILABLE");
    assert.equal(signCalls, 0);
  } finally {
    console.error = originalConsoleError;
  }
});

test("ordinary mobile login still works without an admin role check", async () => {
  reset(async (sql) => {
    assert.match(sql, /SELECT \* FROM public\.users/i);
    return { rows: [makeUser({ role: undefined })] };
  });

  const res = makeResponse();

  await authController.login(makeRequest(), res, (err) => {
    throw err || new Error("Unexpected next()");
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, "mock-token");
  assert.equal(signedPayload.role, "user");
  assert.equal(queryCalls, 1);
  assert.equal(signCalls, 1);
});
