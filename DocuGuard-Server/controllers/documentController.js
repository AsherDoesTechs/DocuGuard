const db = require("../config/db");
const { generatePresignedUploadUrl } = require("../services/storageService");

// Helper function for date validation (YYYY-MM-DD format)
const isValidDateString = (dateStr) => {
  if (!dateStr) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
};

// Get all documents for the authenticated user
exports.getAllDocuments = async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT id, title, category, issuer, document_number AS "documentNumber", 
              issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts" 
       FROM documents WHERE user_id = $1 ORDER BY expiry_date ASC`,
      [userId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching documents:", err);
    res.status(500).json({ error: "Server error while fetching documents" });
  }
};

  // 1. Get Presigned Upload URL (S3 Integration)
  exports.getUploadUrl = async (req, res) => {
    try {
      const { fileName, fileType } = req.query;
      if (!fileName || !fileType) {
        return res.status(400).json({
          error: "fileName and fileType are required query parameters.",
        });
      }

      const result = await generatePresignedUploadUrl(
        req.user.userId,
        fileName,
        fileType,
      );

      res.json(result);
    } catch (err) {
      console.error("Error generating upload URL:", err);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  };

  // 2. Process Document OCR (placeholder for logicEngine integration)
  exports.processDocumentOCR = async (req, res) => {
    try {
      const { s3Key } = req.body;
      if (!s3Key) {
        return res
          .status(400)
          .json({ error: "s3Key is required for OCR processing." });
      }

      const extractedData = { status: "queued", s3Key };

      res.json({
        message: "Document queued for processing",
        extractedData,
      });
    } catch (err) {
      console.error("Error processing document OCR:", err);
      res.status(500).json({ error: "OCR processing failed" });
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
              file_url AS "fileUrl", file_type AS "fileType"
       FROM documents WHERE id = $1 AND user_id = $2`,
      [docId, userId],
    );

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.json(doc.rows[0]);
  } catch (err) {
    console.error("Error fetching document:", err);
    res.status(500).json({ error: "Server error fetching document details" });
  }
};

// Create a new document with strict validation & automations
exports.createDocument = async (req, res) => {
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
  } = req.body;

  // 1. Sanitize & Check Required Fields
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  const trimmedIssuer = typeof issuer === "string" ? issuer.trim() : "";
  const trimmedDocNum =
    typeof documentNumber === "string" ? documentNumber.trim() : "";

  if (!trimmedTitle || !trimmedIssuer || !trimmedDocNum) {
    return res.status(400).json({
      error:
        "Validation failed: Title, issuer, and document number are required and cannot be empty.",
    });
  }

  // 2. Validate Date Formats and Logic
  if (!isValidDateString(issueDate) || !isValidDateString(expiryDate)) {
    return res.status(400).json({
      error:
        "Validation failed: Issue date and expiry date must follow the YYYY-MM-DD format.",
    });
  }

  const parsedIssueDate = new Date(issueDate);
  const parsedExpiryDate = new Date(expiryDate);

  if (parsedIssueDate > parsedExpiryDate) {
    return res.status(400).json({
      error:
        "Validation failed: Issue date cannot be later than the expiry date.",
    });
  }

  // 3. Category Validation against allowed types
  const validCategories = [
    "identification",
    "financial",
    "medical",
    "legal",
    "academic",
    "other",
  ];
  const sanitizedCategory = validCategories.includes(category)
    ? category
    : "other";

  try {
    const newDoc = await db.query(
      `INSERT INTO documents (
         user_id, title, category, issuer, document_number, 
         issue_date, expiry_date, notes, enable_alerts, status, created_at
       ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', CURRENT_TIMESTAMP) 
       RETURNING id, title, category, issuer, document_number AS "documentNumber", 
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts"`,
      [
        userId,
        trimmedTitle,
        sanitizedCategory,
        trimmedIssuer,
        trimmedDocNum,
        issueDate,
        expiryDate,
        typeof notes === "string" ? notes.trim() : null,
        typeof enableAlerts === "boolean" ? enableAlerts : true,
      ],
    );

    res.status(201).json({
      message: "Document created successfully",
      document: newDoc.rows[0],
    });
  } catch (err) {
    console.error("Error creating document:", err);
    res.status(500).json({ error: "Server error while creating document" });
  }
};

// Update an existing document with strict validation & automations
exports.updateDocument = async (req, res) => {
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
  } = req.body;

  // 1. Sanitize & Check Required Fields
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  const trimmedIssuer = typeof issuer === "string" ? issuer.trim() : "";
  const trimmedDocNum =
    typeof documentNumber === "string" ? documentNumber.trim() : "";

  if (!trimmedTitle || !trimmedIssuer || !trimmedDocNum) {
    return res.status(400).json({
      error:
        "Validation failed: Title, issuer, and document number are required and cannot be empty.",
    });
  }

  // 2. Validate Date Formats and Logic
  if (!isValidDateString(issueDate) || !isValidDateString(expiryDate)) {
    return res.status(400).json({
      error:
        "Validation failed: Issue date and expiry date must follow the YYYY-MM-DD format.",
    });
  }

  const parsedIssueDate = new Date(issueDate);
  const parsedExpiryDate = new Date(expiryDate);

  if (parsedIssueDate > parsedExpiryDate) {
    return res.status(0).json({
      error:
        "Validation failed: Issue date cannot be later than the expiry date.",
    });
  }

  // 3. Category Validation against allowed types
  const validCategories = [
    "identification",
    "financial",
    "medical",
    "legal",
    "academic",
    "other",
  ];
  const sanitizedCategory = validCategories.includes(category)
    ? category
    : "other";

  try {
    const updated = await db.query(
      `UPDATE documents 
       SET title = $1, category = $2, issuer = $3, document_number = $4, 
           issue_date = $5, expiry_date = $6, notes = $7, enable_alerts = $8, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND user_id = $10 
       RETURNING id, title, category, issuer, document_number AS "documentNumber", 
                 issue_date AS "issueDate", expiry_date AS "expiryDate", notes, status, enable_alerts AS "enableAlerts"`,
      [
        trimmedTitle,
        sanitizedCategory,
        trimmedIssuer,
        trimmedDocNum,
        issueDate,
        expiryDate,
        typeof notes === "string" ? notes.trim() : null,
        typeof enableAlerts === "boolean" ? enableAlerts : true,
        docId,
        userId,
      ],
    );

    if (updated.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Document not found or unauthorized" });
    }

    res.json({
      message: "Document updated successfully",
      document: updated.rows[0],
    });
  } catch (err) {
    console.error("Error updating document:", err);
    res.status(500).json({ error: "Server error while updating document" });
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
      return res
        .status(404)
        .json({ error: "Document not found or unauthorized" });
    }

    res.json({ message: "Document deleted successfully" });
  } catch (err) {
    console.error("Error deleting document:", err);
    res.status(500).json({ error: "Server error while deleting document" });
  }
};
