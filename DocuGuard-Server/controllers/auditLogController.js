const db = require("../config/db");

const ACTION_TO_EVENT = {
  UPLOAD: { eventType: "doc_create", category: "data_modification" },
  MODIFY: { eventType: "doc_update", category: "data_modification" },
  ACCESS: { eventType: "doc_read", category: "data_access" },
  DELETE: { eventType: "doc_delete", category: "data_deletion" },
};

const EVENT_TO_ACTION = {
  doc_create: "UPLOAD",
  doc_update: "MODIFY",
  doc_read: "ACCESS",
  doc_delete: "DELETE",
  doc_sync: "ACCESS",
  doc_verify: "MODIFY",
  doc_ocr: "ACCESS",
};

function normalizeDetails(details) {
  if (details == null) return {};
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === "object" ? parsed : { message: details };
    } catch {
      return { message: details };
    }
  }
  if (typeof details === "object") return details;
  return { value: String(details) };
}

exports.getAuditLogs = async (req, res) => {
  const userId = String(req.user.userId);

  try {
    const result = await db.query(
      `SELECT id, event_type, resource_id AS document_id, details, created_at
       FROM public.audit_log
       WHERE (user_id::text = $1 OR actor_user_id::text = $1)
         AND resource_type = 'document'
         AND event_type = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId, Object.keys(EVENT_TO_ACTION)],
    );

    const logs = result.rows.map((row) => ({
      id: row.id,
      document_id: row.document_id ?? "Unknown",
      action: EVENT_TO_ACTION[row.event_type] || row.event_type,
      details: row.details,
      created_at: row.created_at,
    }));

    return res.json({ logs });
  } catch (err) {
    console.error("Failed to fetch document audit logs:", err.message);
    return res.status(500).json({
      error: "Unable to load document activity history.",
      code: "AUDIT_LOGS_UNAVAILABLE",
    });
  }
};

exports.createAuditLog = async (req, res) => {
  const userId = String(req.user.userId);
  const { document_id: documentId, action, details } = req.body || {};

  if (documentId == null || String(documentId).trim() === "") {
    return res.status(400).json({ error: "document_id is required." });
  }

  const mapped = ACTION_TO_EVENT[action];
  if (!mapped) {
    return res.status(400).json({ error: "Invalid audit action." });
  }

  const ipAddress = req.ip || req.connection?.remoteAddress || null;
  const userAgent = req.headers["user-agent"] || null;
  const payloadDetails = {
    ...normalizeDetails(details),
    source: "client_document_activity",
    clientAction: action,
  };

  try {
    const result = await db.query(
      `INSERT INTO public.audit_log
         (user_id, actor_user_id, event_type, event_category, resource_type,
          resource_id, ip_address, user_agent, outcome, details)
       VALUES ($1::text, $2::text, $3, $4, 'document', $5, $6, $7, 'success', $8::jsonb)
       RETURNING id, event_type, resource_id AS document_id, details, created_at`,
      [
        userId,
        userId,
        mapped.eventType,
        mapped.category,
        String(documentId),
        ipAddress,
        userAgent,
        JSON.stringify(payloadDetails),
      ],
    );

    const row = result.rows[0];
    return res.status(201).json({
      log: {
        id: row.id,
        document_id: row.document_id,
        action: EVENT_TO_ACTION[row.event_type] || action,
        details: row.details,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error("Failed to create document audit log:", err.message);
    return res.status(500).json({
      error: "Unable to record document activity.",
      code: "AUDIT_LOG_CREATE_FAILED",
    });
  }
};
