const db = require("../config/db");

const ALLOWED_ACTIONS = new Set(["UPLOAD", "MODIFY", "ACCESS", "DELETE"]);

function normalizeDetails(details) {
  if (details == null) return null;
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return { message: details };
    }
  }
  if (typeof details === "object") return details;
  return { value: String(details) };
}

exports.getAuditLogs = async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT id, document_id, action, details, created_at
       FROM public.document_audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId],
    );

    return res.json({ logs: result.rows });
  } catch (err) {
    console.error("Failed to fetch document audit logs:", err.message);
    return res.status(500).json({
      error: "Unable to load document activity history.",
      code: "AUDIT_LOGS_UNAVAILABLE",
    });
  }
};

exports.createAuditLog = async (req, res) => {
  const userId = req.user.userId;
  const { document_id: documentId, action, details } = req.body || {};

  if (!documentId || typeof documentId !== "string") {
    return res.status(400).json({ error: "document_id is required." });
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: "Invalid audit action." });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.document_audit_logs (user_id, document_id, action, details)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, document_id, action, details, created_at`,
      [userId, documentId, action, JSON.stringify(normalizeDetails(details))],
    );

    return res.status(201).json({ log: result.rows[0] });
  } catch (err) {
    console.error("Failed to create document audit log:", err.message);
    return res.status(500).json({
      error: "Unable to record document activity.",
      code: "AUDIT_LOG_CREATE_FAILED",
    });
  }
};
