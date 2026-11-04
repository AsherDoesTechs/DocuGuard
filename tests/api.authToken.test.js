"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "services", "api.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const ast = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
);

const requiredFunctions = [
  "runAuthTokenOperation",
  "setAuthToken",
  "getStoredToken",
  "clearAuthTokenIfMatches",
  "replaceAuthTokenIfCurrent",
];

const declarations = [];

for (const name of requiredFunctions) {
  const declaration = ast.statements.find(
    node =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name,
  );

  if (!declaration) {
    throw new Error(`Production API function was not found: ${name}`);
  }

  declarations.push(declaration.getText(ast));
}

for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue;

  const names = statement.declarationList.declarations
    .filter(declaration => ts.isIdentifier(declaration.name))
    .map(declaration => declaration.name.text);

  if (
    names.includes("authToken") ||
    names.includes("authTokenLoaded") ||
    names.includes("authTokenQueue")
  ) {
    declarations.push(statement.getText(ast));
  }
}

const compiled = ts.transpile(
  declarations.join("\n\n"),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
);

function createHarness({
  initialToken = null,
  deleteFailure = null,
  readFailure = null,
} = {}) {
  const values = new Map();

  if (initialToken !== null) {
    values.set("userToken", initialToken);
  }

  const calls = [];
  let activeReadFailure = readFailure;

  const SecureStore = {
    async getItemAsync(key) {
      calls.push(["get", key]);

      if (activeReadFailure) throw activeReadFailure;

      return values.has(key) ? values.get(key) : null;
    },

    async setItemAsync(key, value) {
      calls.push(["set", key, value]);
      values.set(key, value);
    },

    async deleteItemAsync(key) {
      calls.push(["delete", key]);

      if (deleteFailure) throw deleteFailure;

      values.delete(key);
    },
  };

  const sandbox = {
    SecureStore,
    exports: {},
  };

  const api = vm.runInNewContext(
    `${compiled}
({
  setAuthToken,
  getStoredToken,
  clearAuthTokenIfMatches,
  replaceAuthTokenIfCurrent
});`,
    sandbox,
  );

  return {
    ...api,
    values,
    calls,
    setReadFailure(value) { activeReadFailure = value; },
  };
}

test("getStoredToken loads the persisted token on first access", async () => {
  const harness = createHarness({ initialToken: "token-A" });

  assert.equal(await harness.getStoredToken(), "token-A");
  assert.deepEqual(harness.calls, [["get", "userToken"]]);
});

test("setAuthToken(null) does not resurrect a token after deletion fails", async () => {
  const failure = new Error("SecureStore deletion failed");
  const harness = createHarness({
    initialToken: "token-A",
    deleteFailure: failure,
  });

  await assert.rejects(
    harness.setAuthToken(null),
    /SecureStore deletion failed/,
  );

  assert.equal(
    await harness.getStoredToken(),
    null,
    "an explicitly invalidated in-memory token must not be reloaded",
  );
});

test("clearAuthTokenIfMatches does not resurrect a token after deletion fails", async () => {
  const failure = new Error("SecureStore deletion failed");
  const harness = createHarness({
    initialToken: "token-A",
    deleteFailure: failure,
  });

  await assert.rejects(
    harness.clearAuthTokenIfMatches("token-A"),
    /SecureStore deletion failed/,
  );

  assert.equal(
    await harness.getStoredToken(),
    null,
    "a conditionally cleared token must remain invalidated in memory",
  );
});

test("replaceAuthTokenIfCurrent refuses to replace a different stored token", async () => {
  const harness = createHarness({ initialToken: "token-A" });

  assert.equal(
    await harness.replaceAuthTokenIfCurrent("token-B", "token-C"),
    false,
  );

  assert.equal(await harness.getStoredToken(), "token-A");
});

test("replaceAuthTokenIfCurrent replaces the matching token", async () => {
  const harness = createHarness({ initialToken: "token-A" });

  assert.equal(
    await harness.replaceAuthTokenIfCurrent("token-A", "token-B"),
    true,
  );

  assert.equal(await harness.getStoredToken(), "token-B");
});


test("getStoredToken does not cache a failed SecureStore read", async () => {
  const failure = new Error("SecureStore read failed");
  const harness = createHarness({
    initialToken: "token-A",
    readFailure: failure,
  });

  await assert.rejects(
    harness.getStoredToken(),
    /SecureStore read failed/,
  );

  harness.setReadFailure(null);

  assert.equal(await harness.getStoredToken(), "token-A");
  assert.deepEqual(harness.calls, [
    ["get", "userToken"],
    ["get", "userToken"],
  ]);
});

test("replaceAuthTokenIfCurrent rejects a stale token after explicit invalidation", async () => {
  const failure = new Error("SecureStore deletion failed");
  const harness = createHarness({
    initialToken: "token-A",
    deleteFailure: failure,
  });

  await assert.rejects(
    harness.setAuthToken(null),
    /SecureStore deletion failed/,
  );

  assert.equal(
    await harness.replaceAuthTokenIfCurrent("token-A", "token-B"),
    false,
  );

  assert.equal(await harness.getStoredToken(), null);
});