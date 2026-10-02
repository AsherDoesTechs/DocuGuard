import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import {
  LocalDocument,
  LocalReminder,
  LocalUserProfile,
  DocumentDashboardSummary,
} from "../types/offline";
import { DebugLogger } from "./debugLogger";
import { ErrorCodes } from "../constants/errorCodes";

export type { LocalDocument, LocalReminder, LocalUserProfile, DocumentDashboardSummary };

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens the database once, with the pragmas Expo v57 requires to be set
 * explicitly.
 *
 * - `foreign_keys = ON` was never set, so the declared
 *   `ON DELETE CASCADE` on document_tags never fired and every deleted
 *   document leaked its tag rows.
 * - `journal_mode = WAL` allows readers and a writer to work concurrently,
 *   which matters because the dashboard runs several reads in parallel.
 *
 * The *promise* is memoized rather than the resolved handle: memoizing the
 * handle let two concurrent callers both see null and both open the file,
 * leaking one connection and interleaving the in-flight CREATE TABLE.
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await SQLite.openDatabaseAsync("docuguard.db");
      await database.execAsync("PRAGMA journal_mode = WAL;");
      await database.execAsync("PRAGMA foreign_keys = ON;");
      db = database;
      return database;
    })().catch((error) => {
      // Allow a later call to retry instead of caching the failure forever.
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

async function run(
  sql: string,
  params: any[] = [],
): Promise<SQLite.SQLiteRunResult> {
  const database = await getDb();
  return database.runAsync(sql, ...params);
}

async function queryAll<T>(sql: string, params: any[] = []): Promise<T[]> {
  const database = await getDb();
  return database.getAllAsync<T>(sql, ...params);
}

async function querySingle<T>(
  sql: string,
  params: any[] = [],
): Promise<T | null> {
  const database = await getDb();
  return database.getFirstAsync<T>(sql, ...params);
}

/**
 * reminder_intervals is stored as a JSON string but the LocalDocument contract
 * exposes number[]. Every read path must run rows through this helper or the
 * scheduler ends up iterating the characters of the raw JSON.
 */
function parseReminderIntervals(value: unknown): number[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
        );
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeDocumentRow<T>(row: T): T {
  const record = row as unknown as Record<string, unknown>;
  const intervals = parseReminderIntervals(record.reminderIntervals);
  if (intervals === undefined) {
    delete record.reminderIntervals;
  } else {
    record.reminderIntervals = intervals;
  }
  if (typeof record.enableAlerts === "number") {
    record.enableAlerts = record.enableAlerts !== 0;
  }
  if (typeof record.needsSync === "number") {
    record.needsSync = record.needsSync !== 0;
  }
  return row;
}

async function queryDocuments(sql: string, params: any[] = []): Promise<LocalDocument[]> {
  const rows = await queryAll<LocalDocument>(sql, params);
  return rows.map(normalizeDocumentRow);
}

/**
 * The canonical document projection.
 *
 * Every read path selects the same columns. Duplicating this list across a
 * dozen queries is how `user_id`, `tags`, or a new column silently goes missing
 * from one screen and not the others.
 */
const DOC_COLUMNS = `
  id,
  user_id AS "userId",
  title,
  category,
  issuer,
  document_number AS "documentNumber",
  issue_date AS "issueDate",
  expiry_date AS "expiryDate",
  notes,
  status,
  enable_alerts AS "enableAlerts",
  reminder_interval_days AS "reminderIntervalDays",
  reminder_intervals AS "reminderIntervals",
  file_url AS "fileUrl",
  file_type AS "fileType",
  s3_key AS "s3Key",
  processing_status AS "processingStatus",
  risk_score AS "riskScore",
  risk_level AS "riskLevel",
  needs_sync AS "needsSync",
  sync_status AS "syncStatus",
  cloud_id AS "cloudId",
  server_updated_at AS "serverUpdatedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/**
 * The local user id for the signed-in account, or null when signed out.
 *
 * The database used to have no notion of which account owned a row, so signing
 * out left the whole vault on disk for whoever signed in next. Every read is
 * now scoped through this, and sign-out purges.
 */
const LOCAL_USER_ID_KEY = "docuguard.localUserId";

export async function setLocalUserId(userId: number | string | null): Promise<void> {
  if (userId === null || userId === undefined) {
    await SecureStore.deleteItemAsync(LOCAL_USER_ID_KEY);
    return;
  }
  await SecureStore.setItemAsync(LOCAL_USER_ID_KEY, String(userId));
}

export async function getLocalUserId(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(LOCAL_USER_ID_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    /*
     * No stored id: this is the first launch after the upgrade that introduced
     * per-user scoping.
     *
     * Without this fallback every read returns nothing and the user's whole
     * vault appears to have been deleted. The signed-in user is recoverable
     * from the stored JWT payload, which already carries `userId`.
     *
     * This is read only to decide which LOCAL rows to display. It grants no
     * access: every server request is authorised independently by the API from
     * the same token, and an attacker who could edit this database could
     * already read it directly.
     */
    const recovered = await recoverUserIdFromToken();
    if (recovered !== null) {
      // Claim before persisting the id. If the claim fails and the id were
      // stored first, nothing would ever retry and the legacy rows would stay
      // invisible for the life of the install.
      await claimUnownedRows(recovered);
      await SecureStore.setItemAsync(LOCAL_USER_ID_KEY, String(recovered));
      DebugLogger.info(
        "LocalDatabase",
        "Recovered local user id from the stored token",
        { userId: recovered },
      );
      return recovered;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Assigns pre-existing, unowned rows to the signed-in user.
 *
 * Rows written before per-user scoping have `user_id IS NULL`. Without this
 * they satisfy no `user_id = ?` predicate and the user's documents would
 * silently vanish from the app after the upgrade.
 *
 * Safe because the legacy database was never scoped: every row on the device
 * belonged to the single account that had been using it. Claiming them for the
 * account recovered from the stored token restores that. A later sign-in by a
 * different account goes through `switchLocalUser`, which purges first.
 */
async function claimUnownedRows(userId: number): Promise<void> {
  try {
    const database = await getDb();

    const unowned = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM documents WHERE user_id IS NULL`,
    );

    if (!unowned?.count) {
      return;
    }

    await database.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(`UPDATE documents SET user_id = ? WHERE user_id IS NULL`, [
        userId,
      ]);
      await txn.runAsync(`UPDATE reminders SET user_id = ? WHERE user_id IS NULL`, [
        userId,
      ]);
      await txn.runAsync(
        `UPDATE login_sessions SET user_id = ? WHERE user_id IS NULL`,
        [userId],
      );
      await txn.runAsync(
        `UPDATE user_settings SET user_id = ? WHERE user_id IS NULL`,
        [userId],
      );

      /*
       * user_profile and user_settings were written against a hardcoded
       * id/user_id of 1, so they hold the cached name and email of whoever used
       * the device. Re-key them to the real account, otherwise the profile
       * screen shows empty and the stale row (including the email address) is
       * left on disk after sign-out.
       */
      if (userId !== 1) {
        const legacyProfile = await txn.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM user_profile WHERE id = 1`,
        );
        if (legacyProfile?.count) {
          await txn.runAsync(`DELETE FROM user_profile WHERE id = ?`, [userId]);
          await txn.runAsync(`UPDATE user_profile SET id = ? WHERE id = 1`, [
            userId,
          ]);
        }

        const legacySettings = await txn.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM user_settings WHERE user_id = 1`,
        );
        if (legacySettings?.count) {
          await txn.runAsync(`DELETE FROM user_settings WHERE user_id = ?`, [
            userId,
          ]);
          await txn.runAsync(`UPDATE user_settings SET user_id = ? WHERE user_id = 1`, [
            userId,
          ]);
        }
      }
    });

    DebugLogger.info(
      "LocalDatabase",
      "Claimed unowned local rows for the signed-in user",
      { userId, documents: unowned.count },
    );
  } catch (error) {
    // Failing to claim must not block reads entirely.
    DebugLogger.warn("LocalDatabase", "Failed to claim unowned local rows", {
      error,
    });
  }
}

/** Decodes the `userId` claim from the stored auth token, if present. */
async function recoverUserIdFromToken(): Promise<number | null> {
  try {
    const token = await SecureStore.getItemAsync("userToken");
    if (!token) {
      return null;
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );

    const userId = Number(payload?.userId);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

/**
 * Records which account owns the local data, purging the previous account's
 * rows when the identity actually changes.
 *
 * Called at login. If the same account signs in again (the common case) the
 * vault is left untouched; if a different account signs in, the previous
 * account's documents are removed before the new account can read anything.
 * Purging on login rather than sign-out covers the crash, token-expiry and
 * force-quit paths that never reach a sign-out handler.
 */
export async function switchLocalUser(nextUserId: number | string): Promise<void> {
  const next = Number(nextUserId);
  if (!Number.isFinite(next)) {
    DebugLogger.warn("LocalDatabase", "switchLocalUser ignored: invalid id", {
      nextUserId,
    });
    return;
  }

  const previous = await getLocalUserId();
  if (previous !== null && previous !== next) {
    DebugLogger.info("LocalDatabase", "Account changed, purging previous local data", {
      previous,
      next,
    });
    await purgeLocalDataForUser(previous);
  }

  await setLocalUserId(next);
}

/**
 * Clears all local state at sign-out. Safe to call when already signed out.
 */
export async function clearLocalSession(): Promise<void> {
  const userId = await getLocalUserId();
  await purgeLocalDataForUser(userId);
  await setLocalUserId(null);
}

/**
 * Reads that must never return rows belonging to another account.
 *
 * A null scope (signed out / not yet known) means "no user context", so these
 * return nothing rather than everything. Leaking the full vault is far worse
 * than briefly showing an empty list.
 */
function scopeClause(userId: number | null, column = "user_id"): {
  sql: string;
  params: number[];
} {
  if (userId === null) {
    return { sql: `1 = 0`, params: [] };
  }
  return { sql: `${column} = ?`, params: [userId] };
}

/**
 * Wipes every local row belonging to the signed-out account.
 *
 * `user_profile` and `user_settings` only ever held one account's data, so
 * they are dropped wholesale; `documents`/`reminders`/`login_sessions` are
 * cleared per user id so a concurrent second account is not affected.
 *
 * Called on sign-out, not on login. Deleting at login would be too late: the
 * new account could be shown the previous account's vault first.
 */
export async function purgeLocalDataForUser(userId: number | null): Promise<void> {
  const database = await getDb();

  await database.withExclusiveTransactionAsync(async (txn) => {
    if (userId !== null) {
      await txn.runAsync(`DELETE FROM document_tags WHERE document_id IN (SELECT id FROM documents WHERE user_id = ?)`, [userId]);
      await txn.runAsync(`DELETE FROM document_history WHERE document_id IN (SELECT id FROM documents WHERE user_id = ?)`, [userId]);
      await txn.runAsync(`DELETE FROM documents WHERE user_id = ?`, [userId]);
      await txn.runAsync(`DELETE FROM reminders WHERE user_id = ?`, [userId]);
      await txn.runAsync(`DELETE FROM login_sessions WHERE user_id = ?`, [userId]);
      await txn.runAsync(`DELETE FROM user_settings WHERE user_id = ?`, [userId]);
      await txn.runAsync(`DELETE FROM user_profile WHERE id = ?`, [userId]);
    } else {
      // No account context: clear everything rather than guessing.
      await txn.runAsync(`DELETE FROM document_tags`);
      await txn.runAsync(`DELETE FROM document_history`);
      await txn.runAsync(`DELETE FROM documents`);
      await txn.runAsync(`DELETE FROM reminders`);
      await txn.runAsync(`DELETE FROM login_sessions`);
      await txn.runAsync(`DELETE FROM user_settings`);
      await txn.runAsync(`DELETE FROM user_profile`);
    }
    await txn.runAsync(`DELETE FROM sync_queue`);
  });

  DebugLogger.info("LocalDatabase", "Local data purged for user", { userId });
}

export async function initDatabase() {
  try {
    const database = await getDb();

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'other',
        issuer TEXT,
        document_number TEXT,
        issue_date TEXT,
        expiry_date TEXT,
        notes TEXT,
        status TEXT DEFAULT 'active',
        enable_alerts BOOLEAN DEFAULT 1,
        reminder_interval_days INTEGER DEFAULT 7,
        reminder_intervals TEXT,
        file_url TEXT,
        file_type TEXT,
        s3_key TEXT,
        processing_status TEXT DEFAULT 'completed',
        -- NULL means no detector has assessed this document. A default of 0/'Low'
        -- would make "never checked" indistinguishable from "checked and safe".
        risk_score REAL,
        risk_level TEXT,
        needs_sync BOOLEAN DEFAULT 0,
        sync_status TEXT DEFAULT 'pending',
        cloud_id INTEGER,
        server_updated_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Migration: add columns that might be missing from older schemas
    const tableInfo = await database.getAllAsync<{ name: string }>(
      `PRAGMA table_info(documents)`,
    );
    const existingColumns = new Set(tableInfo.map((col) => col.name));

    if (!existingColumns.has("reminder_interval_days")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN reminder_interval_days INTEGER DEFAULT 7`,
      );
    }
    if (!existingColumns.has("reminder_intervals")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN reminder_intervals TEXT`,
      );
    }
    if (!existingColumns.has("sync_status")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN sync_status TEXT DEFAULT 'pending'`,
      );
    }
    if (!existingColumns.has("cloud_id")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN cloud_id INTEGER`,
      );
    }
    // The server revision this device last synced against. Required for
    // conflict-aware sync: without it every push was a blind overwrite.
    if (!existingColumns.has("server_updated_at")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN server_updated_at TEXT`,
      );
    }
    // Without user_id the local vault was not scoped to an account at all:
    // signing out left every document behind for the next person to sign in.
    if (!existingColumns.has("user_id")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN user_id INTEGER`,
      );
    }
    if (!existingColumns.has("risk_score")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN risk_score REAL`,
      );
    }
    if (!existingColumns.has("risk_level")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN risk_level TEXT`,
      );
    }
    // Clear the fabricated "Low"/0 defaults on rows that were never assessed.
    await database.execAsync(
      `UPDATE documents SET risk_score = NULL, risk_level = NULL
       WHERE risk_score = 0 AND risk_level = 'Low'`,
    );
    if (!existingColumns.has("s3_key")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN s3_key TEXT`,
      );
    }
    if (!existingColumns.has("file_type")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN file_type TEXT`,
      );
    }
    if (!existingColumns.has("processing_status")) {
      await database.execAsync(
        `ALTER TABLE documents ADD COLUMN processing_status TEXT DEFAULT 'completed'`,
      );
    }

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        severity TEXT DEFAULT 'Valid',
        is_read BOOLEAN DEFAULT 0,
        needs_sync BOOLEAN DEFAULT 0,
        cloud_id INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    const reminderColumns = new Set(
      (
        await database.getAllAsync<{ name: string }>(
          `PRAGMA table_info(reminders)`,
        )
      ).map((col) => col.name),
    );

    if (!reminderColumns.has("user_id")) {
      await database.execAsync(
        `ALTER TABLE reminders ADD COLUMN user_id INTEGER`,
      );
    }
    // cloud_id is what makes reminder sync idempotent; without it every sync
    // inserted a fresh server row and the server copy multiplied.
    if (!reminderColumns.has("cloud_id")) {
      await database.execAsync(
        `ALTER TABLE reminders ADD COLUMN cloud_id INTEGER`,
      );
    }

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT DEFAULT 'User',
        email TEXT,
        document_count INTEGER DEFAULT 0,
        expiring_count INTEGER DEFAULT 0,
        expired_count INTEGER DEFAULT 0,
        notifications_enabled BOOLEAN DEFAULT 1,
        notify_email BOOLEAN DEFAULT 1,
        notify_expiry BOOLEAN DEFAULT 1,
        two_factor BOOLEAN DEFAULT 0
      )
    `);

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id INTEGER,
        operation TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // User settings table for document preferences, appearance, and privacy
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 1,
        default_category TEXT DEFAULT 'other',
        auto_backup BOOLEAN DEFAULT 1,
        reminder_before_days INTEGER DEFAULT 7,
        reminder_30days BOOLEAN DEFAULT 1,
        reminder_7days BOOLEAN DEFAULT 1,
        reminder_1day BOOLEAN DEFAULT 1,
        reminder_on_day BOOLEAN DEFAULT 1,
        theme_mode TEXT DEFAULT 'system',
        font_size TEXT DEFAULT 'medium',
        biometric_lock BOOLEAN DEFAULT 0,
        data_exported_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Active login sessions table
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS login_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 1,
        device_name TEXT,
        platform TEXT,
        ip_address TEXT,
        location TEXT,
        is_current BOOLEAN DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        last_active TEXT DEFAULT (datetime('now'))
      )
    `);

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS document_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER,
        action TEXT NOT NULL,
        title TEXT,
        category TEXT,
        issuer TEXT,
        document_number TEXT,
        issue_date TEXT,
        expiry_date TEXT,
        notes TEXT,
        status TEXT,
        file_url TEXT,
        file_type TEXT,
        s3_key TEXT,
        processing_status TEXT,
        risk_score REAL,
        risk_level TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Document tags table
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS document_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
      )
    `);

    // Collapse tag rows that predate the unique index, otherwise the index
    // build below fails on existing installs.
    await database.execAsync(`
      DELETE FROM document_tags
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM document_tags GROUP BY document_id, tag
      );
    `);

    // One row per (document, tag). Without this, `INSERT OR IGNORE` in
    // addDocumentTags had no constraint to ignore, so duplicate tags were
    // written and rendered as repeated chips.
    await database.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_document_tags_unique
      ON document_tags(document_id, tag);
    `);

    // Tags orphaned before PRAGMA foreign_keys was enabled.
    await database.execAsync(`
      DELETE FROM document_tags
      WHERE document_id NOT IN (SELECT id FROM documents);
    `);

    // Indexes for the predicates the app actually filters and orders on.
    // Every dashboard mount runs the expiry and needs_sync queries; without
    // these they were full table scans.
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_document_tags_document_id ON document_tags(document_id);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_documents_expiry ON documents(expiry_date);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_documents_needs_sync ON documents(needs_sync);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_documents_cloud_id ON documents(cloud_id);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_reminders_needs_sync ON reminders(needs_sync);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_history_doc_id ON document_history(document_id, created_at DESC);
    `);

    // user_settings is a per-user singleton; the UNIQUE constraint is what
    // makes the read-then-branch-then-write in saveUserSettings safe.
    await database.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
    `).catch(async () => {
      // Existing installs can hold duplicates from the old race; collapse them.
      await database.execAsync(`
        DELETE FROM user_settings
        WHERE rowid NOT IN (SELECT MIN(rowid) FROM user_settings GROUP BY user_id);
      `);
      await database.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
      `);
    });

    DebugLogger.info("LocalDatabase", "Database initialized successfully");
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to initialize database",
      { error: err },
      ErrorCodes.LOCAL_DB_INIT,
    );
    throw err;
  }
}

// Document operations
export async function createDocument(
  doc: Partial<LocalDocument>,
): Promise<number> {
  try {
    const database = await getDb();
    const userId = await getLocalUserId();
    const now = new Date().toISOString();

    // The row and its tags must commit together. Previously the INSERT
    // committed first, so a tag failure surfaced "Save failed" to the user
    // while the document actually existed - retrying created a duplicate.
    let docId = 0;
    await database.withExclusiveTransactionAsync(async (txn) => {
      const result = await txn.runAsync(
        `
        INSERT INTO documents
          (user_id, title, category, issuer, document_number, issue_date, expiry_date, notes,
           status, enable_alerts, reminder_interval_days, reminder_intervals, file_url,
           file_type, s3_key, processing_status, risk_score, risk_level, needs_sync,
           sync_status, cloud_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        userId,
        doc.title ?? "",
        doc.category || "other",
        doc.issuer || "",
        doc.documentNumber || "",
        doc.issueDate ?? null,
        doc.expiryDate ?? null,
        doc.notes || "",
        doc.status || "active",
        doc.enableAlerts ? 1 : 0,
        doc.reminderIntervalDays || 7,
        doc.reminderIntervals && doc.reminderIntervals.length > 0
          ? JSON.stringify(normalizeReminderIntervals(doc.reminderIntervals))
          : null,
        doc.fileUrl || null,
        doc.fileType || null,
        doc.s3Key || null,
        doc.processingStatus || "completed",
        // Left null: nothing has assessed this document's authenticity.
        doc.riskScore ?? null,
        doc.riskLevel ?? null,
        doc.needsSync === false ? 0 : 1,
        doc.syncStatus || "pending",
        doc.cloudId ?? null,
        now,
        now,
      );

      docId = result.lastInsertRowId as number;

      if (doc.tags && doc.tags.length > 0) {
        const tags = normalizeTagList(doc.tags);
        for (const tag of tags) {
          await txn.runAsync(
            `INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)`,
            [docId, tag],
          );
        }
      }
    });

    DebugLogger.debug("LocalDatabase", "Document created", { docId });
    return docId;
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to create document",
      { error: err },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

/** Trims, lowercases and de-duplicates tags so the unique index holds. */
function normalizeTagList(tags: string[]): string[] {
  const cleaned = tags
    .map((tag) => String(tag ?? "").trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return Array.from(new Set(cleaned));
}

/** Sorts, de-duplicates and drops non-positive reminder offsets. */
function normalizeReminderIntervals(values: number[]): number[] {
  const cleaned = values
    .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
  return Array.from(new Set(cleaned)).sort((a, b) => a - b);
}

export async function getAllDocuments(): Promise<LocalDocument[]> {
  try {
    const userId = await getLocalUserId();

    // Soft-deleted rows are tombstones awaiting sync; they must never be
    // rendered, counted, or exported. `getAllDocuments` previously had no
    // WHERE clause at all, so they stayed visible with full PII.
    const rows = await queryDocuments(
      `
      SELECT d.id, d.user_id AS "userId", d.title, d.category, d.issuer,
             d.document_number AS "documentNumber",
             d.issue_date AS "issueDate", d.expiry_date AS "expiryDate", d.notes, d.status,
             d.enable_alerts AS "enableAlerts", d.reminder_interval_days AS "reminderIntervalDays",
             d.reminder_intervals AS "reminderIntervals", d.file_url AS "fileUrl",
             d.file_type AS "fileType", d.s3_key AS "s3Key", d.processing_status AS "processingStatus",
             d.risk_score AS "riskScore", d.risk_level AS "riskLevel",
             d.needs_sync AS "needsSync", d.sync_status AS "syncStatus", d.cloud_id AS "cloudId",
             d.created_at AS "createdAt", d.updated_at AS "updatedAt"
      FROM documents d
      WHERE d.status IS NOT 'deleted'
        AND ${userId === null ? "1 = 0" : "d.user_id = ?"}
      ORDER BY d.expiry_date IS NULL, d.expiry_date ASC, d.id DESC
    `,
      userId === null ? [] : [userId],
    );

    // One query for all tags instead of an awaited lookup per document.
    // The old loop made N+1 sequential native-bridge round trips on every
    // mount of the Documents tab and the dashboard.
    if (rows.length > 0) {
      const ids = rows.map((doc) => doc.id as number);
      const placeholders = ids.map(() => "?").join(",");
      const tagRows = await queryAll<{ document_id: number; tag: string }>(
        `SELECT document_id, tag FROM document_tags
         WHERE document_id IN (${placeholders}) ORDER BY tag`,
        ids,
      );

      const byDocument = new Map<number, string[]>();
      for (const row of tagRows) {
        const list = byDocument.get(row.document_id) ?? [];
        list.push(row.tag);
        byDocument.set(row.document_id, list);
      }

      for (const doc of rows) {
        if (doc.id) {
          doc.tags = byDocument.get(doc.id) ?? [];
        }
      }
    }

    DebugLogger.debug("LocalDatabase", "Documents loaded", {
      count: rows.length,
    });
    return rows;
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to load documents",
      { error: err },
      ErrorCodes.LOCAL_DB_QUERY,
    );
    throw err;
  }
}

export async function getDocumentById(
  id: number,
): Promise<LocalDocument | null> {
  try {
    const userId = await getLocalUserId();

    // Scoped *and* excluding tombstones. Reading a deleted document by id used
    // to still return the full row, so a stale deep link could surface a
    // document the user had already removed.
    const row = await querySingle<LocalDocument>(
      `SELECT ${DOC_COLUMNS}
       FROM documents
       WHERE id = ? AND status IS NOT 'deleted'
         AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
      userId === null ? [id] : [id, userId],
    );
    if (row) {
      normalizeDocumentRow(row);
      row.tags = await getDocumentTags(id);
    }
    DebugLogger.debug("LocalDatabase", "Document fetched", {
      docId: id,
      found: !!row,
    });
    return row;
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to fetch document",
      { error: err, docId: id },
      ErrorCodes.LOCAL_DB_QUERY,
    );
    throw err;
  }
}

/** Maps the camelCase LocalDocument surface onto documents columns. */
const UPDATE_COLUMN_MAP: Record<string, string> = {
  title: "title",
  category: "category",
  issuer: "issuer",
  documentNumber: "document_number",
  issueDate: "issue_date",
  expiryDate: "expiry_date",
  notes: "notes",
  status: "status",
  enableAlerts: "enable_alerts",
  reminderIntervalDays: "reminder_interval_days",
  fileUrl: "file_url",
  fileType: "file_type",
  s3Key: "s3_key",
  processingStatus: "processing_status",
  riskScore: "risk_score",
  riskLevel: "risk_level",
  syncStatus: "sync_status",
  cloudId: "cloud_id",
};

export async function updateDocument(id: number, doc: Partial<LocalDocument>) {
  try {
    const database = await getDb();
    const userId = await getLocalUserId();

    const assignments: string[] = [];
    const values: any[] = [];

    for (const [key, column] of Object.entries(UPDATE_COLUMN_MAP)) {
      if (!(key in doc)) continue;
      const value = (doc as Record<string, unknown>)[key];
      assignments.push(`${column} = ?`);
      if (typeof value === "boolean") {
        values.push(value ? 1 : 0);
      } else {
        values.push(value ?? null);
      }
    }

    // reminder_intervals is JSON, not a scalar, so it is handled separately.
    // It must be written when present *and* when null: the previous
    // COALESCE(?, reminder_intervals) could never clear the reminder list, so
    // removing all reminders in the UI silently kept the old ones.
    if ("reminderIntervals" in doc) {
      assignments.push(`reminder_intervals = ?`);
      values.push(
        doc.reminderIntervals && doc.reminderIntervals.length > 0
          ? JSON.stringify(normalizeReminderIntervals(doc.reminderIntervals))
          : null,
      );
    }

    // Any edit re-queues the row for sync and stamps the change.
    assignments.push(`needs_sync = 1`);
    assignments.push(`sync_status = 'pending'`);
    // ISO-8601 to match createDocument. datetime('now') produced
    // "YYYY-MM-DD HH:MM:SS", so string-comparing updated_at against a server
    // timestamp decided the wrong winner during sync.
    assignments.push(`updated_at = ?`);
    values.push(new Date().toISOString());

    values.push(id);
    if (userId !== null) {
      values.push(userId);
    }

    await database.withExclusiveTransactionAsync(async (txn) => {
      const where =
        userId === null ? `id = ? AND 1 = 0` : `id = ? AND user_id = ?`;

      await txn.runAsync(
        `UPDATE documents SET ${assignments.join(", ")} WHERE ${where}`,
        values,
      );

      if (doc.tags !== undefined) {
        await txn.runAsync(`DELETE FROM document_tags WHERE document_id = ?`, [id]);
        for (const tag of normalizeTagList(doc.tags ?? [])) {
          await txn.runAsync(
            `INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)`,
            [id, tag],
          );
        }
      }
    });

    DebugLogger.debug("LocalDatabase", "Document updated", { docId: id });
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to update document",
      { error: err, docId: id },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

export async function deleteDocument(id: number) {
  try {
    const userId = await getLocalUserId();
    const database = await getDb();

    // The document row and its queued sync entry must go together; deleting
    // only the document left sync_queue pointing at a row that no longer
    // existed, which the sync worker then retried forever.
    await database.withExclusiveTransactionAsync(async (txn) => {
      const where = userId === null ? `id = ? AND 1 = 0` : `id = ? AND user_id = ?`;
      const values = userId === null ? [id] : [id, userId];

      await txn.runAsync(`DELETE FROM document_tags WHERE document_id = ?`, [id]);
      await txn.runAsync(`DELETE FROM documents WHERE ${where}`, values);
      await txn.runAsync(
        `DELETE FROM sync_queue WHERE table_name = 'documents' AND record_id = ?`,
        [id],
      );
    });

    DebugLogger.debug("LocalDatabase", "Document deleted", { docId: id });
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to delete document",
      { error: err, docId: id },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

export async function setDocumentProcessingStatus(
  id: number,
  status: string,
  riskScore?: number,
  riskLevel?: string,
) {
  const userId = await getLocalUserId();
  await run(
    `
    UPDATE documents
    SET processing_status = ?,
        risk_score = COALESCE(?, risk_score),
        risk_level = COALESCE(?, risk_level),
        updated_at = ?
    WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}
  `,
    userId === null
      ? [status, riskScore ?? null, riskLevel ?? null, new Date().toISOString(), id]
      : [
          status,
          riskScore ?? null,
          riskLevel ?? null,
          new Date().toISOString(),
          id,
          userId,
        ],
  );
}

// Document Tags operations
export async function addDocumentTags(documentId: number, tags: string[]) {
  const normalized = normalizeTagList(tags);
  if (!normalized.length) return;
  try {
    const database = await getDb();
    await database.withExclusiveTransactionAsync(async (txn) => {
      for (const tag of normalized) {
        await txn.runAsync(
          `INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)`,
          [documentId, tag],
        );
      }
    });
    DebugLogger.debug("LocalDatabase", "Tags added", { documentId, tags: normalized });
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to add document tags",
      { error: err, documentId },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

export async function removeDocumentTag(documentId: number, tag: string) {
  try {
    await run(`DELETE FROM document_tags WHERE document_id = ? AND tag = ?`, [
      documentId,
      tag.trim().toLowerCase(),
    ]);
    DebugLogger.debug("LocalDatabase", "Tag removed", { documentId, tag });
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to remove document tag",
      { error: err, documentId },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

export async function getDocumentTags(documentId: number): Promise<string[]> {
  try {
    const rows = await queryAll<{ tag: string }>(
      `SELECT tag FROM document_tags WHERE document_id = ? ORDER BY tag`,
      [documentId],
    );
    return rows.map((r) => r.tag);
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to get document tags",
      { error: err, documentId },
      ErrorCodes.LOCAL_DB_QUERY,
    );
    return [];
  }
}

export async function getAllTags(): Promise<string[]> {
  try {
    const userId = await getLocalUserId();
    // Tags reachable from a deleted document leaked its name into the global
    // tag list even though the document itself was hidden.
    const rows = await queryAll<{ tag: string }>(
      `SELECT DISTINCT t.tag
       FROM document_tags t
       JOIN documents d ON d.id = t.document_id
       WHERE d.status IS NOT 'deleted'
         AND ${userId === null ? "1 = 0" : "d.user_id = ?"}
       ORDER BY t.tag`,
      userId === null ? [] : [userId],
    );
    return rows.map((r) => r.tag);
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to get all tags",
      { error: err },
      ErrorCodes.LOCAL_DB_QUERY,
    );
    return [];
  }
}

export async function getDocumentsByTag(tag: string): Promise<number[]> {
  try {
    const userId = await getLocalUserId();
    const rows = await queryAll<{ document_id: number }>(
      `SELECT t.document_id
       FROM document_tags t
       JOIN documents d ON d.id = t.document_id
       WHERE t.tag = ?
         AND d.status IS NOT 'deleted'
         AND ${userId === null ? "1 = 0" : "d.user_id = ?"}`,
      userId === null ? [tag.trim().toLowerCase()] : [tag.trim().toLowerCase(), userId],
    );
    return rows.map((r) => r.document_id);
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to get documents by tag",
      { error: err, tag },
      ErrorCodes.LOCAL_DB_QUERY,
    );
    return [];
  }
}

export async function replaceDocumentTags(documentId: number, tags: string[]) {
  const normalized = normalizeTagList(tags);
  try {
    const database = await getDb();
    // Delete+insert is one unit: a failure between the two previously left the
    // document with either every old tag or none.
    await database.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(`DELETE FROM document_tags WHERE document_id = ?`, [
        documentId,
      ]);
      for (const tag of normalized) {
        await txn.runAsync(
          `INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)`,
          [documentId, tag],
        );
      }
    });
    DebugLogger.debug("LocalDatabase", "Tags replaced", { documentId, tags: normalized });
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to replace document tags",
      { error: err, documentId },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

// Reminder operations
export async function getAllReminders(): Promise<LocalReminder[]> {
  const userId = await getLocalUserId();
  return queryAll<LocalReminder>(
    `
    SELECT id, user_id AS "userId", title, description, due_date AS "dueDate",
           severity, is_read AS "read", needs_sync AS "needsSync",
           cloud_id AS "cloudId", created_at AS "createdAt"
    FROM reminders
    WHERE ${userId === null ? "1 = 0" : "user_id = ?"}
    ORDER BY due_date IS NULL, due_date ASC
  `,
    userId === null ? [] : [userId],
  );
}

export async function updateReminderStatus(id: number, isRead: boolean) {
  const userId = await getLocalUserId();
  await run(
    `UPDATE reminders SET is_read = ? WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [isRead ? 1 : 0, id] : [isRead ? 1 : 0, id, userId],
  );
}

// Profile operations
export async function saveUserProfile(profile: LocalUserProfile) {
  const userId = await getLocalUserId();
  if (userId === null) {
    // Previously this wrote a fixed id=1 row, so two accounts on one device
    // overwrote each other's cached profile.
    DebugLogger.warn("LocalDatabase", "saveUserProfile skipped: signed out");
    return;
  }
  await run(
    `
    INSERT OR REPLACE INTO user_profile
      (id, name, email, document_count, expiring_count, expired_count,
       notifications_enabled, notify_email, notify_expiry, two_factor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      userId,
      profile.name,
      profile.email,
      profile.documentCount,
      profile.expiringCount,
      profile.expiredCount,
      profile.notificationsEnabled ? 1 : 0,
      profile.notifyEmail ? 1 : 0,
      profile.notifyExpiry ? 1 : 0,
      profile.twoFactor ? 1 : 0,
    ],
  );
}

export async function getUserProfile(): Promise<LocalUserProfile | null> {
  const userId = await getLocalUserId();
  if (userId === null) return null;

  const row = await querySingle<LocalUserProfile>(
    `SELECT id, name, email, document_count AS "documentCount",
            expiring_count AS "expiringCount", expired_count AS "expiredCount",
            notifications_enabled AS "notificationsEnabled",
            notify_email AS "notifyEmail", notify_expiry AS "notifyExpiry",
            two_factor AS "twoFactor"
     FROM user_profile WHERE id = ?`,
    [userId],
  );
  return row;
}

// User settings operations
export interface LocalUserSettings {
  id?: number;
  userId?: number;
  defaultCategory?: string;
  autoBackup?: boolean;
  reminderBeforeDays?: number;
  reminder30days?: boolean;
  reminder7days?: boolean;
  reminder1day?: boolean;
  reminderOnDay?: boolean;
  themeMode?: string;
  fontSize?: string;
  biometricLock?: boolean;
  dataExportedAt?: string;
}

export async function getUserSettings(): Promise<LocalUserSettings | null> {
  const userId = await getLocalUserId();
  if (userId === null) return null;

  const row = await querySingle<LocalUserSettings>(
    `SELECT id, user_id AS "userId", default_category AS "defaultCategory",
            auto_backup AS "autoBackup", reminder_before_days AS "reminderBeforeDays",
            reminder_30days AS "reminder30days", reminder_7days AS "reminder7days",
            reminder_1day AS "reminder1day", reminder_on_day AS "reminderOnDay",
            theme_mode AS "themeMode", font_size AS "fontSize",
            biometric_lock AS "biometricLock", data_exported_at AS "dataExportedAt"
     FROM user_settings WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return row;
}

export async function saveUserSettings(
  settings: Partial<LocalUserSettings>,
): Promise<number> {
  const userId = await getLocalUserId();
  if (userId === null) {
    DebugLogger.warn("LocalDatabase", "saveUserSettings skipped: signed out");
    return 0;
  }

  const existing = await getUserSettings();
  if (existing) {
    await run(
      `
      UPDATE user_settings SET
        default_category = COALESCE(?, default_category),
        auto_backup = COALESCE(?, auto_backup),
        reminder_before_days = COALESCE(?, reminder_before_days),
        reminder_30days = COALESCE(?, reminder_30days),
        reminder_7days = COALESCE(?, reminder_7days),
        reminder_1day = COALESCE(?, reminder_1day),
        reminder_on_day = COALESCE(?, reminder_on_day),
        theme_mode = COALESCE(?, theme_mode),
        font_size = COALESCE(?, font_size),
        biometric_lock = COALESCE(?, biometric_lock),
        data_exported_at = COALESCE(?, data_exported_at),
        updated_at = ?
      WHERE user_id = ?
    `,
      [
        settings.defaultCategory,
        settings.autoBackup !== undefined
          ? settings.autoBackup
            ? 1
            : 0
          : null,
        settings.reminderBeforeDays,
        settings.reminder30days !== undefined
          ? settings.reminder30days
            ? 1
            : 0
          : null,
        settings.reminder7days !== undefined
          ? settings.reminder7days
            ? 1
            : 0
          : null,
        settings.reminder1day !== undefined
          ? settings.reminder1day
            ? 1
            : 0
          : null,
        settings.reminderOnDay !== undefined
          ? settings.reminderOnDay
            ? 1
            : 0
          : null,
        settings.themeMode,
        settings.fontSize,
        settings.biometricLock !== undefined
          ? settings.biometricLock
            ? 1
            : 0
          : null,
        settings.dataExportedAt,
        new Date().toISOString(),
        userId,
      ],
    );
    return existing.id || 1;
  }
  const result = await run(
    `
    INSERT INTO user_settings
      (user_id, default_category, auto_backup, reminder_before_days,
       reminder_30days, reminder_7days, reminder_1day, reminder_on_day,
       theme_mode, font_size, biometric_lock, data_exported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      userId,
      settings.defaultCategory || "other",
      settings.autoBackup !== undefined ? (settings.autoBackup ? 1 : 0) : 1,
      settings.reminderBeforeDays || 7,
      settings.reminder30days !== undefined
        ? settings.reminder30days
          ? 1
          : 0
        : 1,
      settings.reminder7days !== undefined
        ? settings.reminder7days
          ? 1
          : 0
        : 1,
      settings.reminder1day !== undefined ? (settings.reminder1day ? 1 : 0) : 1,
      settings.reminderOnDay !== undefined
        ? settings.reminderOnDay
          ? 1
          : 0
        : 1,
      settings.themeMode || "system",
      settings.fontSize || "medium",
      settings.biometricLock !== undefined
        ? settings.biometricLock
          ? 1
          : 0
        : 0,
      settings.dataExportedAt || null,
    ],
  );
  return result.lastInsertRowId as number;
}

// Login sessions operations
export interface LocalLoginSession {
  id?: number;
  userId?: number;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  location?: string;
  isCurrent?: boolean;
  createdAt?: string;
  lastActive?: string;
}

export async function getLoginSessions(): Promise<LocalLoginSession[]> {
  const userId = await getLocalUserId();
  return queryAll<LocalLoginSession>(
    `
    SELECT id, user_id AS "userId", device_name AS "deviceName",
            platform, ip_address AS "ipAddress", location,
            is_current AS "isCurrent", created_at AS "createdAt",
            last_active AS "lastActive"
    FROM login_sessions
    WHERE ${userId === null ? "1 = 0" : "user_id = ?"}
    ORDER BY is_current DESC, last_active DESC
  `,
    userId === null ? [] : [userId],
  );
}

export async function addLoginSession(
  session: Partial<LocalLoginSession>,
): Promise<number> {
  const userId = await getLocalUserId();
  if (userId === null) {
    DebugLogger.warn("LocalDatabase", "addLoginSession skipped: signed out");
    return 0;
  }

  // The table has no unique constraint on user_id, and this inserted a fresh
  // 'current' row on every call, so the Sessions list grew on every screen
  // mount. One current session per user, reused.
  const database = await getDb();
  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE login_sessions SET is_current = 0 WHERE user_id = ?`,
      [userId],
    );
    await txn.runAsync(
      `
      INSERT INTO login_sessions
        (user_id, device_name, platform, ip_address, location, is_current, created_at, last_active)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `,
      [
        userId,
        session.deviceName || "Unknown Device",
        session.platform || "iOS",
        session.ipAddress || "127.0.0.1",
        session.location || "Unknown Location",
        now,
        now,
      ],
    );
  });

  const row = await querySingle<{ id: number }>(
    `SELECT id FROM login_sessions WHERE user_id = ? AND is_current = 1 LIMIT 1`,
    [userId],
  );
  return row?.id ?? 0;
}

export async function terminateLoginSession(sessionId: number): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `DELETE FROM login_sessions WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [sessionId] : [sessionId, userId],
  );
}

export async function terminateAllOtherSessions(
  currentSessionId: number,
): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `DELETE FROM login_sessions WHERE id != ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [currentSessionId] : [currentSessionId, userId],
  );
}

// Sync operations
export async function getUnsyncedDocuments(): Promise<LocalDocument[]> {
  const userId = await getLocalUserId();
  return queryDocuments(
    `
    SELECT ${DOC_COLUMNS}
    FROM documents
    WHERE needs_sync = 1
      AND ${userId === null ? "1 = 0" : "user_id = ?"}
  `,
    userId === null ? [] : [userId],
  );
}

export async function addToSyncQueue(
  tableName: string,
  recordId: number,
  operation: string,
): Promise<void> {
  await run(
    `INSERT INTO sync_queue (table_name, record_id, operation, status) VALUES (?, ?, ?, 'pending')`,
    [tableName, recordId, operation],
  );
}

export async function getSyncQueue(): Promise<
  { id: number; table_name: string; record_id: number; operation: string; status: string }[]
> {
  return queryAll<{
    id: number;
    table_name: string;
    record_id: number;
    operation: string;
    status: string;
  }>(`SELECT id, table_name, record_id, operation, status FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC`);
}

export async function updateSyncQueueStatus(
  id: number,
  status: "pending" | "processing" | "completed" | "failed",
): Promise<void> {
  await run(`UPDATE sync_queue SET status = ? WHERE id = ?`, [status, id]);
}

export async function getUnsyncedDocumentCount(): Promise<number> {
  const userId = await getLocalUserId();
  const result = await querySingle<{ count: number }>(
    `SELECT COUNT(*) as count FROM documents WHERE needs_sync = 1 AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [] : [userId],
  );
  return result?.count || 0;
}

export async function getUnsyncedReminderCount(): Promise<number> {
  const userId = await getLocalUserId();
  const result = await querySingle<{ count: number }>(
    `SELECT COUNT(*) as count FROM reminders WHERE needs_sync = 1 AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [] : [userId],
  );
  return result?.count || 0;
}

export async function setReminderCloudId(
  id: number,
  cloudId: number | null,
): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `UPDATE reminders SET cloud_id = ? WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [cloudId, id] : [cloudId, id, userId],
  );
}

export async function markReminderSynced(id: number) {
  const userId = await getLocalUserId();
  await run(
    `UPDATE reminders SET needs_sync = 0 WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [id] : [id, userId],
  );
}

export async function markReminderAsRead(id: number): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `UPDATE reminders SET is_read = 1, needs_sync = 1 WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [id] : [id, userId],
  );
}

export async function markAllRemindersAsRead(): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `UPDATE reminders SET is_read = 1, needs_sync = 1 WHERE ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [] : [userId],
  );
}

export async function markDocumentSynced(id: number) {
  const userId = await getLocalUserId();
  await run(
    `UPDATE documents SET needs_sync = 0 WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [id] : [id, userId],
  );
}

export async function getUnsyncedReminders(): Promise<LocalReminder[]> {
  const userId = await getLocalUserId();
  return queryAll<LocalReminder>(
    `
    SELECT id, user_id AS "userId", title, description, due_date AS "dueDate",
           severity, is_read AS "read", needs_sync AS "needsSync",
           cloud_id AS "cloudId", created_at AS "createdAt"
    FROM reminders
    WHERE needs_sync = 1
      AND ${userId === null ? "1 = 0" : "user_id = ?"}
  `,
    userId === null ? [] : [userId],
  );
}

export async function clearSyncQueue() {
  await run(`DELETE FROM sync_queue`);
}

// Document history operations
export async function logDocumentAction(
  docId: number,
  action: string,
  snapshot: Partial<LocalDocument>,
) {
  await run(
    `INSERT INTO document_history 
       (document_id, action, title, category, issuer, document_number, 
        issue_date, expiry_date, notes, status, file_url, file_type, 
        s3_key, processing_status, risk_score, risk_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      docId,
      action,
      snapshot.title,
      snapshot.category,
      snapshot.issuer,
      snapshot.documentNumber,
      snapshot.issueDate,
      snapshot.expiryDate,
      snapshot.notes,
      snapshot.status,
      snapshot.fileUrl,
      snapshot.fileType,
      snapshot.s3Key,
      snapshot.processingStatus,
      snapshot.riskScore,
      snapshot.riskLevel,
      new Date().toISOString(),
    ],
  );
}

export async function getDocumentHistory(docId: number) {
  const userId = await getLocalUserId();

  // History contains full document snapshots (number, issuer, expiry), so it
  // must be scoped exactly like the document itself.
  const rows = await queryAll<any>(
    `
    SELECT h.id, h.action, h.title, h.category, h.issuer,
           h.document_number AS "documentNumber",
           h.issue_date AS "issueDate", h.expiry_date AS "expiryDate",
           h.notes, h.status, h.created_at AS "createdAt"
    FROM document_history h
    LEFT JOIN documents d ON d.id = h.document_id
    WHERE h.document_id = ?
      AND ${userId === null ? "1 = 0" : "COALESCE(d.user_id, -1) = ?"}
    ORDER BY h.created_at DESC, h.id DESC
  `,
    userId === null ? [docId] : [docId, userId],
  );
  return rows;
}

// Expiring/expired document queries live with the dashboard aggregates below so
// they share one definition of the expiry window and the deleted-row filter.

export async function updateDocumentStatus(id: number, status: string) {
  const userId = await getLocalUserId();
  await run(
    `UPDATE documents SET status = ?, updated_at = ? WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null
      ? [status, new Date().toISOString(), id]
      : [status, new Date().toISOString(), id, userId],
  );
}

export async function updateDocumentSyncStatus(
  id: number,
  syncStatus: "synced" | "pending" | "failed" | "local",
) {
  const userId = await getLocalUserId();
  await run(
    `UPDATE documents SET sync_status = ? WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [syncStatus, id] : [syncStatus, id, userId],
  );
}

/**
 * Records the backend document id so cloud operations (update/delete) target the
 * correct server row instead of the local autoincrement key.
 */
export async function setDocumentCloudId(
  id: number,
  cloudId: number | null,
): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `UPDATE documents SET cloud_id = ? WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null ? [cloudId, id] : [cloudId, id, userId],
  );
}

/**
 * Completes a successful sync in one write.
 *
 * `cloud_id` and `server_updated_at` are the pair that makes the next sync
 * conflict-aware: the cloud id says which server row to touch, the revision
 * says which revision of it this device has seen. Writing them separately
 * (or only the first) meant the next sync either targeted the wrong row or
 * overwrote a newer server edit.
 */
export async function markDocumentSyncedWithCloud(
  id: number,
  cloudId: number | null,
  serverUpdatedAt: string | null,
): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `UPDATE documents
     SET cloud_id = COALESCE(?, cloud_id),
         server_updated_at = COALESCE(?, server_updated_at),
         needs_sync = 0,
         sync_status = 'synced'
     WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null
      ? [cloudId, serverUpdatedAt, id]
      : [cloudId, serverUpdatedAt, id, userId],
  );
}

/**
 * Marks the row for deletion on the next sync instead of removing it, so the
 * deletion can still be pushed to the cloud. The local id is preserved as the
 * queue key; cloud_id identifies the server row.
 */
export async function softDeleteDocument(id: number): Promise<void> {
  const userId = await getLocalUserId();
  await run(
    `UPDATE documents
     SET status = 'deleted', needs_sync = 1, sync_status = 'pending', updated_at = ?
     WHERE id = ? AND ${userId === null ? "1 = 0" : "user_id = ?"}`,
    userId === null
      ? [new Date().toISOString(), id]
      : [new Date().toISOString(), id, userId],
  );
}

/**
 * Date window predicates, sargable.
 *
 * `date(expiry_date)` wrapped the column in a function, so neither the
 * `expiry_date` index nor a range scan could be used and every dashboard mount
 * full-scanned the table. `expiry_date` is stored as `YYYY-MM-DD` and
 * `date('now')` yields the same shape, so plain comparison is equivalent and
 * indexable.
 *
 * `expiry_date IS NOT NULL AND != ''` is always applied: a document with no
 * expiry date was previously counted as neither valid, expiring, nor expired
 * while still inflating the `total`, so the dashboard tiles never added up.
 */
const EXPIRY_PRESENT = `expiry_date IS NOT NULL AND expiry_date != ''`;
const NOT_DELETED = `status IS NOT 'deleted'`;

export async function getExpiringDocuments(
  days: number = 30,
): Promise<LocalDocument[]> {
  const userId = await getLocalUserId();
  return queryDocuments(
    `
    SELECT ${DOC_COLUMNS}
    FROM documents
    WHERE ${EXPIRY_PRESENT}
      AND ${NOT_DELETED}
      AND expiry_date >= date('now')
      AND expiry_date <= date('now', '+' || ? || ' days')
      AND ${userId === null ? "1 = 0" : "user_id = ?"}
    ORDER BY expiry_date ASC
  `,
    userId === null ? [days] : [days, userId],
  );
}

export async function getExpiredDocuments(): Promise<LocalDocument[]> {
  const userId = await getLocalUserId();
  return queryDocuments(
    `
    SELECT ${DOC_COLUMNS}
    FROM documents
    WHERE ${EXPIRY_PRESENT}
      AND ${NOT_DELETED}
      AND expiry_date < date('now')
      AND ${userId === null ? "1 = 0" : "user_id = ?"}
    ORDER BY expiry_date ASC
  `,
    userId === null ? [] : [userId],
  );
}

export async function getDashboardSummary(): Promise<DocumentDashboardSummary> {
  const database = await getDb();
  const userId = await getLocalUserId();
  const scope = userId === null ? "1 = 0" : "user_id = ?";
  const scopeParams = userId === null ? [] : [userId];

  const base = `FROM documents WHERE ${NOT_DELETED} AND ${EXPIRY_PRESENT} AND ${scope}`;
  // One aggregate instead of four sequential round trips across the native
  // bridge, which is what made the dashboard visibly stall on open.
  const counts = await database.getFirstAsync<{
    total: number;
    valid: number;
    expiring: number;
    expired: number;
  }>(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN expiry_date > date('now') THEN 1 ELSE 0 END) AS valid,
      SUM(CASE WHEN expiry_date >= date('now') AND expiry_date <= date('now', '+30 days') THEN 1 ELSE 0 END) AS expiring,
      SUM(CASE WHEN expiry_date < date('now') THEN 1 ELSE 0 END) AS expired
    ${base}
  `,
    ...scopeParams,
  );

  const nextExpiringRow = await database.getFirstAsync<{
    id: number;
    title: string;
    expiry_date: string;
  }>(
    `
    SELECT id, title, expiry_date
    ${base}
    AND expiry_date >= date('now')
    ORDER BY expiry_date ASC
    LIMIT 1
  `,
    ...scopeParams,
  );

  let nextExpiring;
  if (nextExpiringRow) {
    nextExpiring = {
      id: nextExpiringRow.id,
      title: nextExpiringRow.title,
      daysRemaining: daysUntil(nextExpiringRow.expiry_date),
      expiryDate: nextExpiringRow.expiry_date,
    };
  }

  return {
    total: counts?.total || 0,
    valid: counts?.valid || 0,
    expiring: counts?.expiring || 0,
    expired: counts?.expired || 0,
    nextExpiring,
  };
}

export interface DocumentStatistics {
  totalDocuments: number;
  validDocuments: number;
  expiringDocuments: number;
  expiredDocuments: number;
  byCategory: Record<string, number>;
  expiringSoonList: { id: number; title: string; daysRemaining: number; expiryDate: string }[];
  expiredList: { id: number; title: string; documentNumber: string; expiryDate: string }[];
}

export async function getStatistics(): Promise<DocumentStatistics> {
  const database = await getDb();
  const userId = await getLocalUserId();
  const scope = userId === null ? "1 = 0" : "user_id = ?";
  const scopeParams = userId === null ? [] : [userId];
  const base = `FROM documents WHERE ${NOT_DELETED} AND ${scope}`;

  // Same aggregate pattern as getDashboardSummary, and it now counts documents
  // with no expiry date in `total` (matching the Documents tab) rather than
  // dropping them, so the tiles reconcile with the list.
  const counts = await database.getFirstAsync<{
    total: number;
    valid: number;
    expiring: number;
    expired: number;
  }>(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${EXPIRY_PRESENT} AND expiry_date > date('now', '+30 days') THEN 1 ELSE 0 END) AS valid,
      SUM(CASE WHEN ${EXPIRY_PRESENT} AND expiry_date >= date('now') AND expiry_date <= date('now', '+30 days') THEN 1 ELSE 0 END) AS expiring,
      SUM(CASE WHEN ${EXPIRY_PRESENT} AND expiry_date < date('now') THEN 1 ELSE 0 END) AS expired
    ${base}
  `,
    ...scopeParams,
  );

  const categoryRows = await database.getAllAsync<{
    category: string;
    count: number;
  }>(
    `SELECT COALESCE(category, 'other') AS category, COUNT(*) AS count ${base} GROUP BY category`,
    ...scopeParams,
  );

  const byCategory: Record<string, number> = {};
  for (const row of categoryRows) {
    byCategory[row.category] = row.count;
  }

  const expiringSoonRows = await database.getAllAsync<{
    id: number;
    title: string;
    expiry_date: string;
  }>(
    `SELECT id, title, expiry_date
     FROM documents
     WHERE ${NOT_DELETED} AND ${EXPIRY_PRESENT}
       AND expiry_date >= date('now') AND expiry_date <= date('now', '+30 days')
       AND ${scope}
     ORDER BY expiry_date ASC`,
    ...scopeParams,
  );

  const expiringSoonList = expiringSoonRows.map((row) => ({
    id: row.id,
    title: row.title,
    daysRemaining: daysUntil(row.expiry_date),
    expiryDate: row.expiry_date,
  }));

  const expiredRows = await database.getAllAsync<{
    id: number;
    title: string;
    document_number: string;
    expiry_date: string;
  }>(
    `SELECT id, title, document_number, expiry_date
     FROM documents
     WHERE ${NOT_DELETED} AND ${EXPIRY_PRESENT} AND expiry_date < date('now')
       AND ${scope}
     ORDER BY expiry_date ASC`,
    ...scopeParams,
  );

  const expiredList = expiredRows.map((row) => ({
    id: row.id,
    title: row.title,
    documentNumber: row.document_number,
    expiryDate: row.expiry_date,
  }));

  return {
    totalDocuments: counts?.total || 0,
    validDocuments: counts?.valid || 0,
    expiringDocuments: counts?.expiring || 0,
    expiredDocuments: counts?.expired || 0,
    byCategory,
    expiringSoonList,
    expiredList,
  };
}

/**
 * Whole days from today to a `YYYY-MM-DD` expiry.
 *
 * Parsed as local midnight, not `new Date("2026-03-01")`. The bare ISO date
 * parses as UTC midnight, so anywhere west of UTC the countdown was a day short
 * and documents expiring "today" could show as already expired.
 */
function daysUntil(expiryDate: string): number {
  const [year, month, day] = expiryDate.slice(0, 10).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return 0;
  }
  const expiry = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

// Reminder operations
export async function createReminder(
  reminder: Partial<LocalReminder>,
): Promise<number> {
  const userId = await getLocalUserId();
  const result = await run(
    `INSERT INTO reminders
       (user_id, title, description, due_date, severity, is_read, needs_sync, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      userId,
      reminder.title,
      reminder.description || "",
      reminder.dueDate ?? null,
      reminder.severity || "Valid",
      reminder.read ? 1 : 0,
      new Date().toISOString(),
    ],
  );
  return result.lastInsertRowId as number;
}
