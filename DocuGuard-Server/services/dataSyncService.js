const { supabaseAdmin } = require("../config/supabase");
const db = require("../config/db");
const {
  broadcastToUser,
} = require("./realtimeService");
const { error: logError } = require("../utils/debugLogger");

/**
 * The server revision of a row, rendered so it survives a round trip.
 *
 * Same expression the controllers use, so the mirror payload carries the
 * authoritative revision rather than a freshly minted one.
 */
const UPDATED_AT_ISO_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The complete, authoritative document row, selected by id and user id.
 *
 * Partial sync payloads used to erase fields that the caller did not include
 * (see `documentRow` below), so update handlers now fetch this row after the
 * primary write and mirror it instead. The select is scoped by user id: a row
 * the caller does not own is never returned and never mirrored.
 */
const DOCUMENT_SELECT_SQL = `
  SELECT id, user_id, title, category, issuer, document_number AS "documentNumber",
         issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
         enable_alerts AS "enableAlerts", file_url AS "fileUrl", file_type AS "fileType",
         s3_key AS "s3Key", processing_status AS "processingStatus",
         risk_score AS "riskScore", risk_level AS "riskLevel",
         ${UPDATED_AT_ISO_SQL} AS "updatedAt"
  FROM documents
  WHERE id = $1 AND user_id = $2
`;

/**
 * The insert mapping: a row that does not exist yet needs a complete record.
 *
 * A field the caller did not supply is filled with the column's default. That
 * is correct for an insert, where there is no previous value to preserve, and
 * wrong for an update - see `authoritativeDocumentRow` for that case.
 */
function documentRow(document) {
  const title = (document.title && String(document.title).trim()) ? String(document.title).trim() : "Scanned Document";
  return {
    id: document.id,
    user_id: document.userId ?? document.user_id,
    title,
    category: document.category || "other",
    issuer: document.issuer || null,
    document_number: document.documentNumber ?? document.document_number ?? null,
    issue_date: document.issueDate ?? document.issue_date ?? null,
    expiry_date: document.expiryDate ?? document.expiry_date ?? null,
    notes: document.notes || "",
    status: document.status || "active",
    enable_alerts: document.enableAlerts ?? document.enable_alerts ?? true,
    file_url: document.fileUrl ?? document.file_url ?? null,
    file_type: document.fileType ?? document.file_type ?? null,
    s3_key: document.s3Key ?? document.s3_key ?? null,
    processing_status: document.processingStatus ?? document.processing_status ?? "completed",
    risk_score: document.riskScore ?? document.risk_score ?? null,
    risk_level: document.riskLevel ?? document.risk_level ?? null,
    updated_at: document.updatedAt ?? document.updated_at ?? new Date().toISOString(),
  };
}

/**
 * The update mapping: the mirror receives the row exactly as it is stored.
 *
 * `documentRow` cannot be used for an update. It fills a field the source
 * does not carry with a default - the category becomes "other", the notes
 * become "", the alerts flag becomes true, a missing title becomes "Scanned
 * Document" - and a field that is NULL in the database is indistinguishable
 * from a field the caller never mentioned. NULL is a fact: "no issuer",
 * "never assessed", "no expiry date".
 *
 * Because the mirror is an upsert into the same table the primary write just
 * updated, that substitution is not a cosmetic default. It rewrites the
 * authoritative row: the expiry date, the document number, the issuer, the
 * storage key and the risk fields are erased, and the title of a document
 * whose OCR failed is replaced by the literal "Scanned Document".
 *
 * So an update writes the persisted values through unchanged, and a field the
 * source does not carry at all is left out of the payload entirely - an
 * upsert only writes the columns it is given, so an absent column is not
 * touched.
 *
 * @param {object} document A persisted row, in either the camelCase alias
 *   form the controllers select or the raw column form.
 * @param {number|string} userId
 * @returns {object} The mirror payload.
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
  set("issuer", document.issuer);
  set("document_number", document.document_number, document.documentNumber);
  set("issue_date", document.issue_date, document.issueDate);
  set("expiry_date", document.expiry_date, document.expiryDate);
  set("notes", document.notes);
  set("status", document.status);
  set("enable_alerts", document.enable_alerts, document.enableAlerts);
  set("file_url", document.file_url, document.fileUrl);
  set("file_type", document.file_type, document.fileType);
  set("s3_key", document.s3_key, document.s3Key);
  set("processing_status", document.processing_status, document.processingStatus);
  set("risk_score", document.risk_score, document.riskScore);
  set("risk_level", document.risk_level, document.riskLevel);
  // The canonical revision wins over the raw column: the raw column is a
  // JavaScript Date, which carries milliseconds and would truncate the
  // stored microsecond revision when it is written back.
  set("updated_at", document.updatedAt, document.updated_at);

  return row;
}

/**
 * Fetch the authoritative document row after a primary write.
 *
 * Returns null when the row is absent or is not owned by this account, so a
 * caller that cannot obtain the authoritative row can refuse to mirror
 * instead of manufacturing a record from a partial request body.
 *
 * @param {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} db
 * @param {number|string} documentId
 * @param {number|string} userId
 */
async function fetchAuthoritativeDocument(db, documentId, userId) {
  const result = await db.query(DOCUMENT_SELECT_SQL, [documentId, userId]);
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
 * Writes one row to the mirror.
 *
 * A mirror failure never fails the request. The primary write has already
 * happened by the time the mirror is written, so answering an error would
 * tell the client that the update did not happen when it did - and a client
 * that retries would push the same change again. The failure is logged
 * without the row's contents and without any credential, and it is returned
 * to the caller so that it is observable and testable.
 *
 * @param {string} table
 * @param {object} row
 * @param {number|string} userId
 * @param {string} event
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function mirror(table, row, userId, event) {
  let failure = null;

  try {
    const { error } = await supabaseAdmin.from(table).upsert(row);

    if (error) {
      // Only the message. A PostgREST error also carries `details`, and the
      // details of a rejected write contain the row that was written.
      failure = error.message;
    }
  } catch (err) {
    // The mirror is a second write path, not the primary one. A transport
    // failure here must not undo the answer to the request.
    failure = err?.message || "Unknown mirror failure";
  }

  if (failure) {
    logError("Mirror", `Supabase ${table} mirror failed`, {
      userId,
      recordId: row.id,
      error: failure,
    });
  }

  // Broadcast immediately as well as through Supabase Realtime. This keeps
  // connected clients current when PostgreSQL is ahead of the mirror.
  broadcastToUser(userId, table, {
    eventType: event,
    new: event === "DELETE" ? null : row,
    old: event === "DELETE" ? row : null,
  });

  return failure ? { ok: false, error: failure } : { ok: true };
}

/**
 * Mirrors a document row.
 *
 * An insert is mapped with `documentRow`: the row does not exist yet, so a
 * field the caller did not supply is filled with the column's default. An
 * update is mapped with `authoritativeDocumentRow`: the row already exists,
 * so every field is written exactly as it is stored and a field the caller
 * did not supply is left alone.
 *
 * @param {number|string} userId
 * @param {object} document
 * @param {string} event
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function syncDocument(userId, document, event = "UPDATE") {
  const row =
    event === "INSERT"
      ? documentRow({ ...document, userId })
      : authoritativeDocumentRow(document, userId);

  return mirror("documents", row, userId, event);
}

/**
 * Fetches the persisted row and mirrors it.
 *
 * This is the correct call after a primary write that did not return the
 * whole row: it re-reads the record scoped by the account and mirrors that,
 * so the mirror cannot erase a field the caller never mentioned. When the
 * row is absent - it was deleted, or it belongs to another account - nothing
 * is mirrored at all, rather than a record manufactured from a partial
 * request body.
 *
 * @param {number|string} userId
 * @param {number|string} documentId
 * @param {string} event
 * @param {{ db?: object, fetch?: (documentId: number|string, userId: number|string) => Promise<object|null> }} [options]
 *   `fetch` defaults to `fetchAuthoritativeDocument` using the module's own
 *   `db`, so tests can supply a scripted fetch without touching the module.
 * @returns {Promise<{ ok: boolean, error?: string, row: object } | null>} The
 *   mirror outcome, or null when there was no authoritative row to mirror.
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

  const result = await mirror(
    "documents",
    authoritativeDocumentRow(authoritative, userId),
    userId,
    event,
  );

  return { ...result, row: authoritative };
}

async function syncReminder(userId, reminder, event = "UPDATE") {
  const row = reminderRow(reminder, userId);
  await mirror("reminders", row, userId, event);
}

async function deleteRecord(table, id, userId, row = {}) {
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    console.error(`Supabase ${table} delete mirror failed`, {
      userId,
      recordId: id,
      error: error.message,
    });
  }
  broadcastToUser(userId, table, {
    eventType: "DELETE",
    new: null,
    old: { id, user_id: userId, ...row },
  });
}

async function syncProfile(userId, profile) {
  const { error } = await supabaseAdmin.from("profiles").upsert({
    id: userId,
    user_id: userId,
    name: profile.name,
    email: profile.email,
    notifications_enabled: profile.notifyPush,
    email_alerts: profile.notifyEmail,
    expiry_alerts: profile.notifyExpiry,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Supabase profile mirror failed", {
      userId,
      error: error.message,
    });
  }
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
};
