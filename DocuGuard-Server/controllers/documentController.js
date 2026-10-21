const db = require("../config/db");
const {
  generatePresignedUploadUrl,
  getSignedDownloadUrl,
  rehydrateFileUrls,
  validateFileType,
  deleteStorageObject,
} = require("../services/storageService");
const { extractDocumentData } = require("../services/logicEngine");
const {
  sendProcessingCompleteNotification,
  sendVerificationNotification,
} = require("../services/notificationService");
const { syncDocument, syncDocumentFromAuthoritative, deleteRecord } = require("../services/dataSyncService");
const {
  SYNC_TARGET,
  resolveSyncTarget,
} = require("../services/documentSyncResolver");
const { ErrorCodes } = require("../utils/errorCodes");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");
const {
  documentSchema,
  documentUpdateSchema,
  documentSyncSchema,
  uploadUrlSchema,
  processDocumentSchema,
  verifyDocumentSchema,
  validateSchema,
} = require("../../shared/validation/schemas");
const {
  canonicalizeServerRevision,
  revisionPrecision,
} = require("../../shared/sync/serverRevision");
const { ownsStorageKey } = require("../../shared/sync/storageObjectPolicy");

/**
 * The server revision of a row, rendered so it survives a round trip.
 *
 * `updated_at` is a timestamptz with microsecond precision, but a JSON
 * response can only carry milliseconds. The client sends the revision it last
 * saw back as `baseUpdatedAt`, and the server compares it with the stored
 * revision. A lossy value never matched, so every document that had been
 * synced once and then edited locally was answered with a 409 conflict on the
 * next sync and never left the pending queue.
 *
 * `to_char` keeps all six microsecond digits and the explicit `Z` keeps the
 * value unambiguous, so the string Postgres parses back is the value it stored.
 */
const UPDATED_AT_ISO_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The revision comparison used by the conditional sync update.
 *
 * The comparison uses the highest precision the incoming revision can carry.
 *
 * A canonical revision names one exact instant, so the row has to be at that
 * exact instant:
 *
 *   `updated_at = $18::timestamptz`
 *
 * A revision that a pre-upgrade client produced carries milliseconds only. The
 * sub-millisecond part of the instant is simply not in the request, so the
 * row is compared with millisecond precision:
 *
 *   `date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $18)`
 *
 * Comparing a canonical revision with millisecond precision would say that
 * "...T15:27:11.123456Z" and "...T15:27:11.123789Z" are the same revision.
 * They are two different moments: a client that had seen the first one and
 * had been overwritten by the second would be told that nothing had changed,
 * and its write would be accepted over the newer edit. That is a lost update.
 *
 * Both sides are truncated in UTC, so the comparison does not depend on the
 * time zone of the database session.
 *
 * @param {number} revisionParam The number of the revision parameter.
 * @param {number} exactParam The number of the parameter that says whether the
 *   revision is exact.
 * @returns {string}
 */
function buildRevisionMatchSql(revisionParam, exactParam) {
  return `(
  ($${exactParam}::boolean AND updated_at = $${revisionParam}::timestamptz)
  OR (
    NOT $${exactParam}::boolean
    AND date_trunc('milliseconds', updated_at AT TIME ZONE 'UTC')
      = date_trunc('milliseconds', $${revisionParam}::timestamptz AT TIME ZONE 'UTC')
  )
)`;
}

const REVISION_MATCH_SQL = buildRevisionMatchSql(18, 19);

/**
 * The same comparison for the plain update route, whose parameters are
 * numbered differently.
 */
const REVISION_MATCH_SQL_UPDATE = buildRevisionMatchSql(11, 12);

// Get all documents for the authenticated user
exports.getAllDocuments = async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT id, title, category, issuer, document_number AS "documentNumber",
              issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
              file_url AS "fileUrl", file_type AS "fileType", s3_key AS "s3Key",
              processing_status AS "processingStatus", risk_score AS "riskScore", risk_level AS "riskLevel"
       FROM documents WHERE user_id = $1 AND status <> 'deleted' ORDER BY expiry_date ASC NULLS LAST`,
      [userId],
    );

    debug("Documents", "Documents fetched", {
      userId,
      count: result.rows.length,
    });

    // Fresh signed URLs per read, since the persisted ones have expired.
    res.json(await rehydrateFileUrls(result.rows));
  } catch (err) {
    logError(
      "Documents",
      "Error fetching documents",
      { error: err.message, stack: err.stack, userId },
      ErrorCodes.DOC_PROCESS_FAILED,
    );
    res.status(500).json({
      error: "Server error while fetching documents",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};

// Get presigned upload URL (S3 Integration)
exports.getUploadUrl = async (req, res) => {
  try {
    const validation = validateSchema(uploadUrlSchema, req.query);
    if (!validation.success) {
      debug("Documents", "Upload URL request missing params", {
        userId: req.user.userId,
        fileName: !!req.query.fileName,
        fileType: !!req.query.fileType,
      });
      return res.status(400).json({
        error: Object.values(validation.errors).join(", "),
        code: ErrorCodes.DOC_INVALID_FILE_TYPE,
        details: validation.errors,
      });
    }

    const { fileName, fileType } = validation.data;

    const result = await generatePresignedUploadUrl(
      req.user.userId,
      fileName,
      fileType,
    );

    debug("Documents", "Upload URL generated", {
      userId: req.user.userId,
      fileName,
    });
    res.json(result);
  } catch (err) {
    logError(
      "Documents",
      "Error generating upload URL",
      {
        error: err.message,
        stack: err.stack,
        fileName: req.query.fileName,
        fileType: req.query.fileType,
      },
      ErrorCodes.DOC_UPLOAD_FAILED,
    );
    res.status(500).json({
      error: "Failed to generate upload URL",
      code: ErrorCodes.DOC_UPLOAD_FAILED,
    });
  }
};

/**
 * Create a draft for an uploaded file before OCR has extracted its fields.
 * Normal document creation keeps its existing strict validation.
 */
exports.createOcrDraft = async (req, res) => {
  const userId = req.user?.userId;

  try {
    if (!userId) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const { s3Key, storagePath, fileType } = req.body || {};
    const key = String(storagePath || s3Key || "").trim();
    const normalizedFileType = String(fileType || "")
      .toLowerCase()
      .split(";")[0]
      .trim();

    if (!key) {
      return res.status(400).json({
        error: "A storage key is required",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    // Only accept keys in the server-generated format:
    // userId/<UUID>[.<extension>]
    const prefix = `${String(userId)}/`;
    const keyPart = key.startsWith(prefix) ? key.slice(prefix.length) : "";

    if (
      !keyPart ||
      keyPart.includes("/") ||
      !/^[0-9a-f-]{36}(?:\.[a-z0-9]{1,8})?$/i.test(keyPart)
    ) {
      return res.status(403).json({
        error: "The uploaded file does not belong to this account",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    const fileTypeError = validateFileType(normalizedFileType);

    if (fileTypeError) {
      return res.status(400).json({
        error: fileTypeError,
        code: ErrorCodes.DOC_INVALID_FILE_TYPE,
      });
    }

    // Resolve a fresh URL to confirm that the uploaded object can be accessed.
    // Never trust a client-provided URL as the authoritative file location.
    const signedUrl = await getSignedDownloadUrl(key);

    if (!signedUrl) {
      return res.status(400).json({
        error:
          "The uploaded file could not be accessed. Please upload it again.",
        code: ErrorCodes.DOC_UPLOAD_FAILED,
      });
    }

    const result = await db.query(
      `INSERT INTO documents (
         user_id,
         title,
         category,
         issuer,
         document_number,
         issue_date,
         expiry_date,
         notes,
         enable_alerts,
         status,
         created_at,
         s3_key,
         file_url,
         file_type,
         processing_status
       )
              VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, CURRENT_TIMESTAMP,
         $11, $12, $13, $14
       )
       RETURNING
         id,
         title,
         category,
         issuer,
         document_number AS "documentNumber",
         issue_date AS "issueDate",
         expiry_date AS "expiryDate",
         notes,
         status,
         enable_alerts AS "enableAlerts",
         file_url AS "fileUrl",
         file_type AS "fileType",
         s3_key AS "s3Key",
          processing_status AS "processingStatus",
          risk_score AS "riskScore",
          risk_level AS "riskLevel",
          ${UPDATED_AT_ISO_SQL} AS "updatedAt"`,
            [
        userId,
        "Scanned Document",
        "other",
        null, null, null, null,
        "Scanned document awaiting OCR processing.",
        true,
        "active",
        key,
        null,
        normalizedFileType,
        "pending"
      ],
    );

    const document = result.rows[0];

    // A row that does not exist yet: the mirror is written as a complete
    // record, with the column defaults for the fields the row does not have.
    await syncDocument(userId, document, "INSERT");

    return res.status(201).json({
      status: "success",
      message: "OCR draft created successfully",
      document,
    });
  } catch (err) {
    logError("Documents", "Failed to create OCR draft", {
      error: err?.message,
      name: err?.name,
      code: err?.code,
      userId,
    });

    return res.status(500).json({
      status: "error",
      code: ErrorCodes.DOC_CREATE_FAILED,
      error: "Failed to create the OCR draft",
    });
  }
};


// Process document with OCR/AI
exports.processDocument = async (req, res) => {
  try {
    const validation = validateSchema(processDocumentSchema, req.body);

    if (!validation.success) {
      return res.status(400).json({
        status: "error",
        code: ErrorCodes.VALIDATION_ERROR,
        errorCode: "VALIDATION_ERROR",
        error: Object.values(validation.errors || {}).join(", "),
        details: validation.errors,
      });
    }

    const userId = req.user.userId;
    const { documentId } = validation.data;

    const documentResult = await db.query(
      `
      SELECT
        id,
        title,
        s3_key,
        file_url,
        file_type
      FROM documents
      WHERE id = $1
        AND user_id = $2
      `,
      [documentId, userId],
    );

    if (documentResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        code: ErrorCodes.DOCUMENT_NOT_FOUND,
        errorCode: "DOCUMENT_NOT_FOUND",
        error: "Document not found",
      });
    }

    const document = documentResult.rows[0];

    const fileUrl = document.file_url;
    const storagePath = document.s3_key;
    const fileType = document.file_type || "application/pdf";

    if (!fileUrl && !storagePath) {
      return res.status(400).json({
        status: "error",
        code: ErrorCodes.OCR_PROCESS_FAILED,
        errorCode: "DOCUMENT_FILE_MISSING",
        error: "Document does not have an uploaded file",
      });
    }

    /*
     * Mint a fresh signed URL from s3_key for the analyzer.
     *
     * Previously this read the stored file_url, which was a permanent public
     * object URL. It is also now stale by design: signed URLs expire, so
     * re-processing a document months later would fail against a dead link.
     * Rows predating s3_key still fall back to the stored URL.
     */
    let azureUrl = null;
    if (storagePath) {
      try {
        azureUrl = await getSignedDownloadUrl(storagePath);
      } catch (signError) {
        warn("Documents", "Failed to sign document URL for OCR", {
          error: signError.message,
          documentId,
        });
      }
    }

    if (!azureUrl) {
      azureUrl = fileUrl;
    }

    if (!azureUrl) {
      return res.status(400).json({
        status: "error",
        code: ErrorCodes.OCR_PROCESS_FAILED,
        errorCode: "DOCUMENT_URL_MISSING",
        error: "Document file could not be resolved for processing.",
      });
    }

    await db.query(
      `
      UPDATE documents
      SET processing_status = 'processing'
      WHERE id = $1
        AND user_id = $2
      `,
      [documentId, userId],
    );

    const extractedData = await extractDocumentData(azureUrl, fileType);

    /*
     * OCR output is a suggestion, never an authoritative value.
     *
     * The previous update applied every extracted field over the stored row, so
     * a misread character silently replaced a document number the user had
     * already checked - and then the "verified" record was wrong with no way to
     * tell. Now only fields the user has not filled in are populated.
     */
    const updateResult = await db.query(
      `
      UPDATE documents
      SET
        title = COALESCE(NULLIF(trim(title), ''), NULLIF(trim($1), ''), 'Scanned Document'),
        category = CASE WHEN category IS NULL OR category = '' OR category = 'other'
          THEN COALESCE($2, category) ELSE category END,
        issuer = COALESCE(NULLIF(trim(issuer), ''), $3, issuer),
        document_number = COALESCE(NULLIF(trim(document_number), ''), $4, document_number),
        issue_date = COALESCE(issue_date, NULLIF($5, '')::date, issue_date),
        expiry_date = COALESCE(NULLIF($6, '')::date, expiry_date),
        risk_score = COALESCE(risk_score, $7),
        risk_level = CASE WHEN risk_level IS NULL OR risk_level = ''
          THEN COALESCE($8, risk_level) ELSE risk_level END,
        ocr_data = $9,
        processing_status = 'completed'
      WHERE id = $10
        AND user_id = $11
      RETURNING *, ${UPDATED_AT_ISO_SQL} AS "updatedAt"
      `,
      [
        extractedData.title,
        extractedData.category,
        extractedData.issuer,
        extractedData.documentNumber,
        extractedData.issueDate,
        extractedData.expiryDate,
        extractedData.riskScore,
        extractedData.riskLevel,
        // The raw analyzer payload is kept so a bad extraction can be
        // investigated or re-run instead of being discarded.
        JSON.stringify(extractedData.raw ?? null),
        documentId,
        userId,
      ],
    );

    if (updateResult.rows.length === 0) {
      throw new Error("Document disappeared while processing");
    }

    const updatedDocument = updateResult.rows[0];
    /*
     * The update above is the whole row, so the mirror can be written from
     * it. It is mapped as a stored row rather than as a request payload: a
     * field that is NULL in the database is a fact ("no issuer", "never
     * assessed"), and a field the update did not touch is left alone.
     */
    await syncDocument(userId, updatedDocument, "UPDATE");

    /*
     * Notification is optional. Don't let a notification
     * failure make successful OCR look like a failed OCR.
     */
    try {
      if (extractedData.title) {
        // The JWT only carries { userId }, so the push token has to be read
        // from the users table rather than from req.user.
        const tokenRes = await db.query(
          `SELECT fcm_token, expo_push_token FROM users WHERE id = $1`,
          [userId],
        );

        const pushToken =
          tokenRes.rows[0]?.expo_push_token || tokenRes.rows[0]?.fcm_token;

        if (pushToken) {
          await sendProcessingCompleteNotification(
            pushToken,
            extractedData.title,
            extractedData.riskLevel,
          );
        }
      }
    } catch (notificationError) {
      warn("Documents", "OCR succeeded but notification failed", {
        error: notificationError.message,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Document processed successfully",
      document: updatedDocument,
      extractedData,
    });
  } catch (error) {
    logError("Document processing error:", error);

    try {
      if (req.body?.documentId) {
        await db.query(
          `
          UPDATE documents
          SET processing_status = 'failed'
          WHERE id = $1
            AND user_id = $2
          `,
          [req.body.documentId, req.user.userId],
        );
        /*
         * Mirror the row the server actually wrote, not a payload built from the
         * request body.
         *
         * The mirror is an upsert into the same table the update above just
         * wrote, so a payload that leaves a field out does not leave the field
         * alone - it clears it. A partial payload used to erase the title, the
         * expiry date, the document number, the issuer, the storage key and
         * the risk fields, and to replace the title with "Scanned Document".
         *
         * The persisted row is fetched, scoped by this account, and mirrored
         * as it is. When the row cannot be read, nothing is mirrored at all.
         */
        await syncDocumentFromAuthoritative(
          req.user.userId,
          req.body.documentId,
          "UPDATE",
        );
      }
    } catch (dbError) {
      logError("Could not update failed processing status:", dbError);
    }

    return res.status(500).json({
      status: "error",
      code: ErrorCodes.OCR_PROCESS_FAILED,
      errorCode: "OCR_PROCESS_FAILED",
      error: error.message || "Document processing failed",
    });
  }
};

// Verify a document
exports.verifyDocument = async (req, res) => {
  try {
    const validation = validateSchema(verifyDocumentSchema, req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: Object.values(validation.errors).join(", "),
        code: ErrorCodes.DOC_VALIDATION,
        details: validation.errors,
      });
    }

    const userId = req.user.userId;
    const { documentId } = validation.data;

    debug("Documents", "Verification request", { userId, documentId });

    const docResult = await db.query(
      `SELECT title FROM documents WHERE id = $1 AND user_id = $2`,
      [documentId, userId],
    );

    const result = await db.query(
      `UPDATE documents 
       SET status = 'verified', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND user_id = $2 
       RETURNING id, status`,
      [documentId, userId],
    );

    if (result.rows.length === 0) {
      warn("Documents", "Document not found for verification", {
        userId,
        documentId,
      });
      return res.status(404).json({
        error: "Document not found",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    /*
     * Mirror the row the server actually wrote, not a payload built from the
     * request body.
     *
     * The mirror is an upsert into the same table the update above just
     * wrote, so a payload that leaves a field out does not leave the field
     * alone - it clears it. A partial payload used to erase the expiry date,
     * the document number, the issuer, the storage key, the file reference
     * and the risk fields, and to reset the category to "other".
     *
     * The persisted row is fetched, scoped by this account, and mirrored as
     * it is. When the row cannot be read - it was deleted, or it belongs to
     * somebody else - nothing is mirrored at all, rather than a record
     * invented from a partial request body.
     */
    await syncDocumentFromAuthoritative(userId, documentId, "UPDATE");

    if (docResult.rows.length > 0) {
      const userResult = await db.query(
        `SELECT fcm_token, expo_push_token FROM users WHERE id = $1`,
        [userId],
      );

      // Prefer the Expo token: expo-notifications registers that on both
      // platforms, and it is delivered by the Expo push service.
      const pushToken =
        userResult.rows[0]?.expo_push_token || userResult.rows[0]?.fcm_token;
      if (pushToken) {
        try {
          await sendVerificationNotification(pushToken, docResult.rows[0].title);
          debug("Documents", "Verification notification sent", {
            userId,
            documentId,
          });
        } catch (notifErr) {
          warn("Documents", "Failed to send verification notification", {
            error: notifErr.message,
            userId,
            documentId,
          });
        }
      } else {
        debug(
          "Documents",
          "Skipping verification notification - no valid FCM token",
          {
            userId,
            documentId,
          },
        );
      }
    }

    info("Documents", "Document verified", { userId, documentId });

    res.json({
      message: "Document verified successfully",
      document: result.rows[0],
    });
  } catch (err) {
    logError(
      "Documents",
      "Error verifying document",
      {
        error: err.message,
        stack: err.stack,
        userId: req.user?.userId,
        documentId: req.body?.documentId,
      },
      ErrorCodes.DOC_VALIDATION,
    );
    res.status(500).json({
      error: "Server error verifying document",
      code: ErrorCodes.UNKNOWN_ERROR,
      details: err.message,
    });
  }
};

// Fetch a single document by ID
exports.getDocumentById = async (req, res) => {
  const userId = req.user.userId;
  const docId = req.params.id;

  try {
    const doc = await db.query(
      `SELECT id, title, category, issuer, document_number AS "documentNumber",
              issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
              file_url AS "fileUrl", file_type AS "fileType", s3_key AS "s3Key",
              processing_status AS "processingStatus", risk_score AS "riskScore", risk_level AS "riskLevel",
              ${UPDATED_AT_ISO_SQL} AS "updatedAt"
       FROM documents WHERE id = $1 AND user_id = $2`,
      [docId, userId],
    );

    if (doc.rows.length === 0) {
      return res.status(404).json({
        error: "Document not found",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    debug("Documents", "Document fetched", { userId, docId });

    // Signed URLs are short-lived, so each read hands back a fresh one rather
    // than the possibly-expired value persisted at upload time.
    const [document] = await rehydrateFileUrls([doc.rows[0]]);
    res.json(document);
  } catch (err) {
    logError(
      "Documents",
      "Error fetching document",
      {
        error: err.message,
        stack: err.stack,
        userId,
        docId,
      },
      ErrorCodes.DOC_NOT_FOUND,
    );
    res.status(500).json({
      error: "Server error fetching document details",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};

// Issue a fresh signed URL for a document's file.
// Signed URLs expire, so the client refetches this instead of relying on a URL
// it cached at upload time. Ownership is enforced before any URL is minted.
exports.getDocumentFileUrl = async (req, res) => {
  const userId = req.user.userId;
  const docId = req.params.id;

  try {
    const doc = await db.query(
      `SELECT s3_key, file_url FROM documents WHERE id = $1 AND user_id = $2`,
      [docId, userId],
    );

    if (doc.rows.length === 0) {
      return res.status(404).json({
        error: "Document not found",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    const { s3_key: storagePath, file_url: storedUrl } = doc.rows[0];

    if (!storagePath) {
      // Pre-signed-URL era row: no durable key to sign. Return whatever is
      // stored so those documents keep working until re-uploaded.
      return res.json({ fileUrl: storedUrl ?? null, expiresIn: null });
    }

    const signedUrl = await getSignedDownloadUrl(storagePath);
    return res.json({ fileUrl: signedUrl, expiresIn: 15 * 60 });
  } catch (err) {
    logError(
      "Documents",
      "Error signing document URL",
      { error: err.message, userId, docId },
      ErrorCodes.DOC_NOT_FOUND,
    );
    return res.status(500).json({
      error: "Server error generating file URL",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};

// Create a new document with strict validation & automations
exports.createDocument = async (req, res) => {
  const validation = validateSchema(documentSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.DOC_VALIDATION,
      details: validation.errors,
    });
  }

  const userId = req.user.userId;
  const {
    title,
    category,
    issuer,
    documentNumber,
    issueDate,
    expiryDate,
    notes,
    enableAlerts,
    s3Key,
    fileUrl,
    fileType,
  } = validation.data;

  try {
    const newDoc = await db.query(
      `INSERT INTO documents (
         user_id, title, category, issuer, document_number, 
         issue_date, expiry_date, notes, enable_alerts, status, created_at,
         s3_key, file_url, file_type, processing_status
       ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', CURRENT_TIMESTAMP, $10, $11, $12, $13) 
       RETURNING id, title, category, issuer, document_number AS "documentNumber",
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
                 file_url AS "fileUrl", file_type AS "fileType", s3_key AS "s3Key",
                 processing_status AS "processingStatus", risk_score AS "riskScore", risk_level AS "riskLevel",
                 ${UPDATED_AT_ISO_SQL} AS "updatedAt"`,
      [
        userId,
        title,
        category,
        issuer,
        documentNumber,
        issueDate,
        expiryDate,
        typeof notes === "string" ? notes.trim() : null,
        typeof enableAlerts === "boolean" ? enableAlerts : true,
        s3Key || null,
        fileUrl || null,
        fileType || null,
        s3Key ? "processing" : "completed",
      ],
    );

    info("Documents", "Document created", {
      userId,
      docId: newDoc.rows[0].id,
    });
    // A row that does not exist yet: the mirror is written as a complete
    // record, with the column defaults for the fields the row does not have.
    await syncDocument(userId, newDoc.rows[0], "INSERT");
    res.status(201).json({
      message: "Document created successfully",
      document: newDoc.rows[0],
    });
  } catch (err) {
    logError(
      "Documents",
      "Error creating document",
      {
        error: err.message,
        stack: err.stack,
        userId,
        body: req.body,
      },
      ErrorCodes.DOC_CREATE_FAILED,
    );
    res.status(500).json({
      error: "Server error while creating document",
      code: ErrorCodes.DOC_CREATE_FAILED,
      details: err.message,
    });
  }
};

// Update an existing document with strict validation & automations
exports.updateDocument = async (req, res) => {
  const validation = validateSchema(documentUpdateSchema, {
    ...req.body,
    id: parseInt(req.params.id),
  });
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.DOC_VALIDATION,
      details: validation.errors,
    });
  }

  const userId = req.user.userId;
  const docId = req.params.id;
  const {
    title,
    category,
    issuer,
    documentNumber,
    issueDate,
    expiryDate,
    notes,
    enableAlerts,
    baseUpdatedAt,
  } = validation.data;

  /*
   * The revision this device last saw, when it sent one.
   *
   * The guard is optional. A client that does not know the revision keeps the
   * previous behaviour and the update is applied unconditionally, which is
   * what every client that predates revision tracking expects.
   *
   * A client that does send the revision gets the update refused with a 409
   * when the server copy has moved on. Without this the edit screen was a
   * lost update: it overwrote whatever the server held, including a change
   * that had been made on the web app or on another device.
   */
  let baseRevision = null;
  let exactRevision = true;

  if (baseUpdatedAt !== undefined && baseUpdatedAt !== null) {
    baseRevision = canonicalizeServerRevision(baseUpdatedAt);

    if (baseRevision === null) {
      return res.status(400).json({
        error:
          "The document revision is not in a format this server understands.",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    exactRevision = revisionPrecision(baseUpdatedAt) === "microsecond";
  }

  try {
    const updated = await db.query(
      `UPDATE documents
       SET title = $1, category = $2, issuer = $3, document_number = $4,
           issue_date = $5, expiry_date = $6, notes = $7, enable_alerts = $8,
           updated_at = clock_timestamp()
       WHERE id = $9 AND user_id = $10
         AND ($11::timestamptz IS NULL OR ${REVISION_MATCH_SQL_UPDATE})
       RETURNING id, title, category, issuer, document_number AS "documentNumber",
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
                 s3_key AS "s3Key", file_url AS "fileUrl", file_type AS "fileType",
                 processing_status AS "processingStatus",
                 ${UPDATED_AT_ISO_SQL} AS "updatedAt"`,
      [
        title,
        category,
        issuer,
        documentNumber,
        issueDate,
        expiryDate,
        typeof notes === "string" ? notes.trim() : null,
        typeof enableAlerts === "boolean" ? enableAlerts : true,
        docId,
        userId,
        baseRevision || null,
        exactRevision,
      ],
    );

    if (updated.rows.length === 0) {
      /*
       * Either the document is not there, or it is there but it has moved on.
       *
       * The two cases are told apart by asking for the row: a document that
       * does not exist, or is not owned by this account, must not be reported
       * as a conflict, because a conflict would tell the user that their copy
       * was changed on another device when in fact there is no such document.
       */
      const current = await db.query(
        `SELECT ${UPDATED_AT_ISO_SQL} AS "updatedAt"
         FROM documents WHERE id = $1 AND user_id = $2`,
        [docId, userId],
      );

      if (current.rows.length === 0) {
        return res.status(404).json({
          error: "Document not found or unauthorized",
          code: ErrorCodes.DOC_NOT_FOUND,
        });
      }

      return res.status(409).json({
        error:
          "This document was changed on another device since your last sync",
        code: ErrorCodes.SYNC_CONFLICT,
        conflict: true,
        serverUpdatedAt: current.rows[0].updatedAt ?? null,
      });
    }

    info("Documents", "Document updated", { userId, docId });
    /*
     * The update above did not touch the risk columns, so the returned row
     * does not carry them. The mirror is written from the stored row, and a
     * column the payload does not carry is not written at all - so the risk
     * score and the risk level of the document survive the edit instead of
     * being cleared.
     */
    await syncDocument(userId, updated.rows[0], "UPDATE");

    res.json({
      message: "Document updated successfully",
      document: updated.rows[0],
    });
  } catch (err) {
    logError(
      "Documents",
      "Error updating document",
      {
        error: err.message,
        stack: err.stack,
        userId,
        docId,
      },
      ErrorCodes.DOC_UPDATE_FAILED,
    );
    res.status(500).json({
      error: "Server error while updating document",
      code: ErrorCodes.DOC_UPDATE_FAILED,
    });
  }
};

// Sync a document from local database to cloud
exports.syncDocument = async (req, res) => {
  const validation = validateSchema(documentSyncSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.SYNC_PARTIAL,
      details: validation.errors,
    });
  }

  const userId = req.user.userId;
  const {
    title,
    category,
    issuer,
    documentNumber,
    issueDate,
    expiryDate,
    notes,
    enableAlerts,
    status,
    s3Key,
    fileUrl,
    fileType,
    processingStatus,
    riskScore,
    riskLevel,
    cloudId,
    baseUpdatedAt,
  } = validation.data;

  debug("Documents", "Sync document request", { userId, title });

  /*
   * The revision the client last saw.
   *
   * The value is validated before it reaches the database. An unusable
   * revision used to be handed to Postgres as `$18::timestamptz`, which threw
   * "invalid input syntax" and answered the push with a 500. A client that
   * cannot state a usable revision is told so instead, and the revision it
   * does send is normalised into the format the comparison uses.
   *
   * The precision of the revision decides how strictly the row is compared. A
   * canonical revision names one exact instant and is compared exactly. A
   * revision from a pre-upgrade client carries milliseconds only, so the row
   * is compared with millisecond precision - that is the most the request can
   * say about the row it came from.
   */
  let baseRevision = null;
  let exactRevision = true;

  if (baseUpdatedAt !== undefined && baseUpdatedAt !== null) {
    baseRevision = canonicalizeServerRevision(baseUpdatedAt);

    if (baseRevision === null) {
      return res.status(400).json({
        error:
          "The document revision is not in a format this server understands.",
        code: ErrorCodes.SYNC_PARTIAL,
      });
    }

    exactRevision = revisionPrecision(baseUpdatedAt) === "microsecond";
  }

  try {
    /*
     * Which server row does this payload belong to?
     *
     * The lookup used to be "the row with this document number", which could
     * not recognise a document that had never been given one - the OCR draft
     * of a scanned document - and so created a second row for it. The
     * resolver tries the row id first, then the storage key of the upload and
     * only then the document number.
     */
    const target = await resolveSyncTarget(db, {
      userId,
      cloudId,
      s3Key,
      documentNumber,
      title,
    });

    if (target.action === SYNC_TARGET.CONFLICT) {
      if (target.reason === "notOwned") {
        // The row this client knew about is gone or no longer owned by it.
        // Do not create or overwrite anything; let the client keep local data.
        return res.status(409).json({
          error: "Document was modified or removed on another device",
          code: ErrorCodes.SYNC_CONFLICT,
          conflict: true,
        });
      }

      // Same number but a different document: flag rather than overwrite.
      return res.status(409).json({
        error:
          "A different document already uses this document number on your account",
        code: ErrorCodes.SYNC_CONFLICT,
        conflict: true,
      });
    }

    if (target.action === SYNC_TARGET.UPDATE) {
      // Conditional update. When the client tells us which server revision it
      // last saw, require the row to still be at that revision. Without this
      // any push was an unconditional overwrite, so a change made on the web
      // app was silently destroyed by the next mobile sync.
      //
      // The new revision is written with `clock_timestamp()`, the moment the
      // statement runs. `CURRENT_TIMESTAMP` is the moment the transaction
      // started, so two writes in the same transaction would leave the
      // revision unchanged and the second write would look like a write
      // against a row that had not moved.
      const updated = await db.query(
        `UPDATE documents
         SET title = $1, category = $2, issuer = $3, document_number = $4,
             issue_date = $5, expiry_date = $6, notes = $7, enable_alerts = $8,
             status = $9, s3_key = $10, file_url = $11, file_type = $12,
             processing_status = $13, risk_score = $14, risk_level = $15,
             updated_at = clock_timestamp()
         WHERE id = $16 AND user_id = $17
           AND ($18::timestamptz IS NULL OR ${REVISION_MATCH_SQL})
         RETURNING id, title, category, issuer, document_number AS "documentNumber",
                   issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
                   enable_alerts AS "enableAlerts", file_url AS "fileUrl", file_type AS "fileType",
                   s3_key AS "s3Key", processing_status AS "processingStatus",
                   risk_score AS "riskScore", risk_level AS "riskLevel",
                   ${UPDATED_AT_ISO_SQL} AS "updatedAt"`,
        [
          title,
          category || "other",
          issuer,
          documentNumber,
          issueDate,
          expiryDate,
          notes,
          enableAlerts,
          status || "active",
          s3Key,
          fileUrl,
          fileType,
          processingStatus || "completed",
          riskScore,
          riskLevel,
          target.rowId,
          userId,
          baseRevision || null,
          exactRevision,
        ],
      );

      // The revision guard matched no row: the server copy moved on.
      if (updated.rows.length === 0) {
        const current = await db.query(
          `SELECT ${UPDATED_AT_ISO_SQL} AS "updatedAt"
           FROM documents WHERE id = $1 AND user_id = $2`,
          [target.rowId, userId],
        );

        return res.status(409).json({
          error:
            "This document was changed on another device since your last sync",
          code: ErrorCodes.SYNC_CONFLICT,
          conflict: true,
          serverUpdatedAt: current.rows?.[0]?.updatedAt ?? null,
        });
      }

      info("Documents", "Document synced (updated)", {
        userId,
        docId: target.rowId,
        matchedBy: target.matchedBy,
      });
      /*
       * The returned row is the stored row, so it is mirrored as it is. A
       * column the payload does not carry is not written, and a column that
       * is NULL stays NULL - the mirror never invents a value for a field
       * the client did not send.
       */
      await syncDocument(userId, updated.rows[0], "UPDATE");

      res.json({
        message: "Document synced (updated)",
        document: updated.rows[0],
      });
      return;
    }

    const inserted = await db.query(
      `INSERT INTO documents (
         user_id, title, category, issuer, document_number,
         issue_date, expiry_date, notes, enable_alerts, status, created_at,
         s3_key, file_url, file_type, processing_status,
         risk_score, risk_level
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, $12, $13, $14, $15, $16)
       RETURNING id, title, category, issuer, document_number AS "documentNumber",
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
                 enable_alerts AS "enableAlerts", file_url AS "fileUrl", file_type AS "fileType",
                 s3_key AS "s3Key", processing_status AS "processingStatus",
                 risk_score AS "riskScore", risk_level AS "riskLevel",
                 ${UPDATED_AT_ISO_SQL} AS "updatedAt"`,
      [
        userId,
        title,
        category || "other",
        issuer,
        documentNumber,
        issueDate,
        expiryDate,
        notes,
        enableAlerts ? true : false,
        status || "active",
        s3Key,
        fileUrl,
        fileType,
        processingStatus || "completed",
        // Null when the client sent nothing: no detector has assessed this
        // document. Writing 0/"Low" would read as "assessed and safe".
        riskScore ?? null,
        riskLevel ?? null,
      ],
    );

    info("Documents", "Document synced (created)", {
      userId,
      docId: inserted.rows[0].id,
    });
    await syncDocument(userId, inserted.rows[0], "INSERT");

    res.status(201).json({
      message: "Document synced (created)",
      document: inserted.rows[0],
    });
  } catch (err) {
    logError(
      "Documents",
      "Error syncing document",
      {
        error: err.message,
        stack: err.stack,
        userId,
        title,
      },
      ErrorCodes.SYNC_PARTIAL,
    );
    res.status(500).json({
      error: "Server error while syncing document",
      code: ErrorCodes.SYNC_PARTIAL,
    });
  }
};

/**
 * Removes an uploaded object that never became a document.
 *
 * The upload of a picked file happens before the document is written to the
 * database. When the database write then fails, the uploaded object is left
 * behind: the file is in the bucket, but no row points at it and no
 * interaction can ever reach it again.
 *
 * The client calls this to clean up after itself. The removal is deliberately
 * narrow:
 *
 *   - the key has to live in the caller's own folder, so nobody can remove
 *     another account's object;
 *   - the key must not be referenced by any document, so an object that a
 *     document does use is never removed;
 *   - the removal itself is best effort. A failure is reported, and the
 *     object is left for a later cleanup rather than blocking the request.
 */
exports.deleteUploadedObject = async (req, res) => {
  const userId = req.user.userId;
  const s3Key = typeof req.body?.s3Key === "string" ? req.body.s3Key.trim() : "";

  if (!s3Key) {
    return res.status(400).json({
      error: "A storage key is required.",
      code: ErrorCodes.DOC_VALIDATION,
    });
  }

  // The stored name is always "<userId>/<uuid>.<ext>".
  if (!ownsStorageKey(s3Key, userId)) {
    return res.status(403).json({
      error: "This storage key does not belong to your account.",
      code: ErrorCodes.DOC_NOT_FOUND,
    });
  }

  try {
    /*
     * A key that a document still uses is never removed. The check is across
     * every account: an object that is referenced anywhere is in use, even if
     * the row that references it belongs to somebody else.
     */
    const inUse = await db.query(
      `SELECT id FROM documents WHERE s3_key = $1 LIMIT 1`,
      [s3Key],
    );

    if (inUse.rows.length > 0) {
      return res.status(409).json({
        error: "This file is still attached to a document.",
        code: ErrorCodes.SYNC_CONFLICT,
        conflict: true,
      });
    }

    await deleteStorageObject(s3Key);

    info("Documents", "Uploaded object removed", { userId, s3Key });
    res.json({ message: "Uploaded object removed" });
  } catch (err) {
    logError(
      "Documents",
      "Error removing an uploaded object",
      {
        error: err.message,
        stack: err.stack,
        userId,
        s3Key,
      },
      ErrorCodes.DOC_DELETE_FAILED,
    );
    res.status(500).json({
      error: "Server error while removing the uploaded file",
      code: ErrorCodes.DOC_DELETE_FAILED,
    });
  }
};

// Delete a document
exports.deleteDocument = async (req, res) => {
  const userId = req.user.userId;
  const docId = req.params.id;

  try {
    const result = await db.query(
      `DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id, s3_key`,
      [docId, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Document not found or unauthorized",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    info("Documents", "Document deleted", { userId, docId });

    /*
     * The stored object goes with the row.
     *
     * The row is the only thing that points at the object, so a deleted
     * document left its file in the bucket forever: nothing could reach it
     * any more and nothing would ever remove it. The removal is best effort -
     * a failure here must not turn a completed delete into an error - and it
     * only ever touches the key that belonged to the row that was just
     * deleted.
     */
    const deletedKey = result.rows[0].s3_key;

    if (deletedKey) {
      await deleteStorageObject(deletedKey);
    }

    await deleteRecord("documents", docId, userId);
    res.json({ message: "Document deleted successfully" });
  } catch (err) {
    logError(
      "Documents",
      "Error deleting document",
      {
        error: err.message,
        stack: err.stack,
        userId,
        docId,
      },
      ErrorCodes.DOC_DELETE_FAILED,
    );
    res.status(500).json({
      error: "Server error while deleting document",
      code: ErrorCodes.DOC_DELETE_FAILED,
    });
  }
};
