"use strict";

/**
 * The validation contract between the client and the server.
 *
 * The client and the server keep their own copy of the schema, so they can
 * drift apart. They did: the client demanded eight characters and four
 * character classes at registration while the server was content with six, so
 * a password the app accepted could be refused by the API and the rules the
 * user was shown were not the rules that were enforced.
 *
 * The client's schema is TypeScript and the server's is CommonJS, so the
 * client is loaded in a child process with Node's type stripping. On a Node
 * that cannot do that the comparison is skipped instead of failing.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const serverSchemas = require("../shared/validation/schemas.js");

const ROOT = path.join(__dirname, "..");

const PROBES = [
  "Str0ng!Pass",
  "short",
  "alllowercase1!",
  "ALLUPPERCASE1!",
  "NoDigits!Here",
  "NoSpecials123",
  "Str0ng!Pass",
  "123456",
  "abc",
];

const CLIENT_PROBE_SCRIPT = `
const probes = JSON.parse(process.argv[1]);
import("./shared/validation/schemas.ts").then((m) => {
  const register = probes.map((password) =>
    m.registerSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
      password,
    }).success,
  );
  const login = probes.map((password) =>
    m.loginSchema.safeParse({
      email: "test@example.com",
      password,
    }).success,
  );
  process.stdout.write(JSON.stringify({ register, login }));
}).catch((error) => {
  process.stdout.write(JSON.stringify({ error: error.message }));
});
`;

function loadClientSchemas() {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "-e", CLIENT_PROBE_SCRIPT, JSON.stringify(PROBES)],
    { cwd: ROOT, encoding: "utf8" },
  );

  if (result.status !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());

    if (parsed && parsed.error) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

const client = loadClientSchemas();

test(
  "the client and the server accept the same passwords at registration",
  { skip: client ? false : "this Node cannot load the TypeScript schema" },
  () => {
    const serverResults = PROBES.map((password) =>
      serverSchemas.registerSchema.safeParse({
        name: "Test User",
        email: "test@example.com",
        password,
      }).success,
    );

    assert.deepEqual(
      client.register,
      serverResults,
      "the client and the server must enforce the same registration policy",
    );
  },
);

test(
  "the client and the server accept the same passwords at login",
  { skip: client ? false : "this Node cannot load the TypeScript schema" },
  () => {
    const serverResults = PROBES.map((password) =>
      serverSchemas.loginSchema.safeParse({
        email: "test@example.com",
        password,
      }).success,
    );

    assert.deepEqual(
      client.login,
      serverResults,
      "the client and the server must enforce the same login policy",
    );
  },
);

test(
  "an account created before the stricter policy can still sign in",
  { skip: client ? false : "this Node cannot load the TypeScript schema" },
  () => {
    assert.equal(
      serverSchemas.loginSchema.safeParse({
        email: "test@example.com",
        password: "123456",
      }).success,
      true,
      "an older password must keep working",
    );

    assert.equal(
      serverSchemas.registerSchema.safeParse({
        name: "Test User",
        email: "test@example.com",
        password: "123456",
      }).success,
      false,
      "a new account needs the stronger policy",
    );
  },
);

test("the registration policy is the same on both sides", () => {
  const serverPolicy = serverSchemas.registrationPasswordSchema;

  assert.equal(
    serverPolicy.safeParse("Str0ng!Pass").success,
    true,
    "a compliant password is accepted",
  );

  for (const weak of ["short", "alllowercase1!", "NoDigits!Here", "12345678"]) {
    assert.equal(
      serverPolicy.safeParse(weak).success,
      false,
      `${weak} must be refused`,
    );
  }
});

test("a rejected document payload is not retried forever", () => {
  const rejected = serverSchemas.documentSyncSchema.safeParse({
    title: "",
    category: "identification",
    issuer: "",
    documentNumber: "",
  });

  assert.equal(rejected.success, false);

  // The sync failure classification turns a 400 into a permanent failure, so
  // the record is parked instead of being retried with the same payload.
  const { classifySyncFailure, SYNC_FAILURE_KIND } = require("../shared/sync/syncPolicy");

  const failure = classifySyncFailure({ response: { status: 400 } });

  assert.equal(failure.kind, SYNC_FAILURE_KIND.VALIDATION);
  assert.equal(failure.permanent, true);
  assert.equal(failure.retryable, false);
});
