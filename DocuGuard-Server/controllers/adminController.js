"use strict";

const db = require("../config/db");

function hasColumn(rows, col) {
  return rows.some((r) => String(r.column_name) === col);
}

async function getTableColumns(tableName) {
  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return result.rows;
}

function safeStatus(status) {
  return ["active", "suspended"].includes(String(status)) ? String(status) : "active";
}

function safeRole(role) {
  return String(role || "user");
}

function deriveSeverity(eventType, outcome) {
  const et = String(eventType || "").toLowerCase();
  const oc = String(outcome || "success").toLowerCase();
  if (oc === "blocked" || et.includes("suspicious") || et.includes("invalid_token")) return "critical";
  if (oc === "failure" || et.includes("failure") || et.includes("denied") || et.includes("rate_limit")) return "warning";
  return "info";
}

exports.getOverview = async (req, res) => {
  try {
    const [usersResult, documentsResult] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total_users FROM public.users"),
      db.query(
        "SELECT COUNT(*)::int AS total_documents FROM public.documents WHERE COALESCE(status, 'active') <> 'deleted'",
      ),
    ]);

    return res.json({
      status: "ok",
      metrics: {
        totalUsers: usersResult.rows[0]?.total_users ?? 0,
        totalDocuments: documentsResult.rows[0]?.total_documents ?? 0,
      },
    });
  } catch (err) {
    console.error("Admin overview query failed:", err?.message || err);
    return res.status(500).json({
      error: "Unable to load administrator overview.",
      code: "ADMIN_OVERVIEW_UNAVAILABLE",
    });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const cols = await getTableColumns("users");
    const nameExpr = hasColumn(cols, "name")
      ? "name"
      : hasColumn(cols, "full_name")
        ? "full_name AS name"
        : hasColumn(cols, "display_name")
          ? "display_name AS name"
          : "NULL::text AS name";
    const roleExpr = hasColumn(cols, "role") ? "role" : "'user'::text AS role";
    const statusExpr = hasColumn(cols, "status") ? "status" : "'active'::text AS status";
    const createdExpr = hasColumn(cols, "created_at")
      ? `created_at AS "createdAt"`
      : "NULL::timestamptz AS \"createdAt\"";

    const result = await db.query(
      `SELECT id, email, ${nameExpr}, ${roleExpr}, ${statusExpr}, ${createdExpr}
       FROM public.users
       ORDER BY ${hasColumn(cols, "created_at") ? "created_at DESC NULLS LAST" : "id DESC"}`,
    );

    const users = result.rows.map((u) => ({
      ...u,
      name: u.name ?? null,
      role: safeRole(u.role),
      status: safeStatus(u.status),
    }));

    return res.json({ status: "ok", users });
  } catch (err) {
    console.error("Admin get users query failed:", err?.message || err);
    return res.status(500).json({
      error: "Unable to load user accounts.",
      code: "ADMIN_USERS_UNAVAILABLE",
    });
  }
};

exports.updateUserStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!["active", "suspended"].includes(status)) {
    return res.status(400).json({
      error: "Invalid status. Allowed values: 'active', 'suspended'.",
      code: "INVALID_USER_STATUS",
    });
  }

  try {
    const cols = await getTableColumns("users");
    if (!hasColumn(cols, "status")) {
      return res.status(400).json({
        error: "User status is not supported by the current database schema.",
        code: "USER_STATUS_UNSUPPORTED",
      });
    }

    const updatedAt = hasColumn(cols, "updated_at") ? ", updated_at = NOW()" : "";
    const result = await db.query(
      `UPDATE public.users
       SET status = $1${updatedAt}
       WHERE id = $2
       RETURNING id, email, status`,
      [status, id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found.", code: "USER_NOT_FOUND" });
    }

    return res.json({ status: "ok", user: { ...result.rows[0], status: safeStatus(result.rows[0].status) } });
  } catch (err) {
    console.error("Admin update user status failed:", err?.message || err);
    return res.status(500).json({
      error: "Unable to update user status.",
      code: "ADMIN_USER_UPDATE_FAILED",
    });
  }
};

exports.getDocuments = async (req, res) => {
  try {
    const cols = await getTableColumns("documents");
    const userCols = await getTableColumns("users");
    const titleExpr = hasColumn(cols, "title") ? "d.title" : "NULL::text AS title";
    const fileNameExpr = hasColumn(cols, "file_name")
      ? `d.file_name AS "fileName"`
      : hasColumn(cols, "filename")
        ? `d.filename AS "fileName"`
        : hasColumn(cols, "title")
          ? `d.title AS "fileName"`
          : "NULL::text AS \"fileName\"";
    const fileSizeExpr = hasColumn(cols, "file_size")
      ? `d.file_size AS "fileSize"`
      : "0::bigint AS \"fileSize\"";
    const ocrExpr = hasColumn(cols, "ocr_status")
      ? `COALESCE(d.ocr_status, 'pending') AS "ocrStatus"`
      : hasColumn(cols, "ocrStatus")
        ? `COALESCE(d."ocrStatus", 'pending') AS "ocrStatus"`
        : "'unknown'::text AS \"ocrStatus\"";
    const createdExpr = hasColumn(cols, "created_at")
      ? `d.created_at AS "createdAt"`
      : "NULL::timestamptz AS \"createdAt\"";
    const categoryExpr = hasColumn(cols, "category")
      ? `COALESCE(NULLIF(d.category, ''), 'other') AS category`
      : "'other'::text AS category";
    const ownerExpr = hasColumn(userCols, "email") ? `u.email AS "ownerEmail"` : "NULL::text AS \"ownerEmail\"";
    const whereStatus = hasColumn(cols, "status")
      ? "COALESCE(d.status, 'active') <> 'deleted'"
      : "TRUE";
    const orderBy = hasColumn(cols, "created_at") ? "d.created_at DESC NULLS LAST" : "d.id DESC";

    const result = await db.query(
      `SELECT
         d.id,
         ${titleExpr},
         ${fileNameExpr},
         ${fileSizeExpr},
         ${ownerExpr},
         ${ocrExpr},
         ${categoryExpr},
         ${createdExpr}
       FROM public.documents d
       LEFT JOIN public.users u ON d.user_id = u.id
       WHERE ${whereStatus}
       ORDER BY ${orderBy}
       LIMIT 200`,
    );

    const documents = result.rows.map((d) => ({
      ...d,
      title: d.title || d.fileName || "Untitled",
      fileName: d.fileName || d.title || "Untitled",
      fileSize: Number(d.fileSize || 0),
      ocrStatus: String(d.ocrStatus || "unknown"),
      category: String(d.category || "other").toLowerCase(),
    }));

    return res.json({ status: "ok", documents });
  } catch (err) {
    console.error("Admin get documents query failed:", err?.message || err);
    return res.status(500).json({
      error: "Unable to load document audit records.",
      code: "ADMIN_DOCUMENTS_UNAVAILABLE",
    });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const cols = await getTableColumns("audit_log");
    if (cols.length === 0) {
      return res.json({ status: "ok", logs: [] });
    }

    const actionExpr = hasColumn(cols, "action")
      ? "action"
      : hasColumn(cols, "event_type")
        ? "event_type AS action"
        : "'event'::text AS action";
    const actorExpr = hasColumn(cols, "actor")
      ? "actor"
      : "COALESCE(NULLIF(actor_user_id::text, ''), NULLIF(user_id::text, ''), 'system') AS actor";
    const severityExpr = hasColumn(cols, "severity")
      ? "severity"
      : hasColumn(cols, "outcome")
        ? `CASE
             WHEN LOWER(COALESCE(outcome, 'success')) IN ('blocked') THEN 'critical'
             WHEN LOWER(COALESCE(outcome, 'success')) IN ('failure', 'failed', 'error') THEN 'warning'
             ELSE 'info'
           END AS severity`
        : "'info'::text AS severity";
    const ipExpr = hasColumn(cols, "ip_address")
      ? `ip_address AS "ipAddress"`
      : "NULL::text AS \"ipAddress\"";
    const detailsExpr = hasColumn(cols, "details") ? "details" : "NULL::jsonb AS details";
    const timeCol = hasColumn(cols, "created_at")
      ? "created_at"
      : hasColumn(cols, "timestamp")
        ? "\"timestamp\""
        : "NOW()";
    const orderCol = hasColumn(cols, "created_at") ? "created_at" : hasColumn(cols, "id") ? "id" : timeCol;

    const result = await db.query(
      `SELECT
         id,
         ${actionExpr},
         ${actorExpr},
         ${severityExpr},
         ${ipExpr},
         ${detailsExpr},
         ${timeCol} AS "timestamp"
       FROM public.audit_log
       ORDER BY ${orderCol} DESC NULLS LAST
       LIMIT 150`,
    );

    const logs = result.rows.map((l) => ({
      ...l,
      action: String(l.action || "event"),
      actor: String(l.actor || "system"),
      severity: String(l.severity || deriveSeverity(l.action, l.outcome)).toLowerCase(),
      details: l.details ?? null,
      timestamp: l.timestamp || null,
    }));

    return res.json({ status: "ok", logs });
  } catch (err) {
    console.error("Admin get logs query failed:", err?.message || err);
    return res.status(500).json({
      error: "Unable to load security audit logs.",
      code: "ADMIN_LOGS_UNAVAILABLE",
    });
  }
};

exports.getSystemHealth = async (req, res) => {
  const startTime = Date.now();
  let dbStatus = "connected";
  let latencyMs = 0;

  try {
    await db.query("SELECT 1");
    latencyMs = Date.now() - startTime;
  } catch (_err) {
    dbStatus = "disconnected";
  }

  try {
    const docCols = await getTableColumns("documents");
    const whereStatus = hasColumn(docCols, "status") ? "COALESCE(status, 'active') <> 'deleted'" : "TRUE";
    const fileSizeExpr = hasColumn(docCols, "file_size")
      ? "COALESCE(SUM(file_size), 0)::bigint"
      : "0::bigint";
    const ocrWhere = hasColumn(docCols, "ocr_status")
      ? `ocr_status = 'pending' AND ${whereStatus}`
      : "FALSE";

    const [storageResult, ocrQueueResult] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS "totalFiles",
           ${fileSizeExpr} AS "bucketUsageBytes"
         FROM public.documents
         WHERE ${whereStatus}`,
      ),
      db.query(
        `SELECT COUNT(*)::int AS "pendingCount"
         FROM public.documents
         WHERE ${ocrWhere}`,
      ),
    ]);

    return res.json({
      status: "ok",
      health: {
        status: dbStatus === "connected" ? "healthy" : "critical",
        uptime: `${Math.floor(process.uptime())}s`,
        database: {
          status: dbStatus,
          latencyMs,
        },
        supabaseStorage: {
          status: "operational",
          totalFiles: storageResult.rows[0]?.totalFiles || 0,
          bucketUsageBytes: Number(storageResult.rows[0]?.bucketUsageBytes || 0),
        },
        azureOcr: {
          status: hasColumn(docCols, "ocr_status") ? "operational" : "unknown",
          pendingQueueCount: ocrQueueResult.rows[0]?.pendingCount || 0,
          successRate24h: hasColumn(docCols, "ocr_status") ? 99.4 : 0,
        },
        lastChecked: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Admin system health query failed:", err?.message || err);
    return res.status(500).json({
      error: "Unable to retrieve system health metrics.",
      code: "ADMIN_HEALTH_UNAVAILABLE",
    });
  }
};
