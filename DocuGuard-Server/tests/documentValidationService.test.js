"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const logicPath = require.resolve("../services/logicEngine");
const loggerPath = require.resolve("../utils/debugLogger");
const validationPath = require.resolve("../services/documentValidationService");

const originalLogic = require.cache[logicPath];
const originalLogger = require.cache[loggerPath];
const originalValidation = require.cache[validationPath];

let classificationResult;
let classificationError;
let extractionResult;
let extractionError;
let classificationCalls;
let extractionCalls;
const warnings = [];

const logicStub = new Module(logicPath, module);
logicStub.filename = logicPath;
logicStub.loaded = true;
logicStub.exports = {
  classifyDocument: async (...args) => {
    classificationCalls.push(args);
    if (classificationError) throw classificationError;
    return classificationResult;
  },
  extractClassifiedDocumentData: async (...args) => {
    extractionCalls.push(args);
    if (extractionError) throw extractionError;
    return extractionResult;
  },
};

const loggerStub = new Module(loggerPath, module);
loggerStub.filename = loggerPath;
loggerStub.loaded = true;
loggerStub.exports = {
  warn: (...args) => warnings.push(args),
};

require.cache[logicPath] = logicStub;
require.cache[loggerPath] = loggerStub;
delete require.cache[validationPath];

const { validateDocumentType } = require("../services/documentValidationService");

// Restore dependency cache entries after the service has captured the stubs.
if (originalLogic) require.cache[logicPath] = originalLogic;
else delete require.cache[logicPath];

if (originalLogger) require.cache[loggerPath] = originalLogger;
else delete require.cache[loggerPath];

if (originalValidation) require.cache[validationPath] = originalValidation;
else delete require.cache[validationPath];

function reset() {
  classificationResult = {
    status: "classified",
    classification: {
      docType: "passport",
      confidence: 0.95,
      threshold: 0.85,
    },
    modelId: "passport-model-v1",
  };
  classificationError = null;
  extractionResult = {
    extractedFields: {
      documentNumber: {
        value: "TEST-123",
        confidence: 0.96,
        needsReview: false,
      },
    },
  };
  extractionError = null;
  classificationCalls = [];
  extractionCalls = [];
  warnings.length = 0;
}

test.beforeEach(reset);

test("manual review is returned without invoking extraction", async () => {
  classificationResult = {
    status: "manual_review",
    reason: "low_confidence",
    message: "Please review this document.",
    classification: { docType: null, confidence: 0.4, threshold: 0.85 },
  };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "manual_review");
  assert.equal(result.httpStatus, 422);
  assert.equal(result.code, "DOCUMENT_CLASSIFICATION_REVIEW");
  assert.equal(result.reason, "low_confidence");
  assert.equal(classificationCalls.length, 1);
  assert.deepEqual(classificationCalls[0], [
    "https://example.com/document.pdf",
  ]);
  assert.equal(extractionCalls.length, 0);
});

test("missing file URL fails closed without classification or extraction", async () => {
  const result = await validateDocumentType({ fileUrl: "" });

  assert.equal(result.status, "unsupported");
  assert.equal(result.httpStatus, 400);
  assert.equal(result.code, "DOCUMENT_FILE_MISSING");
  assert.equal(classificationCalls.length, 0);
  assert.equal(extractionCalls.length, 0);
});

test("classified documents use the exact model selected by classification", async () => {
  const fileUrl = "https://example.com/passport.pdf";

  const result = await validateDocumentType({ fileUrl });

  assert.equal(result.status, "valid");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.modelId, "passport-model-v1");
  assert.deepEqual(extractionCalls, [[
    fileUrl,
    "passport-model-v1",
    classificationResult.classification,
  ]]);
  assert.deepEqual(result.extractedData, extractionResult);
});

test("invalid classification decisions fail closed without extraction", async () => {
  classificationResult = {
    status: "classified",
    classification: null,
    modelId: "passport-model-v1",
  };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "processing_error");
  assert.equal(result.httpStatus, 502);
  assert.equal(result.code, "OCR_PROCESS_FAILED");
  assert.equal(extractionCalls.length, 0);
});

test("classification errors return a sanitized processing error", async () => {
  classificationError = new Error(
    "Sensitive SDK detail: synthetic-key-value",
  );

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "processing_error");
  assert.equal(result.httpStatus, 502);
  assert.equal(result.code, "OCR_PROCESS_FAILED");
  assert.equal(
    JSON.stringify(result).includes("synthetic-key-value"),
    false,
  );
  assert.equal(extractionCalls.length, 0);
});
test("low-confidence extracted fields require manual review", async () => {
  extractionResult = {
    extractedFields: {
      documentNumber: {
        value: "TEST-123",
        confidence: 0.72,
        needsReview: true,
      },
    },
  };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "manual_review");
  assert.equal(result.httpStatus, 422);
  assert.equal(result.code, "DOCUMENT_EXTRACTION_REVIEW");
  assert.equal(result.reason, "low_field_confidence");
  assert.equal(result.confidenceEvaluation.uncertainFields, 1);
});

test("populated fields without confidence require manual review", async () => {
  extractionResult = {
    extractedFields: {
      documentNumber: {
        value: "TEST-123",
        confidence: null,
        needsReview: true,
      },
    },
  };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "manual_review");
  assert.equal(result.reason, "low_field_confidence");
});

test("empty extraction requires manual review", async () => {
  extractionResult = { extractedFields: {} };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "manual_review");
  assert.equal(result.reason, "no_usable_extracted_fields");
});

test("nested Azure fields are evaluated individually", async () => {
  extractionResult = {
    extractedFields: {
      address: {
        value: {
          street: {
            value: "123 Main Street",
            confidence: 0.97,
            needsReview: false,
          },
          city: {
            value: "Malvar",
            confidence: 0.96,
            needsReview: false,
          },
        },
        confidence: null,
        needsReview: true,
      },
    },
  };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "valid");
  assert.equal(result.confidenceEvaluation.needsReview, false);
  assert.equal(result.confidenceEvaluation.populatedFields, 2);
});

test("a low-confidence nested Azure field requires manual review", async () => {
  extractionResult = {
    extractedFields: {
      address: {
        value: {
          street: {
            value: "123 Main Street",
            confidence: 0.97,
            needsReview: false,
          },
          city: {
            value: "Malvar",
            confidence: 0.61,
            needsReview: true,
          },
        },
        confidence: null,
        needsReview: true,
      },
    },
  };

  const result = await validateDocumentType({
    fileUrl: "https://example.com/document.pdf",
  });

  assert.equal(result.status, "manual_review");
  assert.equal(result.reason, "low_field_confidence");
  assert.equal(result.confidenceEvaluation.populatedFields, 2);
  assert.equal(result.confidenceEvaluation.uncertainFields, 1);
});