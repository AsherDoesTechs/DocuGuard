const { execSync } = require("child_process");
const { warn, info } = require("../utils/debugLogger");
const { ErrorCodes } = require("../utils/errorCodes");

/**
 * Backup and recovery orchestration (ISO/IEC 27001 A.17).
 *
 * This module provides safe, non-destructive helpers for backup planning
 * and restore documentation. It does NOT execute pg_dump, pg_restore, or
 * any storage operation itself. Backup execution is an operational concern
 * run outside the application process (cron + pg_dump + offsite storage).
 *
 * Scope of a DocuGuard backup:
 *   - PostgreSQL data: all tables in `public` (users, documents, audit_log,
 *     data_retention, user_settings, login_sessions, password_resets,
 *     reminders, profiles, exports, support_tickets, transactions,
 *     device_tokens, subscriptions, activity_logs).
 *   - PostgreSQL schema: full schema dump (--schema-only) for rebuild.
 *   - Stored document objects: Supabase Storage bucket `documents` (private).
 *     File bytes are NOT in PostgreSQL; only `documents.s3_key` is. A
 *     complete backup must dump the database AND sync the storage bucket.
 *
 * Relationship between database records and storage objects:
 *   - `documents.s3_key` names the object in Supabase Storage.
 *   - A database restore without a storage restore leaves documents with
 *     dangling keys (signed URLs would 404).
 *   - A storage restore without a database restore leaves orphan objects
 *     (bytes with no document row pointing at them).
 *   - Both must be restored from backups taken at the same point in time
 *     to maintain consistency.
 */

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Check whether the prerequisites for a database backup are satisfied.
 *
 * Returns { available: boolean, details: { pg_dump, databaseUrl } }.
 * Never throws.
 */
function verifyPrerequisites() {
  let pg_dumpAvailable = false;
  let pg_dumpError = null;

  try {
    execSync("pg_dump --version", { stdio: "pipe" });
    pg_dumpAvailable = true;
  } catch (err) {
    pg_dumpError = err.message;
  }

  const databaseUrl = Boolean(process.env.DATABASE_URL);

  const available = pg_dumpAvailable && databaseUrl;

  if (!available) {
    warn("Backup", "Backup prerequisites not satisfied", {
      pg_dump: pg_dumpAvailable,
      pg_dumpError,
      databaseUrl,
    });
  } else {
    info("Backup", "Backup prerequisites satisfied");
  }

  return {
    available,
    details: {
      pg_dump: pg_dumpAvailable,
      pg_dumpError,
      databaseUrl,
    },
  };
}

/**
 * Generate a backup manifest for orchestration systems.
 *
 * Returns an object describing what would be backed up, the retention
 * policy, and the current prerequisites status.
 */
function generateManifest() {
  const prerequisites = verifyPrerequisites();

  return {
    generatedAt: new Date().toISOString(),
    database: {
      urlConfigured: prerequisites.details.databaseUrl,
      tables: [
        "users",
        "documents",
        "audit_log",
        "data_retention",
        "user_settings",
        "login_sessions",
        "password_resets",
        "reminders",
        "profiles",
        "exports",
        "support_tickets",
        "transactions",
        "device_tokens",
        "subscriptions",
        "activity_logs",
      ],
    },
    storage: {
      bucket: "documents",
      provider: "supabase",
      note: "File bytes are stored in Supabase Storage; s3_key in documents names them.",
    },
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) ||
      DEFAULT_RETENTION_DAYS,
    prerequisites,
  };
}

/**
 * Build a pg_dump command string for a full database backup.
 *
 * Returns the command as a string (not executed). The caller is responsible
 * for executing it in a controlled environment, redirecting output to a
 * secure, access-controlled location, and recording the SHA-256 of the
 * resulting dump.
 *
 * The command uses --format=custom (pg_dump -Fc) for a compressed, flexible
 * dump that supports selective restore with pg_restore.
 *
 * Security: the DATABASE_URL is embedded in the command. The caller must
 * ensure the process environment and command history do not leak it.
 */
function buildBackupCommand() {
  const { details } = verifyPrerequisites();
  if (!details.databaseUrl) {
    throw new Error(
      "Cannot build backup command: DATABASE_URL is not configured",
    );
  }

  const dumpFile = `docuguard-backup-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.dump`;

  return {
    command: `pg_dump --format=custom --no-owner --no-privileges --file="${dumpFile}" "${process.env.DATABASE_URL}"`,
    outputFile: dumpFile,
    note: "Execute in a trusted environment. Redirect stderr to a log. Record SHA-256 of the output file.",
  };
}

/**
 * Build a pg_dump command string for a schema-only backup.
 *
 * Returns the command as a string (not executed). Useful for rebuilding
 * the database structure without data.
 */
function buildSchemaCommand() {
  const { details } = verifyPrerequisites();
  if (!details.databaseUrl) {
    throw new Error(
      "Cannot build schema command: DATABASE_URL is not configured",
    );
  }

  const dumpFile = `docuguard-schema-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.sql`;

  return {
    command: `pg_dump --schema-only --no-owner --no-privileges --file="${dumpFile}" "${process.env.DATABASE_URL}"`,
    outputFile: dumpFile,
  };
}

/**
 * Document the restore procedure. Returns a human-readable runbook.
 *
 * Restoration is a two-part process:
 *   1. Restore PostgreSQL from the custom-format dump using pg_restore.
 *   2. Sync Supabase Storage bucket `documents` from a point-in-time
 *      consistent copy of the bucket.
 *
 * Both parts must use backups taken at the same time. Restoring only one
 * leaves the system inconsistent (dangling s3_keys or orphan objects).
 */
function getRestoreRunbook() {
  return {
    title: "DocuGuard Database and Storage Restore Runbook",
    prerequisites: [
      "A custom-format pg_dump dump file (produced by buildBackupCommand).",
      "A point-in-time consistent copy of the Supabase Storage bucket documents.",
      "A target PostgreSQL instance (can be the same or a scratch instance).",
      "pg_restore installed and available on PATH.",
    ],
    steps: [
      "1. Create the target database: createdb docuguard_restore (or use an existing one).",
      "2. Restore schema first if needed: pg_restore --schema-only --no-owner --no-privileges -d docuguard_restore <schema_dump.sql>.",
      "3. Restore data: pg_restore --no-owner --no-privileges -d docuguard_restore <backup.dump>.",
      "4. Verify row counts per table match the source backup manifest.",
      "5. Sync Supabase Storage bucket documents from the consistent bucket copy.",
      "6. Update the application's DATABASE_URL to point at the restored instance.",
      "7. Restart the application service.",
      "8. Run reconciliation: count documents per user, verify no NULL s3_key on documents with status='active'.",
    ],
    consistencyNote:
      "Database and storage backups must be from the same point in time. " +
      "Restoring a newer database with an older storage bucket (or vice versa) " +
      "leads to dangling references or orphan objects.",
  };
}

/**
 * Express handler for GET /api/backup/status.
 * Reports backup readiness without performing a backup.
 */
function getBackupStatus(req, res) {
  const manifest = generateManifest();

  if (!manifest.prerequisites.available) {
    return res.status(503).json({
      error: "Backup prerequisites not satisfied",
      code: ErrorCodes.SYNC_BACKEND_UNAVAILABLE,
      manifest,
    });
  }

  res.json({
    status: "ready",
    manifest,
  });
}

module.exports = {
  verifyPrerequisites,
  generateManifest,
  buildBackupCommand,
  buildSchemaCommand,
  getRestoreRunbook,
  getBackupStatus,
};
