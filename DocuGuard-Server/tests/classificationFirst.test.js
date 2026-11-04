"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

process.env.AZURE_ENDPOINT = "https://unit-test.cognitiveservices.azure.com/";
process.env.AZURE_KEY = "synthetic-test-key";
process.env.AZURE_CLASSIFIER_ID = "synthetic-classifier";
process.env.AZURE_CLASSIFICATION_THRESHOLD = "0.85";
process.env.AZURE_FIELD_CONFIDENCE_THRESHOLD = "0.85";
process.env.AZURE_MODEL_ROUTES_JSON = JSON.stringify({
  passport: "prebuilt-idDocument",
  invoice: "prebuilt-invoice",
});
process.env.AZURE_OCR_TIMEOUT_MS = "5000";
process.env.AZURE_OCR_MAX_CONCURRENCY = "3";

const state = {
  classificationResult: { documents: [{ docType: "passport", confidence: 0.95 }] },
  analysisResult: { documents: [{ fields: { Name: {
    type: "string", valueString: "Synthetic Person", confidence: 0.95,
  } } }] },
  classifyCalls: [],
  analyzeCalls: [],
  stopCalls: 0,
};

class MockAzureClient {
  constructor(endpoint, credential) {
    assert.equal(endpoint, process.env.AZURE_ENDPOINT);
    assert.equal(credential.key, process.env.AZURE_KEY);
  }

  async beginClassifyDocumentFromUrl(classifierId, url, options) {
    state.classifyCalls.push({ classifierId, url, options });
    return {
      pollUntilDone: async () => state.classificationResult,
      stopPolling: () => { state.stopCalls += 1; },
    };
  }

  async beginAnalyzeDocumentFromUrl(modelId, url, options) {
    state.analyzeCalls.push({ modelId, url, options });
    return {
      pollUntilDone: async () => state.analysisResult,
      stopPolling: () => { state.stopCalls += 1; },
    };
  }
}

const sdkPath = require.resolve("@azure/ai-form-recognizer");
const logicPath = require.resolve("../services/logicEngine");
const originalLoad = Module._load;
const originalSdkCache = require.cache[sdkPath];
const originalLogicCache = require.cache[logicPath];

try {
  Module._load = function (request, parent, isMain) {
    if (request === "@azure/ai-form-recognizer") {
      return {
        DocumentAnalysisClient: MockAzureClient,
        AzureKeyCredential: class AzureKeyCredential {
          constructor(key) { this.key = key; }
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[logicPath];
  var logicEngine = require("../services/logicEngine");
} finally {
  Module._load = originalLoad;

  if (originalSdkCache) require.cache[sdkPath] = originalSdkCache;
  else delete require.cache[sdkPath];

  if (originalLogicCache) require.cache[logicPath] = originalLogicCache;
}

const documentUrl = "https://unit-test.example/document.pdf";

function resetCalls() {
  state.classifyCalls.length = 0;
  state.analyzeCalls.length = 0;
  state.stopCalls = 0;
}

test("classification uses the configured classifier and HTTPS URL", async () => {
  resetCalls();
  state.classificationResult = {
    documents: [{ docType: "passport", confidence: 0.95 }],
  };

  const result = await logicEngine.classifyDocument(documentUrl);

  assert.equal(result.status, "classified");
  assert.equal(result.classification.docType, "passport");
  assert.equal(result.classification.confidence, 0.95);
  assert.equal(result.modelId, "prebuilt-idDocument");
  assert.equal(state.classifyCalls.length, 1);
  assert.equal(state.classifyCalls[0].classifierId, "synthetic-classifier");
  assert.equal(state.classifyCalls[0].url, documentUrl);
  assert.equal(state.analyzeCalls.length, 0);
});

test("classification confidence exactly at threshold is accepted", async () => {
  state.classificationResult = {
    documents: [{ docType: "passport", confidence: 0.85 }],
  };

  const result = await logicEngine.classifyDocument(documentUrl);

  assert.equal(result.status, "classified");
  assert.equal(result.classification.confidence, 0.85);
});

test("low, missing, non-finite, and out-of-range confidence require review", async (t) => {
  const cases = [
    ["below threshold", { docType: "passport", confidence: 0.849 }, "low_classification_confidence"],
    ["missing confidence", { docType: "passport" }, "invalid_classification_confidence"],
    ["non-finite confidence", { docType: "passport", confidence: NaN }, "invalid_classification_confidence"],
    ["out-of-range confidence", { docType: "passport", confidence: 1.1 }, "invalid_classification_confidence"],
  ];

  for (const [label, document, expectedReason] of cases) {
    await t.test(label, async () => {
      state.classificationResult = { documents: [document] };
      const result = await logicEngine.classifyDocument(documentUrl);
      assert.equal(result.status, "manual_review");
      assert.equal(result.reason, expectedReason);
      assert.equal(state.analyzeCalls.length, 0);
    });
  }
});

test("empty and conflicting classification results require review", async (t) => {
  await t.test("empty result", async () => {
    state.classificationResult = { documents: [] };
    const result = await logicEngine.classifyDocument(documentUrl);
    assert.equal(result.status, "manual_review");
    assert.equal(result.reason, "no_classification");
  });

  await t.test("conflicting labels", async () => {
    state.classificationResult = {
      documents: [
        { docType: "passport", confidence: 0.95 },
        { docType: "invoice", confidence: 0.96 },
      ],
    };
    const result = await logicEngine.classifyDocument(documentUrl);
    assert.equal(result.status, "manual_review");
    assert.equal(result.reason, "conflicting_document_types");
  });

  await t.test("missing label", async () => {
    state.classificationResult = {
      documents: [{ confidence: 0.95 }],
    };
    const result = await logicEngine.classifyDocument(documentUrl);
    assert.equal(result.status, "manual_review");
    assert.equal(result.reason, "missing_document_type");
  });
});

test("unmapped classifier label requires review rather than fallback extraction", async () => {
  resetCalls();
  state.classificationResult = {
    documents: [{ docType: "unknown-label", confidence: 0.99 }],
  };

  const result = await logicEngine.classifyDocument(documentUrl);

  assert.equal(result.status, "manual_review");
  assert.equal(state.analyzeCalls.length, 0);
});

test("extraction uses the exact configured model and preserves classification metadata", async () => {
  resetCalls();
  state.analysisResult = {
    documents: [{
      fields: {
        Name: {
          type: "string",
          valueString: "Synthetic Person",
          confidence: 0.95,
        },
      },
    }],
  };

  const result = await logicEngine.extractClassifiedDocumentData(
    documentUrl,
    "prebuilt-idDocument",
    { docType: "passport", confidence: 0.95, threshold: 0.85 },
  );

  assert.equal(state.analyzeCalls.length, 1);
  assert.equal(state.analyzeCalls[0].modelId, "prebuilt-idDocument");
  assert.equal(state.analyzeCalls[0].url, documentUrl);
  assert.equal(result.classification.docType, "passport");
  assert.equal(result.classification.confidence, 0.95);
  assert.equal(result.extractedFields.Name.value, "Synthetic Person");
});

test("extraction rejects an unconfigured model route", async () => {
  await assert.rejects(
    logicEngine.extractClassifiedDocumentData(
      documentUrl,
      "prebuilt-document",
      { docType: "passport", confidence: 0.95, threshold: 0.85 },
    ),
    /route|model|classification|configured/i,
  );
});

test("classification rejects non-HTTPS URLs before calling Azure", async () => {
  resetCalls();

  await assert.rejects(
    logicEngine.classifyDocument("http://unit-test.example/document.pdf"),
    /HTTPS/i,
  );

  assert.equal(state.classifyCalls.length, 0);
});

test("missing classifier ID fails closed", async () => {
  const previous = process.env.AZURE_CLASSIFIER_ID;
  try {
    process.env.AZURE_CLASSIFIER_ID = "";
    await assert.rejects(
      logicEngine.classifyDocument(documentUrl),
      /AZURE_CLASSIFIER_ID/i,
    );
  } finally {
    process.env.AZURE_CLASSIFIER_ID = previous;
  }
});