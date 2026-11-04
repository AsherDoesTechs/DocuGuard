const {
  DocumentAnalysisClient,
  AzureKeyCredential,
} = require("@azure/ai-form-recognizer");

const endpoint = process.env.AZURE_ENDPOINT;
const apiKey = process.env.AZURE_KEY;

/**
 * Minimum analyzer confidence for extracted fields to be treated as usable.
 *
 * Form Recognizer reports per-field and overall confidence. Anything below this
 * is a guess from a blurry photo, and on an identity document a wrong
 * document number is worse than an empty field waiting for the user.
 */
const MIN_COMPLETENESS_PERCENT = 60;

if (!endpoint || !apiKey) {
  console.warn(
    "AZURE_ENDPOINT or AZURE_KEY not configured. Azure OCR will be unavailable.",
  );
}

const client =
  endpoint && apiKey
    ? new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey))
    : null;

function getClassificationConfig() {
  const classifierId = String(process.env.AZURE_CLASSIFIER_ID || "").trim();
  const routesRaw = String(process.env.AZURE_MODEL_ROUTES_JSON || "{}");
  const thresholdRaw = process.env.AZURE_CLASSIFICATION_THRESHOLD ?? "0.85";
  const fieldConfidenceThresholdRaw = process.env.AZURE_FIELD_CONFIDENCE_THRESHOLD ?? "0.85";
  const timeoutRaw = process.env.AZURE_OCR_TIMEOUT_MS ?? "120000";
  const concurrencyRaw = process.env.AZURE_OCR_MAX_CONCURRENCY ?? "3";

  const threshold = Number(thresholdRaw);
  const timeoutMs = Number(timeoutRaw);
  const maxConcurrency = Number(concurrencyRaw);

  if (!endpoint || !apiKey || !client) {
    throw new Error("Azure OCR is not configured. Check AZURE_ENDPOINT and AZURE_KEY.");
  }

  if (!classifierId) {
    throw new Error("Classification-first OCR requires AZURE_CLASSIFIER_ID.");
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Invalid AZURE_CLASSIFICATION_THRESHOLD; expected a number from 0 to 1.");
  }

  const fieldConfidenceThreshold = Number(fieldConfidenceThresholdRaw);
  if (
    !Number.isFinite(fieldConfidenceThreshold) ||
    fieldConfidenceThreshold < 0 ||
    fieldConfidenceThreshold > 1
  ) {
    throw new Error("Invalid AZURE_FIELD_CONFIDENCE_THRESHOLD; expected a number from 0 to 1.");
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    throw new Error("Invalid AZURE_OCR_TIMEOUT_MS; expected an integer from 1000 to 300000.");
  }

  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 20) {
    throw new Error("Invalid AZURE_OCR_MAX_CONCURRENCY; expected an integer from 1 to 20.");
  }

  let routes;
  try {
    routes = JSON.parse(routesRaw);
  } catch {
    throw new Error("Invalid AZURE_MODEL_ROUTES_JSON; expected a JSON object.");
  }

  if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
    throw new Error("Invalid AZURE_MODEL_ROUTES_JSON; expected a JSON object.");
  }

  for (const [label, modelId] of Object.entries(routes)) {
    if (!label.trim() || typeof modelId !== "string" || !modelId.trim()) {
      throw new Error("Invalid AZURE_MODEL_ROUTES_JSON; labels and model IDs must be non-empty strings.");
    }

    // Model IDs are identifiers, not URLs or arbitrary expressions.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(modelId)) {
      throw new Error("Invalid model ID in AZURE_MODEL_ROUTES_JSON.");
    }
  }

  return {
    classifierId,
    threshold,
    fieldConfidenceThreshold,
    timeoutMs,
    maxConcurrency,
    routes,
  };
}

let activeOcrOperations = 0;
const ocrOperationQueue = [];

async function withOcrConcurrencyLimit(maxConcurrency, operation) {
  if (activeOcrOperations >= maxConcurrency) {
    await new Promise((resolve) => {
      ocrOperationQueue.push(resolve);
    });
  }

  activeOcrOperations += 1;

  try {
    return await operation();
  } finally {
    activeOcrOperations -= 1;
    const next = ocrOperationQueue.shift();
    if (next) next();
  }
}
async function classifyAzureDocument(fileUrl) {
  const config = getClassificationConfig();

  if (typeof fileUrl !== "string" || !fileUrl.trim()) {
    throw new Error("Document URL is required for classification.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    throw new Error("A valid HTTPS document URL is required for classification.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("A valid HTTPS document URL is required for classification.");
  }

  return withOcrConcurrencyLimit(config.maxConcurrency, async () => {
    const abortController = new AbortController();
    let poller;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();

      // This stops local polling when the SDK poller supports it.
      // It does not claim to cancel the operation already running in Azure.
      try {
        poller?.stopPolling?.();
      } catch {
        // Preserve the timeout result if local polling cannot be stopped.
      }
    }, config.timeoutMs);

    try {
      poller = await client.beginClassifyDocumentFromUrl(
        config.classifierId,
        fileUrl,
        { abortSignal: abortController.signal },
      );

      const result = await poller.pollUntilDone({
        abortSignal: abortController.signal,
      });

      if (timedOut) {
        throw new Error("Azure document classification timed out.");
      }

      const documents = Array.isArray(result?.documents)
        ? result.documents
        : [];

      if (documents.length === 0) {
        return {
          status: "manual_review",
          reason: "no_classification",
          message: "The document could not be classified. Please review it manually.",
        };
      }

      const labels = documents.map((item) =>
        typeof item?.docType === "string" ? item.docType.trim() : "",
      );

      if (labels.some((label) => !label)) {
        return {
          status: "manual_review",
          reason: "missing_document_type",
          message: "The classification result did not identify a document type.",
        };
      }

      const uniqueLabels = [...new Set(labels)];

      if (uniqueLabels.length !== 1) {
        return {
          status: "manual_review",
          reason: "conflicting_document_types",
          message: "The document classification was ambiguous. Please review it manually.",
        };
      }

      const confidences = documents.map((item) => item?.confidence);

      if (
        confidences.some(
          (confidence) =>
            typeof confidence !== "number" ||
            !Number.isFinite(confidence) ||
            confidence < 0 ||
            confidence > 1,
        )
      ) {
        return {
          status: "manual_review",
          reason: "invalid_classification_confidence",
          message: "The classification confidence could not be verified.",
        };
      }

      // When Azure returns multiple entries with the same label, use the
      // lowest confidence rather than overstating certainty.
      const confidence = Math.min(...confidences);

      if (confidence < config.threshold) {
        return {
          status: "manual_review",
          reason: "low_classification_confidence",
          classification: {
            docType: uniqueLabels[0],
            confidence,
            threshold: config.threshold,
          },
          message: "The document classification is uncertain. Please review it manually.",
        };
      }

      const docType = uniqueLabels[0];
      const modelId = config.routes[docType];

      if (typeof modelId !== "string" || !modelId.trim()) {
        return {
          status: "manual_review",
          reason: "unmapped_document_type",
          classification: {
            docType,
            confidence,
            threshold: config.threshold,
          },
          message: "No extraction model is configured for this document type.",
        };
      }

      return {
        status: "classified",
        classification: {
          docType,
          confidence,
          threshold: config.threshold,
        },
        modelId,
      };
    } catch (error) {
      if (timedOut) {
        throw new Error("Azure document classification timed out.");
      }

      // Avoid exposing signed URLs, credentials, or raw SDK request details.
      throw new Error("Azure document classification failed.");
    } finally {
      clearTimeout(timeout);
    }
  });
}
function safeDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") return null;

  const input = value.trim();
  if (!input) return null;

  function validatedDate(year, month, day) {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1000 ||
      year > 9999 ||
      month < 1 ||
      month > 12 ||
      day < 1
    ) {
      return null;
    }

    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }

    return [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-");
  }

  // Unambiguous year-first dates: YYYY-MM-DD or YYYY/MM/DD.
  let match = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return validatedDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }

  // Numeric dates are accepted only when their ordering is unambiguous.
  match = input.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);

    if (first <= 12 && second <= 12) {
      return null;
    }

    if (first > 12 && second <= 12) {
      return validatedDate(year, second, first);
    }

    if (second > 12 && first <= 12) {
      return validatedDate(year, first, second);
    }

    return null;
  }

  // Accept explicit day-month-name-year dates, e.g. 5 February 2025.
  match = input.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const monthNames = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];

    const monthIndex = monthNames.indexOf(match[2].toLowerCase());
    if (monthIndex < 0) return null;

    return validatedDate(
      Number(match[3]),
      monthIndex + 1,
      Number(match[1]),
    );
  }

  return null;
}
function normalizeText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "object") {
    if (value.content) {
      return String(value.content).trim() || null;
    }

    if (value.value !== undefined && value.value !== null) {
      if (value.value instanceof Date) {
        return safeDate(value.value);
      }

      return String(value.value).trim() || null;
    }
  }

  return null;
}

function findKeyValue(keyValuePairs, possibleKeys) {
  if (!Array.isArray(keyValuePairs)) {
    return null;
  }

  const normalizedKeys = possibleKeys.map((key) =>
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );

  for (const pair of keyValuePairs) {
    const keyText = normalizeText(pair?.key);

    if (!keyText) continue;

    const normalizedKey = keyText.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (normalizedKeys.some((key) => normalizedKey.includes(key))) {
      return normalizeText(pair?.value);
    }
  }

  return null;
}

function findDateFromText(text, keywords) {
  if (!text) return null;

  const keywordPattern = keywords.join("|");

  const patterns = [
    new RegExp(
      `(?:${keywordPattern})[^\\d]{0,30}(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})`,
      "i",
    ),

    new RegExp(
      `(?:${keywordPattern})[^\\d]{0,30}(\\d{1,2}[-/]\\d{1,2}[-/]\\d{4})`,
      "i",
    ),

    new RegExp(
      `(?:${keywordPattern})[^\\d]{0,30}(\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4})`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      const parsed = safeDate(match[1]);

      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function findDocumentNumber(text) {
  if (!text) return null;

  const patterns = [
    /(?:document\s*(?:no|number)|passport\s*(?:no|number)|id\s*(?:no|number)|license\s*(?:no|number)|registration\s*(?:no|number))[\s:#-]*([A-Z0-9][A-Z0-9-]{3,20})/i,

    /(?:No\.?|Number|NÂº)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim().toUpperCase();
    }
  }

  return null;
}

function classifyDocument(text, docType = "") {
  const value = `${docType} ${text}`.toLowerCase();

  if (
    value.includes("passport") ||
    value.includes("driver") ||
    value.includes("license") ||
    value.includes("identity") ||
    value.includes("national id") ||
    value.includes("philippine identification")
  ) {
    return "identification";
  }

  if (
    value.includes("insurance") ||
    value.includes("bank") ||
    value.includes("financial") ||
    value.includes("loan")
  ) {
    return "financial";
  }

  if (
    value.includes("medical") ||
    value.includes("hospital") ||
    value.includes("health")
  ) {
    return "medical";
  }

  if (
    value.includes("certificate") ||
    value.includes("birth") ||
    value.includes("marriage") ||
    value.includes("death")
  ) {
    return "civil";
  }

  if (
    value.includes("school") ||
    value.includes("university") ||
    value.includes("student") ||
    value.includes("education")
  ) {
    return "education";
  }

  return "other";
}

function inferTitle(text, docType) {
  const value = `${docType} ${text}`.toLowerCase();

  if (value.includes("passport")) {
    return "Passport";
  }

  if (value.includes("driver") && value.includes("license")) {
    return "Driver's License";
  }

  if (
    value.includes("philippine identification") ||
    value.includes("national id")
  ) {
    return "Philippine National ID";
  }

  if (value.includes("professional regulation commission")) {
    return "PRC ID";
  }

  if (value.includes("social security system")) {
    return "SSS ID";
  }

  if (value.includes("philhealth")) {
    return "PhilHealth ID";
  }

  if (value.includes("taxpayer identification")) {
    return "TIN ID";
  }

  if (value.includes("birth certificate")) {
    return "Birth Certificate";
  }

  if (value.includes("marriage certificate")) {
    return "Marriage Certificate";
  }

  if (docType) {
    return docType;
  }

  return null;
}

function normalizeAzureField(field, threshold) {
  if (field === null || field === undefined) {
    return {
      type: null,
      value: null,
      content: null,
      confidence: null,
      needsReview: true,
    };
  }

  if (typeof field !== "object" || Array.isArray(field) || field instanceof Date) {
    return {
      type: field instanceof Date ? "date" : typeof field,
      value: field instanceof Date
        ? (Number.isNaN(field.getTime()) ? null : field.toISOString())
        : field,
      content: null,
      confidence: null,
      needsReview: true,
    };
  }

  const knownTypes = [
    "String", "Date", "Time", "PhoneNumber", "Number", "Integer",
    "Boolean", "SelectionMark", "Signature", "CountryRegion",
    "Currency", "Address", "Array", "Object",
  ];

  const type = typeof field.type === "string" ? field.type : null;
  let value = null;

  if (type && Object.prototype.hasOwnProperty.call(field, `value${type}`)) {
    value = field[`value${type}`];
  } else {
    for (const candidate of knownTypes) {
      const key = `value${candidate}`;
      if (Object.prototype.hasOwnProperty.call(field, key)) {
        value = field[key];
        break;
      }
    }
  }

  if (value === null && Object.prototype.hasOwnProperty.call(field, "value")) {
    value = field.value;
  }

  function normalizeNested(valueToNormalize) {
    if (valueToNormalize === null || valueToNormalize === undefined) return null;

    if (valueToNormalize instanceof Date) {
      return Number.isNaN(valueToNormalize.getTime())
        ? null
        : valueToNormalize.toISOString();
    }

    if (Array.isArray(valueToNormalize)) {
      return valueToNormalize.map((item) => {
        if (item && typeof item === "object") {
          return normalizeAzureField(item, threshold);
        }
        return normalizeNested(item);
      });
    }

    if (typeof valueToNormalize === "object") {
      const normalized = {};
      for (const [key, nestedValue] of Object.entries(valueToNormalize)) {
        if (nestedValue && typeof nestedValue === "object" &&
            !Array.isArray(nestedValue) && !(nestedValue instanceof Date) &&
            ("type" in nestedValue || "value" in nestedValue ||
             "content" in nestedValue || "confidence" in nestedValue)) {
          normalized[key] = normalizeAzureField(nestedValue, threshold);
        } else {
          normalized[key] = normalizeNested(nestedValue);
        }
      }
      return normalized;
    }

    return valueToNormalize;
  }

  const numericConfidence =
    typeof field.confidence === "number" &&
    Number.isFinite(field.confidence) &&
    field.confidence >= 0 &&
    field.confidence <= 1
      ? field.confidence
      : null;

  return {
    type,
    value: normalizeNested(value),
    content: typeof field.content === "string" ? field.content : null,
    confidence: numericConfidence,
    needsReview:
      numericConfidence === null || numericConfidence < threshold,
  };
}
function parseAzureOutput(azureResult) {
  const result = {
    title: null,
    issuer: null,
    category: "other",
    documentNumber: null,
    issueDate: null,
    expiryDate: null,
    riskScore: null,
    riskLevel: null,
    confidence: 0,
    notes: null,
    rawText: null,
  };

  try {
    const document = azureResult?.documents?.[0];

    const content =
      azureResult?.content || azureResult?.documents?.[0]?.content || "";

    const fields = document?.fields || {};
    const fieldThreshold = Number(
      process.env.AZURE_FIELD_CONFIDENCE_THRESHOLD ?? "0.85",
    );
    if (!Number.isFinite(fieldThreshold) || fieldThreshold < 0 || fieldThreshold > 1) {
      throw new Error("Invalid AZURE_FIELD_CONFIDENCE_THRESHOLD.");
    }

    result.extractedFields = Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [
        name,
        normalizeAzureField(field, fieldThreshold),
      ]),
    );

    const docType = document?.docType || "";

    // Try structured fields first.
    const fieldTitle =
      normalizeText(fields.Title) ||
      normalizeText(fields.DocumentTitle) ||
      normalizeText(fields.DocumentType);

    const fieldIssuer =
      normalizeText(fields.Issuer) ||
      normalizeText(fields.Organization) ||
      normalizeText(fields.Authority);

    const fieldDocumentNumber =
      normalizeText(fields.DocumentNumber) ||
      normalizeText(fields.Number) ||
      normalizeText(fields.PassportNumber) ||
      normalizeText(fields.LicenseNumber);

    const fieldIssueDate =
      safeDate(fields.IssueDate?.value) ||
      safeDate(fields.Date?.value) ||
      safeDate(fields.IssuedDate?.value);

    const fieldExpiryDate =
      safeDate(fields.ExpiryDate?.value) ||
      safeDate(fields.ExpirationDate?.value) ||
      safeDate(fields.Expiry?.value);

    // Try key-value pairs.
    const kvDocumentNumber = findKeyValue(azureResult?.keyValuePairs, [
      "document number",
      "document no",
      "passport number",
      "passport no",
      "id number",
      "id no",
      "license number",
      "license no",
    ]);

    const kvIssueDate = findKeyValue(azureResult?.keyValuePairs, [
      "issue date",
      "issued date",
      "date issued",
    ]);

    const kvExpiryDate = findKeyValue(azureResult?.keyValuePairs, [
      "expiry date",
      "expiration date",
      "date of expiry",
      "valid until",
    ]);

    const documentNumber =
      fieldDocumentNumber || kvDocumentNumber || findDocumentNumber(content);

    const issueDate =
      fieldIssueDate ||
      safeDate(kvIssueDate) ||
      findDateFromText(content, ["issue date", "issued", "date issued"]);

    const expiryDate =
      fieldExpiryDate ||
      safeDate(kvExpiryDate) ||
      findDateFromText(content, [
        "expiry date",
        "expiration date",
        "valid until",
        "valid thru",
      ]);

    const title = fieldTitle || inferTitle(content, docType);

    const issuer =
      fieldIssuer ||
      findKeyValue(azureResult?.keyValuePairs, [
        "issuer",
        "issuing authority",
        "issuing agency",
        "issued by",
      ]) ||
      null;

    result.title = title;
    result.issuer = issuer;
    result.documentNumber = documentNumber;
    result.issueDate = issueDate;
    result.expiryDate = expiryDate;
    result.category = classifyDocument(content, docType);

    result.rawText = content || null;

    /*
     * Extraction completeness: how many of the five expected fields were found.
     * This measures the OCR, NOT the document.
     */
    const fieldsFound = [
      result.title,
      result.issuer,
      result.documentNumber,
      result.issueDate,
      result.expiryDate,
    ].filter(Boolean).length;

    result.confidence = Math.round((fieldsFound / 5) * 100);

    /*
     * Risk is deliberately left unassessed.
     *
     * This previously computed riskScore = 100 - completeness and derived
     * riskLevel from it, so a blurry photo with no readable fields was shown
     * to the user as "AI Risk Assessment: 100/100, HIGH" on an identity
     * document. That is a fabricated verdict about a passport. OCR says
     * nothing about whether a document is genuine, so no risk value is
     * produced unless a real detector supplies one.
     */
    result.riskScore = null;
    result.riskLevel = null;

    result.notes =
      `Extracted using Azure Document Intelligence. ` +
      `Model: ${docType || "prebuilt-document"}. ` +
      `Extraction completeness: ${result.confidence}%. ` +
      `Authenticity not assessed.`;

    return result;
  } catch (error) {
    console.error("Azure output parsing error:", error);
    return result;
  }
}

async function analyzeDocument(fileUrl, contentType) {
  if (!client) {
    throw new Error(
      "Azure Document Intelligence is not configured. Check AZURE_ENDPOINT and AZURE_KEY.",
    );
  }

  if (!fileUrl) {
    throw new Error("Document URL is required");
  }

  console.log("Analyzing document with Azure (URL redacted).");
  console.log(`Document content type: ${contentType || "unknown"}`);

  /*
   * Use the ID document model for identity documents.
   * For the general pipeline we start with prebuilt-document.
   *
   * Azure can analyze documents supplied by URL, including images and PDFs.
   */
  let modelId = "prebuilt-document";

  const lowerType = (contentType || "").toLowerCase();

  if (
    lowerType.includes("image") ||
    lowerType.includes("jpeg") ||
    lowerType.includes("jpg") ||
    lowerType.includes("png")
  ) {
    /*
     * prebuilt-idDocument is particularly useful for passports
     * and identity documents.
     *
     * We don't know from the MIME type alone whether every image
     * is an ID, so the caller can use the general model if needed.
     */
    modelId = "prebuilt-idDocument";
  }

  let poller;

  try {
    // Add timeout to prevent hanging
    const timeoutMs = 60000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OCR request timeout')), timeoutMs);
    });
    poller = await Promise.race([
      client.beginAnalyzeDocumentFromUrl(modelId, fileUrl),
      timeoutPromise
    ]);
  } catch (firstError) {
    const msg = String(firstError?.message || "");
    if (/timeout/i.test(msg)) {
      throw firstError;
    }
    console.warn(
      `Azure ${modelId} failed. Falling back to prebuilt-document:`,
      msg,
    );
    if (/401|403|unauthorized|forbidden|invalid.*key|access denied|authentication/i.test(msg)) {
      throw firstError;
    }
    try {
      const timeoutMs = 60000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('OCR request timeout')), timeoutMs);
      });
      poller = await Promise.race([
        client.beginAnalyzeDocumentFromUrl("prebuilt-document", fileUrl),
        timeoutPromise
      ]);
      modelId = "prebuilt-document";
    } catch (fallbackErr) {
      if (/timeout/i.test(String(fallbackErr?.message || ""))) {
        throw fallbackErr;
      }
      throw fallbackErr;
    }
  }

  try {
    const timeoutMs = 120000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OCR processing timeout')), timeoutMs);
    });
    const result = await Promise.race([
      poller.pollUntilDone(),
      timeoutPromise
    ]);

    if (!result) {
      throw new Error("Azure returned no analysis result");
    }

    console.log(`Azure analysis completed using ${modelId}`);

    return {
      ...result,
      _modelId: modelId,
    };
  } catch (pollErr) {
    if (/timeout/i.test(String(pollErr?.message || ""))) {
      throw new Error('OCR request timeout');
    }
    throw pollErr;
  }
}

async function extractClassifiedDocumentData(fileUrl, modelId, classification) {
  const config = getClassificationConfig();

  if (
    typeof fileUrl !== "string" ||
    !fileUrl.trim() ||
    typeof modelId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(modelId)
  ) {
    throw new Error("A valid document URL and explicitly mapped model ID are required.");
  }

  if (
    !classification ||
    typeof classification.docType !== "string" ||
    typeof classification.confidence !== "number" ||
    !Number.isFinite(classification.confidence) ||
    classification.confidence < config.threshold
  ) {
    throw new Error("Verified classification is required before document extraction.");
  }

  // Enforce the current configuration again at the extraction boundary.
  if (config.routes[classification.docType] !== modelId) {
    throw new Error("The extraction model does not match the configured classification route.");
  }

  const parsedUrl = new URL(fileUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("A valid HTTPS document URL is required for extraction.");
  }

  return withOcrConcurrencyLimit(config.maxConcurrency, async () => {
    const abortController = new AbortController();
    let poller;
    let timedOut = false;
    let timeout;

    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        abortController.abort();

        try {
          poller?.stopPolling?.();
        } catch {
          // Preserve the timeout error.
        }

        reject(new Error("Azure document extraction timed out."));
      }, config.timeoutMs);
    });

    try {
      const operation = (async () => {
        poller = await client.beginAnalyzeDocumentFromUrl(
          modelId,
          fileUrl,
          { abortSignal: abortController.signal },
        );

        if (timedOut) {
          try {
            poller.stopPolling?.();
          } catch {
            // Local polling cleanup is best-effort.
          }
          throw new Error("Azure document extraction timed out.");
        }

        const result = await poller.pollUntilDone({
          abortSignal: abortController.signal,
        });

        if (timedOut) {
          throw new Error("Azure document extraction timed out.");
        }

        if (!result) {
          throw new Error("Azure returned no document extraction result.");
        }

        return { ...result, _modelId: modelId };
      })();

      const azureResult = await Promise.race([operation, timeoutPromise]);
      const parsed = parseAzureOutput(azureResult);

      return {
        ...parsed,
        classification: {
          docType: classification.docType,
          confidence: classification.confidence,
          threshold: config.threshold,
        },
        extractedFields: parsed.extractedFields || {},
        raw: azureResult,
      };
    } catch (error) {
      if (timedOut) {
        throw new Error("Azure document extraction timed out.");
      }

      // Do not expose signed URLs, keys, or raw SDK request details.
      throw new Error("Azure document extraction failed.");
    } finally {
      clearTimeout(timeout);
    }
  });
}
exports.extractDocumentData = async (
  fileUrl,
  contentType = "application/pdf",
) => {
  try {
    const azureResult = await analyzeDocument(fileUrl, contentType);

    const parsed = parseAzureOutput(azureResult);

    console.log("Azure extraction result:", {
      title: parsed.title,
      issuer: parsed.issuer,
      documentNumber: parsed.documentNumber,
      issueDate: parsed.issueDate,
      expiryDate: parsed.expiryDate,
      confidence: parsed.confidence,
    });

    // Below this confidence the fields are guesses, not extractions. They are
    // still returned (so the user can review them) but flagged so the caller
    // does not treat them as usable data.
    if (parsed.confidence < MIN_COMPLETENESS_PERCENT) {
      console.warn("Logic engine: low-completeness extraction", {
        confidence: parsed.confidence,
        threshold: MIN_COMPLETENESS_PERCENT,
      });
    }

    // The unparsed analyzer payload is retained for auditing and re-runs.
    return { ...parsed, raw: azureResult };
  } catch (error) {
    console.error("Logic engine extraction error:", error);

    // DO NOT manufacture fake document information.
    throw error;
  }
};

exports.parseAzureOutput = parseAzureOutput;
exports.classifyDocument = classifyAzureDocument;




exports.extractClassifiedDocumentData = extractClassifiedDocumentData;
