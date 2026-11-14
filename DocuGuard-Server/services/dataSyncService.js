const db = require("../config/db");
const { broadcastToUser } = require("./realtimeService");
const { decrypt } = require("./cryptoService");

/**
 * The server revision of a row, rendered so it survives a round trip.
 *
 * Same expression the controllers use, so the authoritative revision carries
 * the database's stored timestamp rather than a freshly minted revision.
 */
/**
 * Return readable PII for an outgoing document payload.
 * Persisted database values remain encrypted.
 * Legacy plaintext values are supported by cryptoService.decrypt().
 */
function readablePii(value) {
  if (value === undefined || value === null || value === "") {
    return value;
  }

  try {
    return decrypt(value);
  } catch (_err) {
    return null;
  }
}

const UPDATED_AT_ISO_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Fetch the authoritative document row by ID and user ID.
 *
 * The ownership condition prevents a caller from retrieving another user's
 * document. Soft-deleted documents are excluded.
 */
const DOCUMENT_SELECT_SQL = `
  SELECT id, user_id, title, category, issuer, document_number AS "documentNumber",
         issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
         enable_alerts AS "enableAlerts", file_url AS "fileUrl", file_type AS "fileType",
         s3_key AS "s3Key", processing_status AS "processingStatus",
         risk_score AS "riskScore", risk_level AS "riskLevel",
         ${UPDATED_AT_ISO_SQL} AS "updatedAt"
  FROM documents
  WHERE id = $1 AND user_id = $2 AND status <> 'deleted'
`;

/**
 * Maps a newly inserted document to the application's document shape.
 *
 * Defaults apply only when preparing an insert event payload. This function
 * does not write to the database.
 */
function documentRow(document) {
  const title =
    document.title && String(document.title).trim()
      ? String(document.title).trim()
      : "Scanned Document";

  return {
    id: document.id,
    user_id: document.userId ?? document.user_id,
    title,
    category: document.category || "other",
    issuer: readablePii(document.issuer) || null,
    document_number: readablePii(
      document.documentNumber ?? document.document_number ?? null,
    ),
    issue_date: document.issueDate ?? document.issue_date ?? null,
    expiry_date: document.expiryDate ?? document.expiry_date ?? null,
    notes: document.notes || "",
    status: document.status || "active",
    enable_alerts: document.enableAlerts ?? document.enable_alerts ?? true,
    file_url: document.fileUrl ?? document.file_url ?? null,
    file_type: document.fileType ?? document.file_type ?? null,
    s3_key: document.s3Key ?? document.s3_key ?? null,
    processing_status:
      document.processingStatus ?? document.processing_status ?? "completed",
    risk_score: document.riskScore ?? document.risk_score ?? null,
    risk_level: document.riskLevel ?? document.risk_level ?? null,
    updated_at:
      document.updatedAt ?? document.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Maps an existing document without inventing values for missing fields.
 *
 * Explicit NULL values are preserved. Undefined fields are omitted from the
 * event payload. This mapping is for broadcasting, not database writes.
 *
 * @param {object} document Persisted row in camelCase or database-column form.
 * @param {number|string} userId
 * @returns {object}
 */
function authoritativeDocumentRow(document, userId) {
  const row = {};

  const set = (column, ...values) => {
    for (const value of values) {
      if (value !== undefined) {
        row[column] = value instanceof Date ? value.toISOString() : value;
        return;
      }
    }
  };

  set("id", document.id);
  set("user_id", document.user_id ?? document.userId ?? userId);
  set("title", document.title);
  set("category", document.category);
  set(
    "issuer",
    document.issuer === undefined ? undefined : readablePii(document.issuer),
  );

  const documentNumber =
    document.document_number !== undefined
      ? document.document_number
      : document.documentNumber;

  set(
    "document_number",
    documentNumber === undefined ? undefined : readablePii(documentNumber),
  );
  set("issue_date", document.issue_date, document.issueDate);
  set("expiry_date", document.expiry_date, document.expiryDate);
  set("notes", document.notes);
  set("status", document.status);
  set("enable_alerts", document.enable_alerts, document.enableAlerts);
  set("file_url", document.file_url, document.fileUrl);
  set("file_type", document.file_type, document.fileType);
  set("s3_key", document.s3_key, document.s3Key);
  set(
    "processing_status",
    document.processing_status,
    document.processingStatus,
  );
  set("risk_score", document.risk_score, document.riskScore);
  set("risk_level", document.risk_level, document.riskLevel);

  // Prefer the canonical timestamp alias when present because it retains
  // PostgreSQL timestamp precision better than a JavaScript Date.
  set("updated_at", document.updatedAt, document.updated_at);

  return row;
}

/**
 * Fetches a persisted document scoped to its owner.
 *
 * Returns null if the document is absent, soft-deleted, or not owned by the
 * supplied user.
 */
async function fetchAuthoritativeDocument(dbClient, documentId, userId) {
  const result = await dbClient.query(DOCUMENT_SELECT_SQL, [
    documentId,
    userId,
  ]);

  return result.rows[0] ?? null;
}

function reminderRow(reminder, userId) {
  return {
    id: reminder.id,
    user_id: userId,
    title: reminder.title,
    description: reminder.description,
    due_date: reminder.dueDate,
    severity: reminder.severity,
    is_read: reminder.read,
    updated_at: reminder.updatedAt || new Date().toISOString(),
  };
}

/**
 * Publishes a change after the primary PostgreSQL operation.
 *
 * The application already writes to PostgreSQL through `db`. The Supabase
 * client points to the same project, so a second upsert would be redundant
 * and could overwrite fields with incomplete or default values.
 *
 * This function intentionally performs no database write. It only broadcasts
 * the event to connected clients.
 *
 * @param {string} table
 * @param {object} row
 * @param {number|string} userId
 * @param {string} event
 * @returns {Promise<{ok: boolean}>}
 */
async function mirror(table, row, userId, event) {
  broadcastToUser(userId, table, {
    eventType: event,
    new: event === "DELETE" ? null : row,
    old: event === "DELETE" ? row : null,
  });

  return { ok: true };
}

/**
 * Publishes a document change.
 *
 * INSERT events use the insert mapping. UPDATE events use the mapping that
 * preserves stored NULLs and omits fields that are not present.
 *
 * This function does not write to PostgreSQL; the controller performs the
 * primary database operation.
 */
async function syncDocument(userId, document, event = "UPDATE") {
  const row =
    event === "INSERT"
      ? documentRow({ ...document, userId })
      : authoritativeDocumentRow(document, userId);

  return mirror("documents", row, userId, event);
}

/**
 * Fetches the authoritative document before publishing a change.
 *
 * The scoped read is retained to ensure the event is based on persisted data
 * and not on a partial request payload. If no row is found, nothing is
 * broadcast.
 *
 * @param {number|string} userId
 * @param {number|string} documentId
 * @param {string} event
 * @param {{db?: object, fetch?: Function}} [options]
 * @returns {Promise<{ok: boolean, row: object}|null>}
 */
async function syncDocumentFromAuthoritative(
  userId,
  documentId,
  event = "UPDATE",
  options = {},
) {
  const fetch =
    typeof options.fetch === "function"
      ? options.fetch
      : (id, uid) => fetchAuthoritativeDocument(options.db || db, id, uid);

  const authoritative = await fetch(documentId, userId);

  if (!authoritative) {
    return null;
  }

  const row = authoritativeDocumentRow(authoritative, userId);
  const result = await mirror("documents", row, userId, event);

  return { ...result, row: authoritative };
}

/**
 * Publishes a reminder change after the controller's primary database write.
 */
async function syncReminder(userId, reminder, event = "UPDATE") {
  const row = reminderRow(reminder, userId);
  await mirror("reminders", row, userId, event);
}

/**
 * Broadcasts a document deletion.
 *
 * The controller is responsible for performing the database soft delete.
 */
function broadcastDocumentDeletion(userId, documentId) {
  broadcastToUser(userId, "documents", {
    eventType: "DELETE",
    new: null,
    old: {
      id: documentId,
      user_id: userId,
    },
  });
}

/**
 * Broadcasts a deletion after the controller has performed the primary
 * database operation. Does not issue a second DELETE.
 */
async function deleteRecord(table, id, userId, row = {}) {
  broadcastToUser(userId, table, {
    eventType: "DELETE",
    new: null,
    old: { id, user_id: userId, ...row },
  });
}

/**
 * Publishes profile/settings changes to connected clients.
 *
 * The primary controller remains responsible for saving profile or preference
 * data. This function does not upsert into the Supabase profiles table.
 */
async function syncProfile(userId, profile) {
  broadcastToUser(userId, "profiles", {
    eventType: "UPDATE",
    new: { user_id: userId, ...profile },
    old: null,
  });
}

module.exports = {
  syncDocument,
  syncDocumentFromAuthoritative,
  fetchAuthoritativeDocument,
  documentRow,
  authoritativeDocumentRow,
  syncReminder,
  syncProfile,
  deleteRecord,
  broadcastDocumentDeletion,
};
