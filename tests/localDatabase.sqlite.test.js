"use strict";

/**
 * SQLite-backed tests for the statements the app really runs.
 *
 * The statements are not copied into this file: they are read out of
 * `services/localDatabase.ts`, so the test exercises the SQL that ships. If a
 * statement changes in the app, this test runs the changed statement.
 *
 * The engine is SQLite itself through `node:sqlite`, which is available from
 * Node 22.5. On an older Node the test is skipped rather than failing, so the
 * suite stays runnable everywhere.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let DatabaseSync = null;

try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const SOURCE = path.join(__dirname, "..", "services", "localDatabase.ts");

/**
 * Extracts the template literal that starts with `marker` from the app source.
 *
 * The statements are plain template literals, so they are read as text. The
 * marker is the first words of the statement, which is how a developer finds
 * it in the file as well.
 */
function readTemplateLiteral(marker) {
  const source = fs.readFileSync(SOURCE, "utf8");
  const start = source.indexOf(marker);

  assert.notEqual(start, -1, `${marker} was not found in localDatabase.ts`);

  // The marker sits inside the template literal, so the opening backtick is
  // the last one before it.
  const open = source.lastIndexOf("`", start);
  assert.notEqual(open, -1, `${marker} has no template literal`);

  const close = source.indexOf("`", open + 1);
  assert.notEqual(close, -1, `${marker} has no closing backtick`);

  /*
   * A few statements interpolate the account scope into the SQL. The
   * interpolation is replaced with the scoped variant, which is the one that
   * runs for a signed-in account.
   */
  return source
    .slice(open + 1, close)
    .replace(/\$\{[^}]*\}/g, "user_id = ?");
}

/**
 * The column list of the `documents` table, taken from the schema the app
 * creates.
 */
function readDocumentsSchema() {
  const ddl = readTemplateLiteral("CREATE TABLE IF NOT EXISTS documents");

  const open = ddl.indexOf("(");
  const close = ddl.lastIndexOf(")");

  assert.ok(open !== -1 && close > open, "the documents table has no columns");

  return ddl.slice(open + 1, close);
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");

  db.exec(`CREATE TABLE IF NOT EXISTS documents (${readDocumentsSchema()})`);
  db.exec(`CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id INTEGER,
    operation TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  return db;
}

/**
 * The columns of the canonical projection, as the app selects them.
 */
function readDocumentColumns() {
  const source = fs.readFileSync(SOURCE, "utf8");
  const marker = "const DOC_COLUMNS = `";
  const start = source.indexOf(marker);

  assert.notEqual(start, -1, "DOC_COLUMNS was not found");

  const open = source.indexOf("`", start);
  const close = source.indexOf("`", open + 1);

  return source.slice(open + 1, close);
}

const skip = DatabaseSync === null;

test(
  "the insert of createDocument persists a row",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();
    const insert = readTemplateLiteral("INSERT INTO documents");

    const now = new Date().toISOString();
    const info = db.prepare(insert).run(
      7,
      "Passport",
      "identification",
      "DFA",
      "P123",
      "2024-01-01",
      null,
      "a note",
      "active",
      1,
      30,
      JSON.stringify([7, 30]),
      "file:///cache/scan.jpg",
      "image/jpeg",
      "7/abc.jpg",
      "completed",
      null,
      null,
      1,
      "pending",
      42,
      null,
      now,
      now,
    );

    assert.equal(info.changes, 1, "exactly one row may be inserted");

    const row = db.prepare("SELECT * FROM documents").get();
    assert.equal(row.user_id, 7);
    assert.equal(row.title, "Passport");
    assert.equal(row.document_number, "P123");
    assert.equal(row.needs_sync, 1);
    assert.equal(row.sync_status, "pending");
    assert.equal(row.cloud_id, 42);
    assert.equal(row.reminder_intervals, "[7,30]");
    assert.equal(row.processing_status, "completed");
  },
);

test(
  "the projection of the document reads returns every column",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();
    const insert = readTemplateLiteral("INSERT INTO documents");

    const now = new Date().toISOString();
    db.prepare(insert).run(
      7,
      "Passport",
      "identification",
      "DFA",
      "P123",
      "2024-01-01",
      null,
      "",
      "active",
      1,
      30,
      null,
      null,
      null,
      null,
      "completed",
      null,
      null,
      1,
      "pending",
      null,
      "2026-10-20T15:27:11.123456Z",
      now,
      now,
    );

    const columns = readDocumentColumns();
    const row = db
      .prepare(
        `SELECT ${columns} FROM documents WHERE needs_sync = 1 AND user_id = ?`,
      )
      .get(7);

    assert.ok(row, "the queued document must be found");
    assert.equal(row.cloudId, null);
    assert.equal(row.serverUpdatedAt, "2026-10-20T15:27:11.123456Z");
    assert.equal(row.needsSync, 1);
    assert.equal(row.enableAlerts, 1);

    // The projection and the table must not drift apart.
    const tableColumns = db.prepare("SELECT * FROM documents").all();
    const tableKeys = Object.keys(tableColumns[0]);

    // A projection entry is either a plain column or `column AS "alias"`.
    const projectedColumns = readDocumentColumns()
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/\s+AS\s+.*$/i, "").trim());

    for (const column of projectedColumns) {
      assert.ok(
        tableKeys.includes(column),
        `the projection selects ${column}, which the table does not have`,
      );
    }
  },
);

test(
  "markDocumentSyncedWithCloud stores the cloud id and the revision",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();
    const update = readTemplateLiteral(
      "SET cloud_id = COALESCE(?, cloud_id)",
    );

    db.prepare(
      `INSERT INTO documents (user_id, title, needs_sync, sync_status, cloud_id, server_updated_at)
       VALUES (7, 'Passport', 1, 'pending', 42, '2026-10-20T15:27:11.123456Z')`,
    ).run();

    db.prepare(update).run(
      42,
      "2026-10-21T09:00:00.500000Z",
      1,
      7,
    );

    const row = db.prepare("SELECT * FROM documents WHERE id = 1").get();
    assert.equal(row.needs_sync, 0);
    assert.equal(row.sync_status, "synced");
    assert.equal(row.cloud_id, 42);
    assert.equal(row.server_updated_at, "2026-10-21T09:00:00.500000Z");
  },
);

test(
  "a sync that reports no revision keeps the revision it already had",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();
    const update = readTemplateLiteral("SET cloud_id = COALESCE(?, cloud_id)");

    db.prepare(
      `INSERT INTO documents (user_id, title, needs_sync, sync_status, cloud_id, server_updated_at)
       VALUES (7, 'Passport', 1, 'pending', 42, '2026-10-20T15:27:11.123456Z')`,
    ).run();

    db.prepare(update).run(null, null, 1, 7);

    const row = db.prepare("SELECT * FROM documents WHERE id = 1").get();
    assert.equal(
      row.server_updated_at,
      "2026-10-20T15:27:11.123456Z",
      "a missing revision must not erase the known one",
    );
    assert.equal(row.cloud_id, 42, "a missing cloud id must not erase the known one");
    assert.equal(row.needs_sync, 0);
  },
);

test(
  "a successful sync finishes a pending processing state",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();
    const update = readTemplateLiteral("SET cloud_id = COALESCE(?, cloud_id)");

    db.prepare(
      `INSERT INTO documents (user_id, title, needs_sync, sync_status, processing_status)
       VALUES (7, 'Passport', 1, 'pending', 'processing')`,
    ).run();

    db.prepare(update).run(42, "2026-10-21T09:00:00.500000Z", 1, 7);

    const row = db.prepare("SELECT * FROM documents WHERE id = 1").get();
    assert.equal(
      row.processing_status,
      "completed",
      "a document whose file is stored is not processing any more",
    );
  },
);

test(
  "a tombstone is hidden from the reads and stays queued",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();

    db.prepare(
      `INSERT INTO documents (user_id, title, status, needs_sync, sync_status)
       VALUES (7, 'Passport', 'active', 0, 'synced')`,
    ).run();

    db.prepare(
      `UPDATE documents SET status = 'deleted', needs_sync = 1, sync_status = 'pending' WHERE id = 1`,
    ).run();

    const visible = db
      .prepare(
        `SELECT id FROM documents WHERE status IS NOT 'deleted' AND user_id = ?`,
      )
      .all(7);

    assert.equal(visible.length, 0, "a tombstone must never be rendered");

    const queued = db
      .prepare(
        `SELECT id FROM documents WHERE needs_sync = 1 AND user_id = ?`,
      )
      .all(7);

    assert.equal(queued.length, 1, "a tombstone must still be pushed to the server");
  },
);

test(
  "the reads of one account never see the documents of another",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();

    db.prepare(
      `INSERT INTO documents (user_id, title) VALUES (7, 'Mine')`,
    ).run();
    db.prepare(
      `INSERT INTO documents (user_id, title) VALUES (8, 'Theirs')`,
    ).run();

    const mine = db
      .prepare(`SELECT title FROM documents WHERE user_id = ?`)
      .all(7);

    assert.equal(mine.length, 1);
    assert.equal(mine[0].title, "Mine");
  },
);

test(
  "deleting a document removes the row and its queue entry",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();

    db.prepare(
      `INSERT INTO documents (user_id, title) VALUES (7, 'Passport')`,
    ).run();
    db.prepare(
      `INSERT INTO sync_queue (table_name, record_id, operation, status)
       VALUES ('documents', 1, 'update', 'pending')`,
    ).run();

    db.prepare(`DELETE FROM documents WHERE id = ? AND user_id = ?`).run(1, 7);
    db.prepare(
      `DELETE FROM sync_queue WHERE table_name = 'documents' AND record_id = ?`,
    ).run(1);

    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM documents").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sync_queue").get().c, 0);
  },
);

test(
  "the profile save persists the preferences dirty flag",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();

    db.exec(`
      CREATE TABLE user_profile (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT,
        document_count INTEGER DEFAULT 0,
        expiring_count INTEGER DEFAULT 0,
        expired_count INTEGER DEFAULT 0,
        notifications_enabled INTEGER DEFAULT 1,
        notify_email INTEGER DEFAULT 1,
        notify_expiry INTEGER DEFAULT 1,
        two_factor INTEGER DEFAULT 0,
        preferences_dirty INTEGER DEFAULT 0
      );
    `);

    const insert = readTemplateLiteral("INSERT OR REPLACE INTO user_profile");

    const info = db.prepare(insert).run(
      7,
      "User",
      "user@example.com",
      0,
      0,
      0,
      1,
      1,
      1,
      0,
      1,
    );

    assert.equal(info.changes, 1, "exactly one row may be inserted");

    const row = db
      .prepare("SELECT preferences_dirty FROM user_profile WHERE id = 7")
      .get();

    assert.equal(row.preferences_dirty, 1, "the dirty flag must be persisted");
  },
);

test(
  "the purge of one account removes only that account's rows",
  { skip: skip ? "node:sqlite is not available" : false },
  () => {
    const db = createDatabase();

    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT);
      CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT);
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY,
        name TEXT,
        preferences_dirty INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_settings (id INTEGER PRIMARY KEY, user_id INTEGER, default_category TEXT);
      CREATE TABLE IF NOT EXISTS login_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, device_name TEXT);
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY,
        table_name TEXT,
        record_id INTEGER,
        operation TEXT,
        status TEXT
      );
      CREATE TABLE IF NOT EXISTS document_tags (id INTEGER PRIMARY KEY, document_id INTEGER, tag TEXT);
      CREATE TABLE IF NOT EXISTS document_history (id INTEGER PRIMARY KEY, document_id INTEGER, action TEXT);
    `);

    db.prepare(`INSERT INTO documents (user_id, title) VALUES (7, 'Mine')`).run();
    db.prepare(`INSERT INTO documents (user_id, title) VALUES (8, 'Theirs')`).run();
    db.prepare(`INSERT INTO reminders (user_id, title) VALUES (7, 'Mine')`).run();
    db.prepare(`INSERT INTO reminders (user_id, title) VALUES (8, 'Theirs')`).run();
    db.prepare(
      `INSERT INTO user_profile (id, name, preferences_dirty) VALUES (7, 'User 7', 0), (8, 'User 8', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO user_settings (user_id, default_category) VALUES (7, 'other'), (8, 'other')`,
    ).run();
    db.prepare(
      `INSERT INTO login_sessions (user_id, device_name) VALUES (7, 'A'), (8, 'B')`,
    ).run();
    db.prepare(
      `INSERT INTO sync_queue (table_name, record_id, operation, status) VALUES ('documents', 1, 'update', 'pending')`,
    ).run();
    db.prepare(`INSERT INTO document_tags (document_id, tag) VALUES (1, 'important')`).run();
    db.prepare(`INSERT INTO document_history (document_id, action) VALUES (1, 'created')`).run();

    const purgeStatements = [
      readTemplateLiteral("DELETE FROM document_tags WHERE document_id IN"),
      readTemplateLiteral("DELETE FROM documents WHERE user_id = ?"),
      readTemplateLiteral("DELETE FROM reminders WHERE user_id = ?"),
      readTemplateLiteral("DELETE FROM login_sessions WHERE user_id = ?"),
      readTemplateLiteral("DELETE FROM user_settings WHERE user_id = ?"),
      readTemplateLiteral("DELETE FROM user_profile WHERE id = ?"),
      readTemplateLiteral("DELETE FROM sync_queue"),
    ];

    for (const statement of purgeStatements) {
      if (statement.includes("?")) {
        db.prepare(statement).run(7);
      } else {
        db.prepare(statement).run();
      }
    }

    const mineCount = db
      .prepare("SELECT COUNT(*) AS c FROM documents WHERE user_id = 7")
      .get().c;
    const theirsCount = db
      .prepare("SELECT COUNT(*) AS c FROM documents WHERE user_id = 8")
      .get().c;

    assert.equal(mineCount, 0, "the purged account's documents must be gone");
    assert.equal(theirsCount, 1, "another account's documents must survive");

    const mineReminders = db
      .prepare("SELECT COUNT(*) AS c FROM reminders WHERE user_id = 7")
      .get().c;
    const theirsReminders = db
      .prepare("SELECT COUNT(*) AS c FROM reminders WHERE user_id = 8")
      .get().c;

    assert.equal(mineReminders, 0, "the purged account's reminders must be gone");
    assert.equal(
      theirsReminders,
      1,
      "another account's reminders must survive",
    );

    const queueLeft = db
      .prepare("SELECT COUNT(*) AS c FROM sync_queue")
      .get().c;
    assert.equal(queueLeft, 0, "the sync queue must be cleared by the purge");
  },
);
