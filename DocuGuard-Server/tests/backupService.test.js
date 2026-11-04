"use strict";

/**
 * Unit tests for backup service (prerequisites + manifest).
 *
 * No real database, no pg_dump execution in production mode. Tests stub
 * child_process to simulate pg_dump availability/unavailability.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const originalExecSync = require("child_process").execSync;

function stubExecSync(shouldSucceed, errorMessage) {
  require("child_process").execSync = (cmd) => {
    if (cmd.includes("pg_dump --version")) {
      if (shouldSucceed) {
        return Buffer.from("pg_dump (PostgreSQL) 15.0");
      }
      throw new Error(errorMessage || "pg_dump not found");
    }
    return Buffer.from("");
  };
}

function restoreExecSync() {
  require("child_process").execSync = originalExecSync;
}

const originalDbUrl = process.env.DATABASE_URL;

function withDbUrl(url) {
  if (url === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = url;
  }
}

function restoreDbUrl() {
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
}

test("verifyPrerequisites returns available when pg_dump and DATABASE_URL exist", () => {
  stubExecSync(true);
  withDbUrl("postgresql://user:pass@localhost:5432/db");

  const { verifyPrerequisites } = require("../services/backupService");
  const result = verifyPrerequisites();

  assert.equal(result.available, true);
  assert.equal(result.details.pg_dump, true);
  assert.equal(result.details.databaseUrl, true);
  assert.equal(result.details.pg_dumpError, null);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("verifyPrerequisites returns unavailable when pg_dump is missing", () => {
  stubExecSync(false, "pg_dump: command not found");
  withDbUrl("postgresql://user:pass@localhost:5432/db");

  const { verifyPrerequisites } = require("../services/backupService");
  const result = verifyPrerequisites();

  assert.equal(result.available, false);
  assert.equal(result.details.pg_dump, false);
  assert.equal(result.details.databaseUrl, true);
  assert.ok(result.details.pg_dumpError);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("verifyPrerequisites returns unavailable when DATABASE_URL is missing", () => {
  stubExecSync(true);
  withDbUrl(undefined);

  const { verifyPrerequisites } = require("../services/backupService");
  const result = verifyPrerequisites();

  assert.equal(result.available, false);
  assert.equal(result.details.pg_dump, true);
  assert.equal(result.details.databaseUrl, false);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("generateManifest includes expected tables and retention", () => {
  stubExecSync(true);
  withDbUrl("postgresql://user:pass@localhost:5432/db");
  process.env.BACKUP_RETENTION_DAYS = "60";

  const { generateManifest } = require("../services/backupService");
  const manifest = generateManifest();

  assert.equal(manifest.retentionDays, 60);
  assert.ok(manifest.generatedAt);
  assert.ok(manifest.database.urlConfigured);
  assert.ok(Array.isArray(manifest.database.tables));
  assert.ok(manifest.database.tables.includes("audit_log"));
  assert.ok(manifest.database.tables.includes("documents"));
  assert.ok(manifest.database.tables.includes("users"));
  assert.ok(manifest.prerequisites.available);

  restoreExecSync();
  restoreDbUrl();
  delete process.env.BACKUP_RETENTION_DAYS;
  delete require.cache[require.resolve("../services/backupService")];
});

test("getBackupStatus returns 503 when prerequisites unavailable", async () => {
  stubExecSync(false, "pg_dump not found");
  withDbUrl(undefined);

  const { getBackupStatus } = require("../services/backupService");

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  getBackupStatus({}, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, 7004); // SYNC_BACKEND_UNAVAILABLE
  assert.ok(res.payload.manifest);
  assert.equal(res.payload.manifest.prerequisites.available, false);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("buildBackupCommand returns a pg_dump custom-format command", () => {
  stubExecSync(true);
  withDbUrl("postgresql://user:pass@localhost:5432/db");

  const { buildBackupCommand } = require("../services/backupService");
  const cmd = buildBackupCommand();

  assert.ok(cmd.command);
  assert.ok(cmd.outputFile);
  assert.match(cmd.command, /pg_dump/);
  assert.match(cmd.command, /--format=custom/);
  assert.match(cmd.command, /--no-owner/);
  assert.match(cmd.command, /--no-privileges/);
  assert.match(cmd.outputFile, /\.dump$/);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("buildBackupCommand throws when DATABASE_URL is missing", () => {
  stubExecSync(true);
  withDbUrl(undefined);

  const { buildBackupCommand } = require("../services/backupService");

  assert.throws(() => buildBackupCommand(), /DATABASE_URL is not configured/);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("buildSchemaCommand returns a schema-only pg_dump command", () => {
  stubExecSync(true);
  withDbUrl("postgresql://user:pass@localhost:5432/db");

  const { buildSchemaCommand } = require("../services/backupService");
  const cmd = buildSchemaCommand();

  assert.ok(cmd.command);
  assert.match(cmd.command, /pg_dump/);
  assert.match(cmd.command, /--schema-only/);
  assert.match(cmd.outputFile, /\.sql$/);

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});

test("getRestoreRunbook returns a structured runbook", () => {
  const { getRestoreRunbook } = require("../services/backupService");
  const runbook = getRestoreRunbook();

  assert.ok(runbook.title);
  assert.ok(Array.isArray(runbook.prerequisites));
  assert.ok(Array.isArray(runbook.steps));
  assert.ok(runbook.consistencyNote);
  assert.ok(runbook.prerequisites.length > 0);
  assert.ok(runbook.steps.length > 0);
  assert.ok(runbook.consistencyNote.includes("same point in time"));
});

test("manifest includes storage bucket information", () => {
  stubExecSync(true);
  withDbUrl("postgresql://user:pass@localhost:5432/db");

  const { generateManifest } = require("../services/backupService");
  const manifest = generateManifest();

  assert.ok(manifest.storage);
  assert.equal(manifest.storage.bucket, "documents");
  assert.equal(manifest.storage.provider, "supabase");

  restoreExecSync();
  restoreDbUrl();
  delete require.cache[require.resolve("../services/backupService")];
});
