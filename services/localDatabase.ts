import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import {
  LocalDocument,
  LocalReminder,
  LocalUserProfile,
} from "../types/offline";
import { DebugLogger } from "./debugLogger";
import { ErrorCodes } from "../constants/errorCodes";

export type { LocalDocument, LocalReminder, LocalUserProfile };

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync("docuguard.db");
  }
  return db;
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

export async function initDatabase() {
  try {
    const database = await getDb();

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'other',
        issuer TEXT,
        document_number TEXT,
        issue_date TEXT,
        expiry_date TEXT,
        notes TEXT,
        status TEXT DEFAULT 'valid',
        enable_alerts BOOLEAN DEFAULT 1,
        file_url TEXT,
        file_type TEXT,
        s3_key TEXT,
        processing_status TEXT DEFAULT 'completed',
        risk_score REAL DEFAULT 0,
        risk_level TEXT DEFAULT 'Low',
        needs_sync BOOLEAN DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        severity TEXT DEFAULT 'Valid',
        is_read BOOLEAN DEFAULT 0,
        needs_sync BOOLEAN DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

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

    // Create index for tag lookups
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_document_tags_document_id ON document_tags(document_id);
    `);
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
    `);

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
    const result = await run(
      `
      INSERT INTO documents 
        (title, category, issuer, document_number, issue_date, expiry_date, notes, 
         status, enable_alerts, file_url, file_type, s3_key, processing_status, 
         risk_score, risk_level, needs_sync, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        doc.title,
        doc.category || "other",
        doc.issuer || "",
        doc.documentNumber || "",
        doc.issueDate,
        doc.expiryDate,
        doc.notes || "",
        doc.status || "active",
        doc.enableAlerts ? 1 : 0,
        doc.fileUrl || null,
        doc.fileType || null,
        doc.s3Key || null,
        doc.processingStatus || "completed",
        doc.riskScore || 0,
        doc.riskLevel || "Low",
        1,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    const docId = result.lastInsertRowId as number;
    
    // Add tags if provided
    if (doc.tags && doc.tags.length > 0) {
      await addDocumentTags(docId, doc.tags);
    }
    
    DebugLogger.debug("LocalDatabase", "Document created", {
      docId,
      title: doc.title,
    });
    return docId;
  } catch (err) {
    DebugLogger.error(
      "LocalDatabase",
      "Failed to create document",
      { error: err, title: doc.title },
      ErrorCodes.LOCAL_WRITE_FAILED,
    );
    throw err;
  }
}

export async function getAllDocuments(): Promise<LocalDocument[]> {
  try {
    const rows = await queryAll<LocalDocument>(`
      SELECT id, title, category, issuer, document_number AS "documentNumber",
             issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
             enable_alerts AS "enableAlerts", file_url AS "fileUrl", 
             file_type AS "fileType", processing_status AS "processingStatus",
             risk_score AS "riskScore", risk_level AS "riskLevel",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM documents ORDER BY expiry_date ASC
    `);
    
    // Fetch tags for each document
    for (const doc of rows) {
      if (doc.id) {
        doc.tags = await getDocumentTags(doc.id);
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
    const row = await querySingle<LocalDocument>(
      `SELECT id, title, category, issuer, document_number AS "documentNumber",
              issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
              enable_alerts AS "enableAlerts", file_url AS "fileUrl", 
              file_type AS "fileType", s3_key AS "s3Key", processing_status AS "processingStatus",
              risk_score AS "riskScore", risk_level AS "riskLevel",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents WHERE id = ?`,
      [id],
    );
    if (row) {
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

export async function updateDocument(id: number, doc: Partial<LocalDocument>) {
  try {
    await run(
      `
      UPDATE documents SET
        title = COALESCE(?, title),
        category = COALESCE(?, category),
        issuer = COALESCE(?, issuer),
        document_number = COALESCE(?, document_number),
        issue_date = COALESCE(?, issue_date),
        expiry_date = COALESCE(?, expiry_date),
        notes = COALESCE(?, notes),
        status = COALESCE(?, status),
        enable_alerts = COALESCE(?, enable_alerts),
        file_url = COALESCE(?, file_url),
        file_type = COALESCE(?, file_type),
        s3_key = COALESCE(?, s3_key),
        processing_status = COALESCE(?, processing_status),
        risk_score = COALESCE(?, risk_score),
        risk_level = COALESCE(?, risk_level),
        needs_sync = 1,
        updated_at = datetime('now')
      WHERE id = ?
    `,
      [
        doc.title,
        doc.category,
        doc.issuer,
        doc.documentNumber,
        doc.issueDate,
        doc.expiryDate,
        doc.notes,
        doc.status,
        doc.enableAlerts ? 1 : 0,
        doc.fileUrl,
        doc.fileType,
        doc.s3Key,
        doc.processingStatus,
        doc.riskScore,
        doc.riskLevel,
        id,
      ],
    );
    
    // Update tags if provided
    if (doc.tags !== undefined) {
      await replaceDocumentTags(id, doc.tags);
    }
    
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
    await run(`DELETE FROM documents WHERE id = ?`, [id]);
    await run(
      `DELETE FROM sync_queue WHERE table_name = 'documents' AND record_id = ?`,
      [id],
    );
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
  await run(
    `
    UPDATE documents SET processing_status = ?, risk_score = COALESCE(?, risk_score), risk_level = COALESCE(?, risk_level), updated_at = datetime('now')
    WHERE id = ?
  `,
    [status, riskScore, riskLevel, id],
  );
}

// Document Tags operations
export async function addDocumentTags(documentId: number, tags: string[]) {
  if (!tags.length) return;
  try {
    const database = await getDb();
    for (const tag of tags) {
      const trimmedTag = tag.trim().toLowerCase();
      if (!trimmedTag) continue;
      await database.runAsync(
        `INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)`,
        [documentId, trimmedTag],
      );
    }
    DebugLogger.debug("LocalDatabase", "Tags added", { documentId, tags });
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
    const rows = await queryAll<{ tag: string }>(
      `SELECT DISTINCT tag FROM document_tags ORDER BY tag`,
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
    const rows = await queryAll<{ document_id: number }>(
      `SELECT document_id FROM document_tags WHERE tag = ?`,
      [tag.trim().toLowerCase()],
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
  try {
    const database = await getDb();
    await database.runAsync(`DELETE FROM document_tags WHERE document_id = ?`, [
      documentId,
    ]);
    if (tags.length) {
      for (const tag of tags) {
        const trimmedTag = tag.trim().toLowerCase();
        if (!trimmedTag) continue;
        await database.runAsync(
          `INSERT INTO document_tags (document_id, tag) VALUES (?, ?)`,
          [documentId, trimmedTag],
        );
      }
    }
    DebugLogger.debug("LocalDatabase", "Tags replaced", { documentId, tags });
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
  const rows = await queryAll<LocalReminder>(`
    SELECT id, title, description, due_date AS "dueDate", severity, is_read AS "read"
    FROM reminders ORDER BY due_date ASC
  `);
  return rows;
}

export async function updateReminderStatus(id: number, isRead: boolean) {
  await run(`UPDATE reminders SET is_read = ? WHERE id = ?`, [
    isRead ? 1 : 0,
    id,
  ]);
}

// Profile operations
export async function saveUserProfile(profile: LocalUserProfile) {
  await run(
    `
    INSERT OR REPLACE INTO user_profile 
      (id, name, email, document_count, expiring_count, expired_count,
       notifications_enabled, notify_email, notify_expiry, two_factor)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
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
  const row = await querySingle<LocalUserProfile>(
    `SELECT id, name, email, document_count AS "documentCount",
            expiring_count AS "expiringCount", expired_count AS "expiredCount",
            notifications_enabled AS "notificationsEnabled",
            notify_email AS "notifyEmail", notify_expiry AS "notifyExpiry",
            two_factor AS "twoFactor"
     FROM user_profile WHERE id = 1`,
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
  const row = await querySingle<LocalUserSettings>(
    `SELECT id, user_id AS "userId", default_category AS "defaultCategory",
            auto_backup AS "autoBackup", reminder_before_days AS "reminderBeforeDays",
            reminder_30days AS "reminder30days", reminder_7days AS "reminder7days",
            reminder_1day AS "reminder1day", reminder_on_day AS "reminderOnDay",
            theme_mode AS "themeMode", font_size AS "fontSize",
            biometric_lock AS "biometricLock", data_exported_at AS "dataExportedAt"
     FROM user_settings WHERE user_id = 1 LIMIT 1`,
  );
  return row;
}

export async function saveUserSettings(
  settings: Partial<LocalUserSettings>,
): Promise<number> {
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
        updated_at = datetime('now')
      WHERE user_id = 1
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
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
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
  const rows = await queryAll<LocalLoginSession>(`
    SELECT id, user_id AS "userId", device_name AS "deviceName",
            platform, ip_address AS "ipAddress", location,
            is_current AS "isCurrent", created_at AS "createdAt",
            last_active AS "lastActive"
    FROM login_sessions ORDER BY is_current DESC, last_active DESC
  `);
  return rows;
}

export async function addLoginSession(
  session: Partial<LocalLoginSession>,
): Promise<number> {
  const result = await run(
    `
    INSERT INTO login_sessions
      (user_id, device_name, platform, ip_address, location, is_current, created_at, last_active)
    VALUES (1, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `,
    [
      session.deviceName || "Unknown Device",
      session.platform || "iOS",
      session.ipAddress || "127.0.0.1",
      session.location || "Unknown Location",
    ],
  );
  return result.lastInsertRowId as number;
}

export async function terminateLoginSession(sessionId: number): Promise<void> {
  await run(`DELETE FROM login_sessions WHERE id = ?`, [sessionId]);
}

export async function terminateAllOtherSessions(
  currentSessionId: number,
): Promise<void> {
  await run(`DELETE FROM login_sessions WHERE id != ?`, [currentSessionId]);
}

// Sync operations
export async function getUnsyncedDocuments(): Promise<LocalDocument[]> {
  const rows = await queryAll<LocalDocument>(`
    SELECT id, title, category, issuer, document_number AS "documentNumber",
           issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
           enable_alerts AS "enableAlerts", file_url AS "fileUrl", 
           file_type AS "fileType", s3_key AS "s3Key", processing_status AS "processingStatus",
           risk_score AS "riskScore", risk_level AS "riskLevel"
    FROM documents WHERE needs_sync = 1
  `);
  return rows;
}

export async function markReminderSynced(id: number) {
  await run(`UPDATE reminders SET needs_sync = 0 WHERE id = ?`, [id]);
}

export async function markReminderAsRead(id: number): Promise<void> {
  await run(`UPDATE reminders SET is_read = 1, needs_sync = 1 WHERE id = ?`, [
    id,
  ]);
}

export async function markAllRemindersAsRead(): Promise<void> {
  await run(`UPDATE reminders SET is_read = 1, needs_sync = 1`);
}

export async function markDocumentSynced(id: number) {
  await run(`UPDATE documents SET needs_sync = 0 WHERE id = ?`, [id]);
}

export async function getUnsyncedReminders(): Promise<LocalReminder[]> {
  const rows = await queryAll<LocalReminder>(`
    SELECT id, title, description, due_date AS "dueDate", severity, is_read AS "read"
    FROM reminders WHERE needs_sync = 1
  `);
  return rows;
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
  const rows = await queryAll<any>(
    `
    SELECT id, action, title, category, issuer, document_number AS "documentNumber",
           issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
           created_at AS "createdAt"
    FROM document_history 
    WHERE document_id = ?
    ORDER BY created_at DESC
  `,
    [docId],
  );
  return rows;
}

// Expiring/expired document queries
export async function getExpiringDocuments(
  days: number = 30,
): Promise<LocalDocument[]> {
  const rows = await queryAll<LocalDocument>(
    `
    SELECT id, title, category, issuer, document_number AS "documentNumber",
           issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
           enable_alerts AS "enableAlerts", file_url AS "fileUrl", 
           file_type AS "fileType", processing_status AS "processingStatus",
           risk_score AS "riskScore", risk_level AS "riskLevel",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM documents 
    WHERE status != 'expired'
    AND date(expiry_date) BETWEEN date('now') AND date('now', '+' || ? || ' days')
    ORDER BY expiry_date ASC
  `,
    [days],
  );
  return rows;
}

export async function getExpiredDocuments(): Promise<LocalDocument[]> {
  const rows = await queryAll<LocalDocument>(`
    SELECT id, title, category, issuer, document_number AS "documentNumber",
           issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
           enable_alerts AS "enableAlerts", file_url AS "fileUrl", 
           file_type AS "fileType", processing_status AS "processingStatus",
           risk_score AS "riskScore", risk_level AS "riskLevel",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM documents 
    WHERE date(expiry_date) < date('now') AND status != 'expired'
    ORDER BY expiry_date ASC
  `);
  return rows;
}

export async function updateDocumentStatus(id: number, status: string) {
  await run(
    `UPDATE documents SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, id],
  );
}

// Reminder operations
export async function createReminder(
  reminder: Partial<LocalReminder>,
): Promise<number> {
  const result = await run(
    `INSERT INTO reminders 
       (title, description, due_date, severity, is_read, needs_sync, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [
      reminder.title,
      reminder.description || "",
      reminder.dueDate,
      reminder.severity || "Valid",
      reminder.read ? 1 : 0,
      new Date().toISOString(),
    ],
  );
  return result.lastInsertRowId as number;
}
