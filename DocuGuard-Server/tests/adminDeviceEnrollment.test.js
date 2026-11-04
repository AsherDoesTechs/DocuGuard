"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");

const controllerPath = path.resolve(
  __dirname,
  "../controllers/adminDeviceEnrollmentController.js",
);

let transactionImpl;
let transactionQueries = [];
let commitCount = 0;
let rollbackCount = 0;
let options = {};

const dbStub = {
  withTransaction: async (callback) => transactionImpl(callback),
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const parentFile = parent?.filename ? path.resolve(parent.filename) : "";

  if (parentFile === controllerPath && request === "../config/db") {
    return dbStub;
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

const enrollmentToken = "E".repeat(43);

function setup(overrides = {}) {
  options = overrides;
  transactionQueries = [];
  commitCount = 0;
  rollbackCount = 0;

  const keyPair = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const publicKeyPem = keyPair.publicKey.export({
    type: "spki",
    format: "pem",
  });

  const grant = {
    enrollment_token_id: 12,
    user_id: 42,
    role: "admin",
    admin_id: "LOCAL-ADMIN-001",
    is_verified: true,
    ...options.grantOverrides,
  };

  const client = {
    query: async (sql, params = []) => {
      transactionQueries.push({ sql, params: [...params] });

      if (/SELECT t\.id AS enrollment_token_id/i.test(sql)) {
        return {
          rows: options.grantInvalid ? [] : [grant],
          rowCount: options.grantInvalid ? 0 : 1,
        };
      }

      if (/UPDATE public\.admin_device_enrollment_tokens/i.test(sql)) {
        return {
          rows: options.consumeFails ? [] : [{ id: 12 }],
          rowCount: options.consumeFails ? 0 : 1,
        };
      }

      if (/INSERT INTO public\.admin_devices/i.test(sql)) {
        if (options.insertFails) {
          throw new Error("Simulated device insert failure");
        }

        return {
          rows: [{ id: 77 }],
          rowCount: 1,
        };
      }

      throw new Error("Unexpected database query: " + sql);
    },
  };

  transactionImpl = async (callback) => {
    try {
      const result = await callback(client);

      if (options.commitFails) {
        throw new Error("Simulated transaction commit failure");
      }

      commitCount += 1;
      return result;
    } catch (error) {
      rollbackCount += 1;
      throw error;
    }
  };

  return { keyPair, publicKeyPem };
}

function makeRequest(overrides = {}) {
  return {
    body: {
      enrollmentToken,
      publicKeyPem: setupFixture.publicKeyPem,
      deviceLabel: "Defense laptop",
      ...overrides,
    },
  };
}

let setupFixture;

test.beforeEach(() => {
  setupFixture = setup();
});

test("valid P-256 key enrolls a device and returns its identifier", async () => {
  const res = makeResponse();

  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.enrolled, true);
  assert.equal(res.body.deviceId, "77");
  assert.equal(res.body.keyAlgorithm, "ECDSA_P256_SHA256");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);

  const lookup = transactionQueries.find((entry) =>
    /SELECT t\.id AS enrollment_token_id/i.test(entry.sql),
  );
  assert.ok(lookup);
  assert.match(lookup.sql, /t\.used_at IS NULL/i);
  assert.match(lookup.sql, /t\.expires_at > NOW\(\)/i);
  assert.deepEqual(lookup.params, [
    crypto.createHash("sha256").update(enrollmentToken).digest("hex"),
  ]);

  const insert = transactionQueries.find((entry) =>
    /INSERT INTO public\.admin_devices/i.test(entry.sql),
  );
  assert.ok(insert);
  assert.equal(insert.params[0], 42);
  assert.equal(insert.params[1], "Defense laptop");
  assert.equal(insert.params[2], setupFixture.publicKeyPem);
  assert.equal(insert.params.includes(enrollmentToken), false);
});

test("malformed public key is rejected before database access", async () => {
  const res = makeResponse();

  await controller.enrollDevice(
    makeRequest({ publicKeyPem: "not-a-public-key" }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_DEVICE_KEY_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("RSA public key is rejected even though it is a valid public key", async () => {
  const rsaPair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const rsaPem = rsaPair.publicKey.export({
    type: "spki",
    format: "pem",
  });

  const res = makeResponse();

  await controller.enrollDevice(makeRequest({ publicKeyPem: rsaPem }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_DEVICE_KEY_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("invalid enrollment grant is rejected without creating a device", async () => {
  setupFixture = setup({ grantInvalid: true });
  const res = makeResponse();

  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_devices/i.test(entry.sql),
    ),
    false,
  );
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("grant consumption failure prevents device creation", async () => {
  setupFixture = setup({ consumeFails: true });
  const res = makeResponse();

  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_devices/i.test(entry.sql),
    ),
    false,
  );
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("device insert failure rolls back grant consumption", async () => {
  setupFixture = setup({ insertFails: true });
  const res = makeResponse();

  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_UNAVAILABLE");
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
});

test("invalid enrollment token is rejected before database access", async () => {
  const res = makeResponse();

  await controller.enrollDevice(makeRequest({ enrollmentToken: "short" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("invalid device label is rejected before database access", async () => {
  const res = makeResponse();

  await controller.enrollDevice(makeRequest({ deviceLabel: "   " }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_DEVICE_LABEL_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("non-admin grant is rejected without creating a device", async () => {
  setupFixture = setup({
    grantOverrides: {
      role: "user",
      admin_id: null,
    },
  });

  const res = makeResponse();
  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_devices/i.test(entry.sql),
    ),
    false,
  );
});

test("unverified administrator grant is rejected", async () => {
  setupFixture = setup({
    grantOverrides: {
      is_verified: false,
    },
  });

  const res = makeResponse();
  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_devices/i.test(entry.sql),
    ),
    false,
  );
});

test("administrator grant with blank admin ID is rejected", async () => {
  setupFixture = setup({
    grantOverrides: {
      admin_id: "   ",
    },
  });

  const res = makeResponse();
  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(
    transactionQueries.some((entry) =>
      /INSERT INTO public\.admin_devices/i.test(entry.sql),
    ),
    false,
  );
});

test("P-384 public key is rejected because enrollment requires P-256", async () => {
  const p384Pair = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp384r1",
  });

  const p384Pem = p384Pair.publicKey.export({
    type: "spki",
    format: "pem",
  });

  const res = makeResponse();

  await controller.enrollDevice(makeRequest({ publicKeyPem: p384Pem }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_DEVICE_KEY_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("enrollment token with invalid characters is rejected before database access", async () => {
  const res = makeResponse();

  await controller.enrollDevice(
    makeRequest({ enrollmentToken: "!".repeat(43) }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("device label longer than 80 characters is rejected before database access", async () => {
  const res = makeResponse();

  await controller.enrollDevice(
    makeRequest({ deviceLabel: "A".repeat(81) }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ADMIN_DEVICE_LABEL_INVALID");
  assert.equal(transactionQueries.length, 0);
});

test("transaction commit failure returns unavailable and does not report enrollment success", async () => {
  setupFixture = setup({ commitFails: true });

  const res = makeResponse();

  await controller.enrollDevice(makeRequest(), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ADMIN_ENROLLMENT_UNAVAILABLE");
  assert.notEqual(res.body.enrolled, true);
  assert.equal(commitCount, 0);
  assert.equal(rollbackCount, 1);
});
