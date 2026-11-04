"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const bcrypt = require("bcryptjs");
const totp = require("../utils/totp");
const {
  generateRecoveryCodes,
  hashRecoveryCodes,
} = require("../utils/twoFactorRecovery");
const profileController = require("../controllers/profileController");

function makeResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function withOverrides(overrides, callback) {
  const originals = {};

  for (const [key, value] of Object.entries(overrides)) {
    originals[key] = key === "consoleError"
      ? console.error
      : key.split(".").reduce((object, part) => object[part], {
          db,
          bcrypt,
          totp,
        });
  }

  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === "consoleError") {
        console.error = value;
        continue;
      }

      const parts = key.split(".");
      const property = parts.pop();
      const target = parts.reduce((object, part) => {
        if (part === "db") return db;
        if (part === "bcrypt") return bcrypt;
        if (part === "totp") return totp;
        return object[part];
      }, null);

      target[property] = value;
    }

    await callback();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (key === "consoleError") {
        console.error = value;
        continue;
      }

      const parts = key.split(".");
      const property = parts.pop();
      const target = parts.reduce((object, part) => {
        if (part === "db") return db;
        if (part === "bcrypt") return bcrypt;
        if (part === "totp") return totp;
        return object[part];
      }, null);

      target[property] = value;
    }
  }
}

function makeTransactionClient(queryHandler) {
  return {
    query: async (sql, params) => queryHandler(sql, params),
  };
}

test("setup2FA refuses to overwrite an active or existing enrollment", async () => {
  let captured;

  await withOverrides({
    "db.query": async (sql, params) => {
      captured = { sql, params };
      return { rows: [], rowCount: 0 };
    },
  }, async () => {
    const res = makeResponse();

    await profileController.setup2FA(
      { user: { userId: 7 } },
      res,
    );

    assert.equal(res.statusCode, 409);
    assert.match(res.payload.error, /already enabled|cannot be started/i);
  });

  assert.equal(typeof captured.params[0], "string");
  assert.ok(captured.params[0].length >= 16);
  assert.equal(captured.params[1], 7);
  assert.match(captured.sql, /COALESCE\(two_factor,\s*FALSE\)\s*=\s*FALSE/i);
  assert.match(captured.sql, /two_factor_enabled_at\s+IS NULL/i);
});

test("verify2FA rejects an invalid TOTP without storing recovery codes or enabling 2FA", async () => {
  let queryCount = 0;

  await withOverrides({
    "totp.verifyTOTP": () => false,
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql) => {
        queryCount += 1;

        if (/SELECT two_factor/i.test(sql)) {
          return {
            rows: [{
              two_factor: false,
              two_factor_secret: "PENDINGSECRET",
              two_factor_enabled_at: null,
              pendingEnrollmentValid: true,
            }],
          };
        }

        throw new Error("Unexpected database write for invalid TOTP.");
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.verify2FA(
      { user: { userId: 7 }, body: { code: "123456" } },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /invalid verification code/i);
  });

  assert.equal(queryCount, 1);
});

test("verify2FA activates 2FA and returns ten recovery codes only after transaction success", async () => {
  const insertedHashes = [];
  const transactionQueries = [];

  await withOverrides({
    "totp.verifyTOTP": () => true,
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql, params) => {
        transactionQueries.push(sql);

        if (/SELECT two_factor/i.test(sql)) {
          return {
            rows: [{
              two_factor: false,
              two_factor_secret: "PENDINGSECRET",
              two_factor_enabled_at: null,
              pendingEnrollmentValid: true,
            }],
          };
        }

        if (/DELETE FROM public\.user_two_factor_recovery_codes/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }

        if (/INSERT INTO public\.user_two_factor_recovery_codes/i.test(sql)) {
          insertedHashes.push(params[1]);
          return { rowCount: 1, rows: [] };
        }

        if (/UPDATE users/i.test(sql)) {
          return { rowCount: 1, rows: [] };
        }

        throw new Error(`Unexpected transaction query: ${sql}`);
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.verify2FA(
      { user: { userId: 7 }, body: { code: "123456" } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.twoFactor, true);
    assert.equal(res.payload.recoveryCodes.length, 10);
    assert.equal(new Set(res.payload.recoveryCodes).size, 10);
  });

  assert.equal(insertedHashes.length, 10);
  assert.ok(insertedHashes.every((hash) => typeof hash === "string" && hash.length > 0));
  assert.ok(transactionQueries.some((sql) => /FOR UPDATE/i.test(sql)));
  assert.ok(transactionQueries.some((sql) => /two_factor_enabled_at\s*=\s*NOW\(\)/i.test(sql)));
  assert.ok(transactionQueries.some((sql) => /two_factor_setup_started_at\s*=\s*NULL/i.test(sql)));
});

test("verify2FA refuses to enroll an account that is already enabled", async () => {
  let writes = 0;

  await withOverrides({
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql) => {
        if (/SELECT two_factor/i.test(sql)) {
          return {
            rows: [{
              two_factor: true,
              two_factor_secret: "ACTIVESECRET",
              two_factor_enabled_at: new Date(),
            }],
          };
        }

        writes += 1;
        return { rowCount: 1, rows: [] };
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.verify2FA(
      { user: { userId: 7 }, body: { code: "123456" } },
      res,
    );

    assert.equal(res.statusCode, 409);
    assert.match(res.payload.error, /already enabled/i);
  });

  assert.equal(writes, 0);
});

test("verify2FA does not report success when the transaction fails", async () => {
  await withOverrides({
    "totp.verifyTOTP": () => true,
    "db.withTransaction": async () => {
      throw new Error("simulated transaction failure");
    },
    consoleError: () => {},
  }, async () => {
    const res = makeResponse();

    await profileController.verify2FA(
      { user: { userId: 7 }, body: { code: "123456" } },
      res,
    );

    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.twoFactor, undefined);
    assert.equal(res.payload.recoveryCodes, undefined);
  });
});

test("updateSecurity requires current password and a valid TOTP to disable 2FA", async () => {
  const queries = [];

  await withOverrides({
    "bcrypt.compare": async () => true,
    "totp.verifyTOTP": () => true,
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql, params) => {
        queries.push({ sql, params });

        if (/SELECT password_hash/i.test(sql)) {
          return {
            rows: [{
              password_hash: "stored-hash",
              two_factor: true,
              two_factor_secret: "ACTIVESECRET",
              two_factor_enabled_at: new Date(),
            }],
          };
        }

        if (/UPDATE users/i.test(sql)) {
          return { rowCount: 1, rows: [] };
        }

        if (/DELETE FROM public\.user_two_factor_recovery_codes/i.test(sql)) {
          return { rowCount: 10, rows: [] };
        }

        throw new Error(`Unexpected transaction query: ${sql}`);
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.updateSecurity(
      {
        user: { userId: 7 },
        body: {
          currentPassword: "correct-password",
          twoFactor: false,
          twoFactorCode: "123456",
        },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.twoFactor, false);
  });

  assert.ok(queries.some(({ sql }) => /FOR UPDATE/i.test(sql)));
  assert.ok(queries.some(({ sql }) => /two_factor_secret\s*=\s*NULL/i.test(sql)));
  assert.ok(queries.some(({ sql }) => /DELETE FROM public\.user_two_factor_recovery_codes/i.test(sql)));
});

test("updateSecurity rejects disabling 2FA without exactly one second-factor code", async () => {
  let transactionStarted = false;

  await withOverrides({
    "db.withTransaction": async () => {
      transactionStarted = true;
      throw new Error("Transaction should not start.");
    },
  }, async () => {
    const res = makeResponse();

    await profileController.updateSecurity(
      {
        user: { userId: 7 },
        body: {
          currentPassword: "correct-password",
          twoFactor: false,
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /exactly one/i);
  });

  assert.equal(transactionStarted, false);
});

test("updateSecurity rejects a wrong current password without changing 2FA", async () => {
  let writes = 0;

  await withOverrides({
    "bcrypt.compare": async () => false,
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql) => {
        if (/SELECT password_hash/i.test(sql)) {
          return {
            rows: [{
              password_hash: "stored-hash",
              two_factor: true,
              two_factor_secret: "ACTIVESECRET",
              two_factor_enabled_at: new Date(),
            }],
          };
        }

        writes += 1;
        return { rowCount: 1, rows: [] };
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.updateSecurity(
      {
        user: { userId: 7 },
        body: {
          currentPassword: "wrong-password",
          twoFactor: false,
          twoFactorCode: "123456",
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /incorrect current password/i);
  });

  assert.equal(writes, 0);
});

test("updateSecurity rejects a combined 2FA disable and password change", async () => {
  let transactionStarted = false;
  let queryCount = 0;

  await withOverrides({
    "db.withTransaction": async () => {
      transactionStarted = true;
      throw new Error("Transaction should not start.");
    },
    "db.query": async () => {
      queryCount += 1;
      return { rows: [] };
    },
  }, async () => {
    const res = makeResponse();

    await profileController.updateSecurity(
      {
        user: { userId: 7 },
        body: {
          currentPassword: "correct-password",
          newPassword: "new-password-123",
          twoFactor: false,
          twoFactorCode: "123456",
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /separate requests/i);
  });

  assert.equal(transactionStarted, false);
  assert.equal(queryCount, 0);
});

test("recovery-code generation and hashing produce distinct stored hashes", async () => {
  const codes = generateRecoveryCodes();
  const hashes = await hashRecoveryCodes(codes);

  assert.equal(codes.length, 10);
  assert.equal(hashes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.equal(new Set(hashes).size, 10);
  assert.ok(hashes.every((hash) => hash !== codes[0]));
});



test("updateSecurity accepts a valid recovery code to disable 2FA", async () => {
  const recoveryCode = "AABBCCDDEEFF00112233445566778899";
  const recoveryHashes = await hashRecoveryCodes([recoveryCode]);
  const queries = [];
  const originalCompare = bcrypt.compare.bind(bcrypt);

  await withOverrides({
    "bcrypt.compare": async (value, hash) => {
      if (value === "correct-password") return true;
      return originalCompare(value, hash);
    },
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql, params) => {
        queries.push({ sql, params });

        if (/SELECT password_hash/i.test(sql)) {
          return {
            rows: [{
              password_hash: "stored-hash",
              two_factor: true,
              two_factor_secret: "ACTIVESECRET",
              two_factor_enabled_at: new Date(),
            }],
          };
        }

        if (/SELECT id, code_hash/i.test(sql)) {
          return {
            rows: [{ id: 91, code_hash: recoveryHashes[0] }],
          };
        }

        if (/UPDATE users/i.test(sql)) {
          return { rowCount: 1, rows: [] };
        }

        if (/DELETE FROM public\.user_two_factor_recovery_codes/i.test(sql)) {
          return { rowCount: 10, rows: [] };
        }

        throw new Error(`Unexpected transaction query: ${sql}`);
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.updateSecurity(
      {
        user: { userId: 7 },
        body: {
          currentPassword: "correct-password",
          twoFactor: false,
          recoveryCode,
        },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.twoFactor, false);
    assert.match(res.payload.message, /disabled successfully/i);
  });

  assert.ok(queries.some(({ sql }) => /FOR UPDATE/i.test(sql)));
  assert.ok(queries.some(({ sql }) => /used_at IS NULL/i.test(sql)));
  assert.ok(queries.some(({ sql }) => /two_factor_secret\s*=\s*NULL/i.test(sql)));
  assert.ok(queries.some(({ sql }) => /DELETE FROM public\.user_two_factor_recovery_codes/i.test(sql)));
});

test("updateSecurity rejects an invalid or already-used recovery code without disabling 2FA", async () => {
  let mutationCount = 0;
  const originalCompare = bcrypt.compare.bind(bcrypt);

  await withOverrides({
    "bcrypt.compare": async (value, hash) => {
      if (value === "correct-password") return true;
      return originalCompare(value, hash);
    },
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql) => {
        if (/SELECT password_hash/i.test(sql)) {
          return {
            rows: [{
              password_hash: "stored-hash",
              two_factor: true,
              two_factor_secret: "ACTIVESECRET",
              two_factor_enabled_at: new Date(),
            }],
          };
        }

        if (/SELECT id, code_hash/i.test(sql)) {
          // Used recovery codes are excluded by the controller query.
          return { rows: [] };
        }

        mutationCount += 1;
        throw new Error(`Unexpected mutation for invalid recovery code: ${sql}`);
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.updateSecurity(
      {
        user: { userId: 7 },
        body: {
          currentPassword: "correct-password",
          twoFactor: false,
          recoveryCode: "AABBCCDDEEFF00112233445566778899",
        },
      },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /invalid recovery code/i);
  });

  assert.equal(mutationCount, 0);
});


test("verify2FA rejects an expired pending enrollment even with a valid TOTP", async () => {
  let writes = 0;
  let totpChecks = 0;

  await withOverrides({
    "totp.verifyTOTP": () => {
      totpChecks += 1;
      return true;
    },
    "db.withTransaction": async (callback) => {
      return callback(makeTransactionClient(async (sql) => {
        if (/SELECT two_factor/i.test(sql)) {
          return {
            rows: [{
              two_factor: false,
              two_factor_secret: "EXPIREDSECRET",
              two_factor_enabled_at: null,
              pendingEnrollmentValid: false,
            }],
          };
        }

        writes += 1;
        throw new Error("Expired enrollment must not write to the database.");
      }));
    },
  }, async () => {
    const res = makeResponse();

    await profileController.verify2FA(
      { user: { userId: 7 }, body: { code: "123456" } },
      res,
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /setup has expired/i);
  });

  assert.equal(totpChecks, 0);
  assert.equal(writes, 0);
});


test("setup2FA can restart a pending enrollment and reset its timestamp", async () => {
  let captured;

  await withOverrides({
    "db.query": async (sql, params) => {
      captured = { sql, params };
      return {
        rowCount: 1,
        rows: [{ email: "user@example.test" }],
      };
    },
  }, async () => {
    const res = makeResponse();

    await profileController.setup2FA(
      { user: { userId: 7 } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(typeof res.payload.secret, "string");
    assert.ok(res.payload.secret.length >= 16);
  });

  assert.match(captured.sql, /two_factor_setup_started_at\s*=\s*NOW\(\)/i);
  assert.match(captured.sql, /COALESCE\(two_factor,\s*FALSE\)\s*=\s*FALSE/i);
  assert.match(captured.sql, /two_factor_enabled_at\s+IS NULL/i);
  assert.equal(captured.params[1], 7);
});