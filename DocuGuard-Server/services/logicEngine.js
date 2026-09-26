const {
  DocumentAnalysisClient,
  AzureKeyCredential,
} = require("@azure/ai-form-recognizer");

const endpoint = process.env.AZURE_ENDPOINT;
const apiKey = process.env.AZURE_KEY;

if (!endpoint || !apiKey) {
  console.warn(
    "AZURE_ENDPOINT or AZURE_KEY not configured. Azure OCR will be unavailable.",
  );
}

const client =
  endpoint && apiKey
    ? new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey))
    : null;

function safeDate(value) {
  if (!value) return null;

  try {
    if (value instanceof Date) {
      return value.toISOString().split("T")[0];
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  } catch (_) {}

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

    /(?:No\.?|Number|Nº)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,20})/i,
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

  return "Scanned Document";
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

    // Estimate extraction confidence from actual extracted fields.
    const fieldsFound = [
      result.title,
      result.issuer,
      result.documentNumber,
      result.issueDate,
      result.expiryDate,
    ].filter(Boolean).length;

    result.confidence = Math.round((fieldsFound / 5) * 100);

    // IMPORTANT:
    // This is extraction completeness, NOT proof of authenticity.
    result.riskScore = 100 - result.confidence;

    if (result.confidence >= 80) {
      result.riskLevel = "Low";
    } else if (result.confidence >= 50) {
      result.riskLevel = "Medium";
    } else {
      result.riskLevel = "High";
    }

    result.notes =
      `Extracted using Azure Document Intelligence. ` +
      `Model: ${docType || "prebuilt-document"}. ` +
      `Extraction completeness: ${result.confidence}%.`;

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

  console.log(`Analyzing document with Azure: ${fileUrl}`);
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
    poller = await client.beginAnalyzeDocumentFromUrl(modelId, fileUrl);
  } catch (firstError) {
    console.warn(
      `Azure ${modelId} failed. Falling back to prebuilt-document:`,
      firstError.message,
    );

    poller = await client.beginAnalyzeDocumentFromUrl(
      "prebuilt-document",
      fileUrl,
    );
    modelId = "prebuilt-document";
  }

  const result = await poller.pollUntilDone();

  if (!result) {
    throw new Error("Azure returned no analysis result");
  }

  console.log(`Azure analysis completed using ${modelId}`);

  return {
    ...result,
    _modelId: modelId,
  };
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

    return parsed;
  } catch (error) {
    console.error("Logic engine extraction error:", error);

    // DO NOT manufacture fake document information.
    throw error;
  }
};

exports.parseAzureOutput = parseAzureOutput;
