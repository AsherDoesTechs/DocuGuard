const db = require("../config/db");
const { ErrorCodes } = require("../utils/errorCodes");
const { debug, warn, error: logError } = require("../utils/debugLogger");

/**
 * Full-text search over document content (OCR data + title).
 *
 * Searches the per-user `search_vector` generated column using a plain
 * to_tsquery. Results are ranked by relevance (ts_rank) and scoped to the
 * authenticated user's non-deleted documents.
 */
exports.searchDocuments = async (req, res) => {
  const userId = req.user.userId;
  const { q } = req.query;

  if (!q || typeof q !== "string" || q.trim() === "") {
    return res.status(400).json({
      error: "Search query is required",
      code: ErrorCodes.DOC_VALIDATION,
    });
  }

  const query = q.trim();

  try {
    const result = await db.query(
      `
      SELECT id, title, category, issuer, document_number AS "documentNumber",
             issue_date AS "issueDate", expiry_date AS "expiryDate", notes,
             status, enable_alerts AS "enableAlerts",
             file_url AS "fileUrl", file_type AS "fileType", s3_key AS "s3Key",
             processing_status AS "processingStatus", risk_score AS "riskScore",
             risk_level AS "riskLevel",
             ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
      FROM documents
      WHERE user_id = $1
        AND status <> 'deleted'
        AND search_vector @@ plainto_tsquery('english', $2)
      ORDER BY rank DESC, updated_at DESC
      LIMIT 50
      `,
      [userId, query],
    );

    debug("Search", "Search executed", { userId, query, results: result.rows.length });

    res.json({
      query,
      results: result.rows.map((row) => {
        const { rank, ...doc } = row;
        return { ...doc, relevance: Number(rank) };
      }),
      count: result.rows.length,
    });
  } catch (err) {
    logError("Search", "Search query failed", {
      error: err.message,
      stack: err.stack,
      userId,
      query,
    }, ErrorCodes.DB_QUERY_FAILED);
    res.status(500).json({
      error: "Server error searching documents",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};
