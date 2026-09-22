const db = require("../config/db");
const { generatePresignedUploadUrl } = require("../services/storageService");
const { extractDocumentData } = require("../services/logicEngine");
const {
  sendProcessingCompleteNotification,
  sendVerificationNotification,
} = require("../services/notificationService");
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

// Get all documents for the authenticated user
exports.getAllDocuments = async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT id, title, category, issuer, document_number AS "documentNumber", 
              issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
              file_url AS "fileUrl", file_type AS "fileType", s3_key AS "s3Key",
              processing_status AS "processingStatus", risk_score AS "riskScore", risk_level AS "riskLevel"
       FROM documents WHERE user_id = $1 ORDER BY expiry_date ASC`,
      [userId],
    );

    debug("Documents", "Documents fetched", {
      userId,
      count: result.rows.length,
    });
    res.json(result.rows);
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

// Process document with OCR/AI
exports.processDocument = async (req, res) => {
  try {
    const validation = validateSchema(processDocumentSchema, req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: Object.values(validation.errors).join(", "),
        code: ErrorCodes.DOC_VALIDATION,
        details: validation.errors,
      });
    }

    const userId = req.user.userId;
    const { documentId } = validation.data;

    const docResult = await db.query(
      `SELECT id, s3_key, file_url FROM documents WHERE id = $1 AND user_id = $2`,
      [documentId, userId],
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({
        error: "Document not found",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    const doc = docResult.rows[0];
    const s3Key = doc.s3_key;
    const fileUrl = doc.file_url;

    if (!s3Key && !fileUrl) {
      return res.status(400).json({
        error: "Document has no file attached. Please upload a file first.",
      });
    }

    // Update status to processing
    await db.query(
      `UPDATE documents SET processing_status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [documentId],
    );

    // Run OCR/AI extraction
    const extractedData = await extractDocumentData(fileUrl || s3Key);

    // Update document with extracted data
    const updateResult = await db.query(
      `UPDATE documents 
       SET title = COALESCE($1, title),
           category = COALESCE($2, category),
           issuer = COALESCE($3, issuer),
           document_number = COALESCE($4, document_number),
           issue_date = COALESCE($5, issue_date),
           expiry_date = COALESCE($6, expiry_date),
           risk_score = COALESCE($7, risk_score),
           risk_level = COALESCE($8, risk_level),
           processing_status = 'completed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10
       RETURNING id, title, category, issuer, document_number AS "documentNumber", 
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, 
                 enable_alerts AS "enableAlerts", file_url AS "fileUrl", file_type AS "fileType",
                 s3_key AS "s3Key", processing_status AS "processingStatus",
                 risk_score AS "riskScore", risk_level AS "riskLevel"`,
      [
        extractedData.title,
        extractedData.category,
        extractedData.issuer,
        extractedData.documentNumber,
        extractedData.issueDate,
        extractedData.expiryDate,
        extractedData.riskScore,
        extractedData.riskLevel,
        documentId,
        userId,
      ],
    );

    // Send processing complete notification
    try {
      const userResult = await db.query(
        `SELECT fcm_token, expo_push_token FROM users WHERE id = $1`,
        [userId],
      );

      const pushToken =
        userResult.rows[0]?.fcm_token || userResult.rows[0]?.expo_push_token;
      if (pushToken && extractedData.title) {
        await sendProcessingCompleteNotification(
          pushToken,
          extractedData.title,
          extractedData.riskLevel,
        );
      }
    } catch (notifErr) {
      console.error("Error sending processing notification:", notifErr);
    }

    res.json({
      message: "Document processed successfully",
      document: updateResult.rows[0],
      extractedData,
    });
  } catch (err) {
    console.error("Error processing document:", err);

    // Update status to failed if we have documentId
    try {
      const { documentId } = req.body;
      if (documentId) {
        await db.query(
          `UPDATE documents SET processing_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [documentId],
        );
      }
    } catch (updateErr) {
      console.error("Error updating processing status:", updateErr);
    }

    res.status(500).json({
      error: "OCR processing failed",
      code: ErrorCodes.OCR_PROCESS_FAILED,
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

    if (docResult.rows.length > 0) {
      const userResult = await db.query(
        `SELECT fcm_token, expo_push_token FROM users WHERE id = $1`,
        [userId],
      );

      // Use FCM token only (Expo tokens not supported by Firebase Admin SDK)
      const fcmToken = userResult.rows[0]?.fcm_token;
      if (fcmToken && !fcmToken.startsWith("ExponentPushToken")) {
        try {
          await sendVerificationNotification(fcmToken, docResult.rows[0].title);
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
              processing_status AS "processingStatus", risk_score AS "riskScore", risk_level AS "riskLevel"
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
    res.json(doc.rows[0]);
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
                 processing_status AS "processingStatus", risk_score AS "riskScore", risk_level AS "riskLevel"`,
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
  const validation = validateSchema(documentUpdateSchema, { ...req.body, id: parseInt(req.params.id) });
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
  } = validation.data;

  try {
    const updated = await db.query(
      `UPDATE documents 
       SET title = $1, category = $2, issuer = $3, document_number = $4, 
           issue_date = $5, expiry_date = $6, notes = $7, enable_alerts = $8, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10 
       RETURNING id, title, category, issuer, document_number AS "documentNumber", 
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
                 s3_key AS "s3Key", file_url AS "fileUrl", file_type AS "fileType",
                 processing_status AS "processingStatus"`,
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
      ],
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({
        error: "Document not found or unauthorized",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    info("Documents", "Document updated", { userId, docId });

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
  } = validation.data;

  debug("Documents", "Sync document request", { userId, title });

  try {
    const existing = await db.query(
      `SELECT id FROM documents WHERE document_number = $1 AND user_id = $2`,
      [documentNumber || title, userId],
    );

    if (existing.rows.length > 0) {
      const updated = await db.query(
        `UPDATE documents 
         SET title = $1, category = $2, issuer = $3, document_number = $4, 
             issue_date = $5, expiry_date = $6, notes = $7, enable_alerts = $8, 
             status = $9, s3_key = $10, file_url = $11, file_type = $12,
             processing_status = $13, risk_score = $14, risk_level = $15,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $16 AND user_id = $17 
         RETURNING id, title, category, issuer, document_number AS "documentNumber", 
                   issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status,
                   enable_alerts AS "enableAlerts", file_url AS "fileUrl", file_type AS "fileType",
                   s3_key AS "s3Key", processing_status AS "processingStatus",
                   risk_score AS "riskScore", risk_level AS "riskLevel"`,
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
          existing.rows[0].id,
          userId,
        ],
      );

      info("Documents", "Document synced (updated)", {
        userId,
        docId: existing.rows[0].id,
      });

      res.json({
        message: "Document synced (updated)",
        document: updated.rows[0],
      });
    } else {
      const inserted = await db.query(
        `INSERT INTO documents (
           user_id, title, category, issuer, document_number, 
           issue_date, expiry_date, notes, enable_alerts, status, created_at,
           s3_key, file_url, file_type, processing_status,
           risk_score, risk_level
         ) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, $12, $13, $14, $15, $16) 
         RETURNING id, title, category, issuer, document_number AS "documentNumber", 
                   issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts",
                   s3_key AS "s3Key", file_url AS "fileUrl", file_type AS "fileType",
                   processing_status AS "processingStatus",
                   risk_score AS "riskScore", risk_level AS "riskLevel"`,
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
          riskScore || 0,
          riskLevel || "Low",
        ],
      );

      info("Documents", "Document synced (created)", {
        userId,
        docId: inserted.rows[0].id,
      });

      res.status(201).json({
        message: "Document synced (created)",
        document: inserted.rows[0],
      });
    }
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

// Delete a document
exports.deleteDocument = async (req, res) => {
  const userId = req.user.userId;
  const docId = req.params.id;

  try {
    const result = await db.query(
      `DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id`,
      [docId, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Document not found or unauthorized",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    info("Documents", "Document deleted", { userId, docId });
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
