"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(
  __dirname,
  "..",
  "services",
  "localDatabase.ts",
);

const source = fs.readFileSync(sourcePath, "utf8");
const ast = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
);

const declaration = ast.statements.find(
  node =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "readLocalDataOwnerIdStrict",
);

if (!declaration) {
  throw new Error("Production strict owner helper was not found.");
}

const compiled = ts.transpile(declaration.getText(ast), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None,
});

const LOCAL_USER_ID_KEY = "docuguard.localUserId";
const LAST_SIGNED_OUT_USER_ID_KEY =
  "docuguard.lastSignedOutUserId";

function createReader({ values = {}, failures = {} } = {}) {
  const calls = [];

  const SecureStore = {
    async getItemAsync(key) {
      calls.push(key);

      if (Object.prototype.hasOwnProperty.call(failures, key)) {
        throw failures[key];
      }

      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : null;
    },
  };

  const sandbox = {
    SecureStore,
    LOCAL_USER_ID_KEY,
    LAST_SIGNED_OUT_USER_ID_KEY,
  };

  const readOwner = vm.runInNewContext(
    `${compiled}\nreadLocalDataOwnerIdStrict;`,
    sandbox,
  );

  return { readOwner, calls };
}

test("strict owner reads the active account ID", async () => {
  const { readOwner, calls } = createReader({
    values: {
      [LOCAL_USER_ID_KEY]: "42",
      [LAST_SIGNED_OUT_USER_ID_KEY]: "17",
    },
  });

  assert.equal(await readOwner(), 42);
  assert.deepEqual(calls, [LOCAL_USER_ID_KEY]);
});

test("strict owner falls back to the signed-out account ID", async () => {
  const { readOwner, calls } = createReader({
    values: {
      [LAST_SIGNED_OUT_USER_ID_KEY]: "17",
    },
  });

  assert.equal(await readOwner(), 17);
  assert.deepEqual(calls, [
    LOCAL_USER_ID_KEY,
    LAST_SIGNED_OUT_USER_ID_KEY,
  ]);
});

test("strict owner returns null when both owner markers are absent", async () => {
  const { readOwner } = createReader();

  assert.equal(await readOwner(), null);
});

test("strict owner rejects malformed and non-positive IDs", async () => {
  for (const invalid of ["abc", "", "0", "-4", "Infinity", "NaN"]) {
    const { readOwner } = createReader({
      values: { [LOCAL_USER_ID_KEY]: invalid },
    });

    await assert.rejects(
      readOwner(),
      /locally stored account owner ID is invalid/,
      `Expected ${JSON.stringify(invalid)} to be rejected`,
    );
  }
});

test("strict owner propagates active-marker SecureStore failures", async () => {
  const failure = new Error("SecureStore unavailable");
  const { readOwner, calls } = createReader({
    failures: { [LOCAL_USER_ID_KEY]: failure },
    values: { [LAST_SIGNED_OUT_USER_ID_KEY]: "17" },
  });

  await assert.rejects(readOwner(), error => error === failure);
  assert.deepEqual(calls, [LOCAL_USER_ID_KEY]);
});

test("strict owner propagates signed-out-marker SecureStore failures", async () => {
  const failure = new Error("Signed-out marker unavailable");
  const { readOwner, calls } = createReader({
    failures: { [LAST_SIGNED_OUT_USER_ID_KEY]: failure },
  });

  await assert.rejects(readOwner(), error => error === failure);
  assert.deepEqual(calls, [
    LOCAL_USER_ID_KEY,
    LAST_SIGNED_OUT_USER_ID_KEY,
  ]);
});
const productionNames = [
  "readLocalDataOwnerIdStrict",
  "runLocalOwnershipOperation",
  "setLocalUserId",
  "switchLocalUserUnlocked",
  "switchLocalUser",
  "clearLocalSessionUnlocked",
  "clearLocalSession",
  "clearLocalSessionIfOwner",
];

const productionDeclarations = productionNames.map(name => {
  const node = ast.statements.find(
    item =>
      ts.isFunctionDeclaration(item) &&
      item.name?.text === name
  );

  if (!node) {
    throw new Error(`Production function not found: ${name}`);
  }

  return node.getText(ast);
});

const productionHarness = ts.transpile(
  [
    'const LOCAL_USER_ID_KEY = "docuguard.localUserId";',
    'const LAST_SIGNED_OUT_USER_ID_KEY = "docuguard.lastSignedOutUserId";',
    "let localOwnershipQueue = Promise.resolve();",
    ...productionDeclarations,
    "module.exports = { switchLocalUser, clearLocalSession, clearLocalSessionIfOwner };",
  ].join("\n\n"),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
);

function createOwnershipHarness({ values = {}, failures = {} } = {}) {
  const calls = [];
  const purges = [];
  const claims = [];
  const retryCalls = [];

  const SecureStore = {
    async getItemAsync(key) {
      calls.push(["get", key]);

      if (Object.prototype.hasOwnProperty.call(failures, key)) {
        throw failures[key];
      }

      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : null;
    },

    async setItemAsync(key, value) {
      calls.push(["set", key, value]);
    },

    async deleteItemAsync(key) {
      calls.push(["delete", key]);
    },
  };

  const sandbox = {
    SecureStore,
    resolveAccountSwitch:
      require("../shared/sync/accountSwitch.js").resolveAccountSwitch,
    module: { exports: {} },
    exports: {},
    require: name => {
      if (name.includes("accountSwitch")) {
        return require("../shared/sync/accountSwitch.js");
      }
      throw new Error(`Unexpected production harness import: ${name}`);
    },
    DebugLogger: {
      warn() {},
      info() {},
    },
    syncRetryStore: {
      async clearAll() {
        retryCalls.push("clearAll");
      },
      async clearBlockedBy(value) {
        retryCalls.push(["clearBlockedBy", value]);
      },
    },
    SYNC_FAILURE_KIND: { AUTH: "auth" },
    async purgeLocalDataForUser(id) {
      purges.push(id);
    },
    async claimUnownedRows(id) {
      claims.push(id);
    },
  };

  vm.runInNewContext(productionHarness, sandbox);

  return {
    ...sandbox.module.exports,
    calls,
    purges,
    claims,
    retryCalls,
  };
}

test("account switch stops completely when active owner read fails", async () => {
  const failure = new Error("Active owner read failed");
  const harness = createOwnershipHarness({
    values: {
      [LAST_SIGNED_OUT_USER_ID_KEY]: "17",
    },
    failures: {
      [LOCAL_USER_ID_KEY]: failure,
    },
  });

  await assert.rejects(
    harness.switchLocalUser(22),
    error => error === failure,
  );

  assert.deepEqual(harness.purges, []);
  assert.deepEqual(harness.claims, []);
  assert.deepEqual(harness.retryCalls, []);
  assert.deepEqual(
    harness.calls.filter(([operation]) => operation !== "get"),
    [],
  );
});

test("sign-out preserves session markers when active owner read fails", async () => {
  const failure = new Error("Active owner read failed");
  const harness = createOwnershipHarness({
    values: {
      [LOCAL_USER_ID_KEY]: "17",
      [LAST_SIGNED_OUT_USER_ID_KEY]: "9",
    },
    failures: {
      [LOCAL_USER_ID_KEY]: failure,
    },
  });

  await assert.rejects(
    harness.clearLocalSession(),
    error => error === failure,
  );

  assert.deepEqual(
    harness.calls.filter(([operation]) => operation !== "get"),
    [],
  );
});

test("conditional sign-out does not clear session when signed-out owner read fails", async () => {
  const failure = new Error("Signed-out owner read failed");
  const harness = createOwnershipHarness({
    failures: {
      [LAST_SIGNED_OUT_USER_ID_KEY]: failure,
    },
  });

  await assert.rejects(
    harness.clearLocalSessionIfOwner(17),
    error => error === failure,
  );

  assert.deepEqual(
    harness.calls.filter(([operation]) => operation !== "get"),
    [],
  );
});

test("switching to a different account purges the previous owner's data", async () => {
  const harness = createOwnershipHarness({
    values: {
      [LOCAL_USER_ID_KEY]: "17",
    },
  });

  await harness.switchLocalUser(22);

  assert.deepEqual(harness.purges, [17]);
  assert.deepEqual(harness.claims, [22]);
  assert.deepEqual(harness.retryCalls, ["clearAll"]);
  assert.deepEqual(harness.calls.filter(([op]) => op !== "get"), [
    ["delete", LAST_SIGNED_OUT_USER_ID_KEY],
    ["set", LOCAL_USER_ID_KEY, "22"],
  ]);
});

test("switching to the same account preserves its data and retry history", async () => {
  const harness = createOwnershipHarness({
    values: {
      [LOCAL_USER_ID_KEY]: "17",
    },
  });

  await harness.switchLocalUser(17);

  assert.deepEqual(harness.purges, []);
  assert.deepEqual(harness.claims, [17]);
  assert.equal(harness.retryCalls.length, 1);
  assert.equal(harness.retryCalls[0][0], "clearBlockedBy");
  assert.equal(harness.retryCalls[0][1].kind, "auth");
  assert.deepEqual(harness.calls.filter(([op]) => op !== "get"), [
    ["delete", LAST_SIGNED_OUT_USER_ID_KEY],
    ["set", LOCAL_USER_ID_KEY, "17"],
  ]);
});
