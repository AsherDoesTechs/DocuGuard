const {
  classifyDocument,
  extractClassifiedDocumentData,
} = require("./logicEngine");
const { warn } = require("../utils/debugLogger");

// Retained for callers that use this category-normalization helper.
// Categories are metadata only and never determine the Azure classifier label.
const TRUSTED_CATEGORIES = new Set([
  "identification",
  "financial",
  "medical",
  "legal",
  "academic",
  "other",
]);

function classifyExpectedCategory(selectedCategory) {
  const cat = String(selectedCategory || "").toLowerCase();

  if (TRUSTED_CATEGORIES.has(cat)) return cat;
  if (
    cat === "government-id" ||
    cat === "government" ||
    cat === "passport" ||
    cat === "license"
  ) {
    return "identification";
  }
  if (cat === "certificate" || cat === "education") return "academic";
  if (cat === "insurance") return "financial";
  if (cat === "civil") return "legal";

  return "other";
}

function evaluateExtractionConfidence(extractedData) {
  const fields = extractedData?.extractedFields;

  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return { needsReview: true, reason: "no_extracted_fields" };
  }

  const configuredThreshold = Number(
    process.env.AZURE_FIELD_CONFIDENCE_THRESHOLD || "0.85",
  );

  if (
    !Number.isFinite(configuredThreshold) ||
    configuredThreshold < 0 ||
    configuredThreshold > 1
  ) {
    return {
      needsReview: true,
      reason: "invalid_field_confidence_threshold",
    };
  }

  let populatedFields = 0;
  let uncertainFields = 0;

  function inspect(node) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) inspect(item);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(node, "value")) {
      for (const child of Object.values(node)) inspect(child);
      return;
    }

    const value = node.value;

    // Nested Azure objects and arrays can contain independently scored fields.
    // Evaluate those child fields rather than relying only on the parent score.
    if (value && typeof value === "object") {
      const nestedFields = Array.isArray(value)
        ? value.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              Object.prototype.hasOwnProperty.call(item, "value"),
          )
        : Object.values(value).filter(
            (item) =>
              item &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              Object.prototype.hasOwnProperty.call(item, "value"),
          );

      if (nestedFields.length > 0) {
        for (const nestedField of nestedFields) inspect(nestedField);
        return;
      }
    }

    const populated =
      value !== null &&
      value !== undefined &&
      value !== "" &&
      (!Array.isArray(value) || value.length > 0) &&
      (!(value instanceof Object) || Object.keys(value).length > 0);

    if (!populated) return;

    populatedFields += 1;

    const confidence = node.confidence;

    if (
      node.needsReview !== false ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < configuredThreshold ||
      confidence > 1
    ) {
      uncertainFields += 1;
    }
  }

  inspect(fields);

  if (populatedFields === 0) {
    return { needsReview: true, reason: "no_usable_extracted_fields" };
  }

  if (uncertainFields > 0) {
    return {
      needsReview: true,
      reason: "low_field_confidence",
      populatedFields,
      uncertainFields,
    };
  }

  return {
    needsReview: false,
    populatedFields,
    uncertainFields: 0,
  };
}
async function validateDocumentType({ fileUrl }) {
  if (!fileUrl) {
    return {
      status: "unsupported",
      httpStatus: 400,
      code: "DOCUMENT_FILE_MISSING",
      message: "Document file could not be resolved for validation.",
    };
  }

  try {
    const classificationResult = await classifyDocument(fileUrl);

    if (classificationResult.status === "manual_review") {
      return {
        status: "manual_review",
        httpStatus: 422,
        code: "DOCUMENT_CLASSIFICATION_REVIEW",
        message:
          classificationResult.message ||
          "The document could not be classified confidently. Please review it manually.",
        reason: classificationResult.reason,
        classification: classificationResult.classification || null,
      };
    }

    if (
      classificationResult.status !== "classified" ||
      !classificationResult.classification ||
      !classificationResult.modelId
    ) {
      throw new Error("Azure classification returned an invalid decision.");
    }

    // Only the classifier's exact label and validated route choose the model.
    // fileType and selectedCategory deliberately do not influence extraction.
    const extractedData = await extractClassifiedDocumentData(
      fileUrl,
      classificationResult.modelId,
      classificationResult.classification,
    );

    const confidenceEvaluation =
      evaluateExtractionConfidence(extractedData);

    if (confidenceEvaluation.needsReview) {
      return {
        status: "manual_review",
        httpStatus: 422,
        code: "DOCUMENT_EXTRACTION_REVIEW",
        message:
          "Some extracted information could not be verified confidently. Please review the document and enter its details manually.",
        reason: confidenceEvaluation.reason,
        classification: classificationResult.classification,
        confidenceEvaluation,
      };
    }

    return {
      status: "valid",
      httpStatus: 200,
      code: "DOCUMENT_TYPE_VALID",
      classification: classificationResult.classification,
      modelId: classificationResult.modelId,
      extractedData,
      confidenceEvaluation,
    };
  } catch (error) {
    // Keep raw SDK details and document URLs out of client responses and logs.
    warn("DocumentValidation", "Classification-first validation failed", {
      error:
        error?.message === "Azure document classification timed out." ||
        error?.message === "Azure document extraction timed out."
          ? "OCR operation timed out"
          : "OCR operation failed",
    });

    const timedOut = /timed out/i.test(String(error?.message || ""));

    return {
      status: "processing_error",
      httpStatus: 502,
      code: "OCR_PROCESS_FAILED",
      message: timedOut
        ? "Document processing timed out. Please try again."
        : "Document processing failed. Please try again.",
    };
  }
}

module.exports = {
  validateDocumentType,
  classifyExpectedCategory,
  evaluateExtractionConfidence,
};