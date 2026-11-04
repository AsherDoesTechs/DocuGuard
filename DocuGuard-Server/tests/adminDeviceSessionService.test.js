"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const servicePath = path.resolve(
  __dirname,
  "../services/adminDeviceSessionService.js",
);

function loadService(mockDb) {
  const originalLoad = Module._load;

  try {
    Module._load = function (request, parent, isMain) {
      if (request === "../config/db" && parent?.filename === servicePath) {
        return mockDb;
      }

      return originalLoad.apply(this, arguments);
    };

    delete require.cache[servicePath];
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
}

test("accepts an active device belonging to the administrator", async () => {
  let capturedParams;

  const service = loadService({
    query: async (sql, params) => {
      assert.match(sql, /public\.admin_devices/i);
      assert.match(sql, /revoked_at IS NULL/i);
      capturedParams = params;
      return { rows: [{ id: "7" }] };
    },
  });

  assert.equal(
    await service.isAdminDeviceActive({ userId: 42, deviceId: "7" }),
    true,
  );
  assert.deepEqual(capturedParams, ["7", 42]);
});

test("rejects a missing or invalid device ID without querying the database", async () => {
  let queryCount = 0;

  const service = loadService({
    query: async () => {
      queryCount += 1;
      return { rows: [] };
    },
  });

  assert.equal(
    await service.isAdminDeviceActive({ userId: 42, deviceId: null }),
    false,
  );
  assert.equal(
    await service.isAdminDeviceActive({ userId: 42, deviceId: "7 OR 1=1" }),
    false,
  );
  assert.equal(
    await service.isAdminDeviceActive({ userId: null, deviceId: "7" }),
    false,
  );
  assert.equal(queryCount, 0);
});

test("rejects devices that are missing or revoked", async () => {
  const service = loadService({
    query: async () => ({ rows: [] }),
  });

  assert.equal(
    await service.isAdminDeviceActive({ userId: 42, deviceId: "7" }),
    false,
  );
});

test("propagates database errors so middleware can fail closed", async () => {
  const service = loadService({
    query: async () => {
      throw new Error("database unavailable");
    },
  });

  await assert.rejects(
    service.isAdminDeviceActive({ userId: 42, deviceId: "7" }),
    /database unavailable/,
  );
});
