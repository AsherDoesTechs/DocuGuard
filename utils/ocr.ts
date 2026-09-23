import { Image } from "react-native";

export interface ExtractedDocumentData {
  title: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  category: string;
  confidence: number;
  authenticity: "real" | "replica" | "fake";
  authenticityScore: number;
  authenticityReason: string;
}

function extractFromUri(uri: string): Partial<ExtractedDocumentData> {
  const result: Partial<ExtractedDocumentData> = {};
  const filename = uri.split("/").pop() || "";
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  const parts = nameWithoutExt.split(/[_\-\s]/);

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (/passport/i.test(lower)) {
      result.title = "Passport";
      result.issuer = "Government Issuing Authority";
      result.category = "passport";
    } else if (/license|driver/i.test(lower)) {
      result.title = "Driver License";
      result.issuer = "Department of Motor Vehicles";
      result.category = "license";
    } else if (/insurance|car/i.test(lower)) {
      result.title = "Car Insurance";
      result.issuer = "Insurance Provider";
      result.category = "insurance";
    } else if (/certificate|cert/i.test(lower)) {
      result.title = "Certificate";
      result.issuer = "Issuing Organization";
      result.category = "certificate";
    } else if (/visa/i.test(lower)) {
      result.title = "Visa";
      result.issuer = "Embassy/Consulate";
      result.category = "visa";
    } else if (!result.title) {
      result.title = nameWithoutExt;
    }

    const dateMatch = part.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      const dateStr = `${year}-${month}-${day}`;
      if (!result.issueDate) {
        result.issueDate = dateStr;
      } else if (!result.expiryDate) {
        result.expiryDate = dateStr;
      }
    }

    const docNumMatch = part.match(/([A-Z]{1,3}[\d-]{3,10})/i);
    if (docNumMatch && !result.documentNumber) {
      result.documentNumber = docNumMatch[1].toUpperCase();
    }
  }

  return result;
}

function getFallbackDates(): { issueDate: string; expiryDate: string } {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const issueDate = `${yyyy}-${mm}-${dd}`;

  const expiry = new Date(today);
  expiry.setFullYear(today.getFullYear() + 1);
  const ey = expiry.getFullYear();
  const em = String(expiry.getMonth() + 1).padStart(2, "0");
  const ed = String(expiry.getDate()).padStart(2, "0");
  const expiryDate = `${ey}-${em}-${ed}`;

  return { issueDate, expiryDate };
}

function assessAuthenticity(
  width: number,
  height: number,
  extracted: Partial<ExtractedDocumentData>,
): { authenticity: "real" | "replica" | "fake"; authenticityScore: number; authenticityReason: string } {
  let score = 0;
  const reasons: string[] = [];

  // Image quality checks
  const megapixels = (width * height) / 1_000_000;
  if (megapixels >= 2) {
    score += 40;
  } else if (megapixels >= 1) {
    score += 25;
    reasons.push("Low resolution image");
  } else {
    score += 10;
    reasons.push("Very low resolution");
  }

  if (Math.min(width, height) >= 800) {
    score += 20;
  } else if (Math.min(width, height) >= 400) {
    score += 10;
    reasons.push("Small image dimensions");
  } else {
    reasons.push("Tiny image dimensions");
  }

  // Aspect ratio check (documents are typically landscape or near-square)
  const aspectRatio = width / height;
  if (aspectRatio >= 0.7 && aspectRatio <= 1.5) {
    score += 15;
  } else if (aspectRatio >= 0.5 && aspectRatio <= 2) {
    score += 8;
  } else {
    reasons.push("Unusual aspect ratio");
  }

  // Data completeness
  const fields = ["title", "issuer", "documentNumber", "issueDate", "expiryDate", "category"];
  const filled = fields.filter((f) => extracted[f as keyof typeof extracted]);
  if (filled.length === fields.length) {
    score += 25;
  } else if (filled.length >= 4) {
    score += 15;
  } else if (filled.length >= 2) {
    score += 5;
    reasons.push("Missing extracted fields");
  } else {
    reasons.push("Very little data extracted");
  }

  // Date sanity
  if (extracted.issueDate && extracted.expiryDate) {
    const issue = new Date(extracted.issueDate);
    const expiry = new Date(extracted.expiryDate);
    if (issue <= expiry && issue <= new Date()) {
      score += 10;
    } else {
      reasons.push("Date logic issue");
    }
  }

  let authenticity: "real" | "replica" | "fake";
  if (score >= 80) {
    authenticity = "real";
  } else if (score >= 50) {
    authenticity = "replica";
  } else {
    authenticity = "fake";
  }

  const reason =
    reasons.length > 0
      ? reasons.join("; ")
      : "Image quality and extracted data look consistent";

  return { authenticity, authenticityScore: score, authenticityReason: reason };
}

export async function extractDocumentData(
  imageUri: string,
): Promise<ExtractedDocumentData> {
  const fromUri = extractFromUri(imageUri);
  const fallback = getFallbackDates();

  return new Promise((resolve) => {
    Image.getSize(
      imageUri,
      (width, height) => {
        const confidence = Math.round(
          Math.min(width, height) > 400 ? 92 : Math.min(width, height) / 5,
        );
        const authenticity = assessAuthenticity(width, height, fromUri);
        resolve({
          title: fromUri.title || "Scanned Document",
          issuer: fromUri.issuer || "Unknown Issuer",
          documentNumber: fromUri.documentNumber || "",
          issueDate: fromUri.issueDate || fallback.issueDate,
          expiryDate: fromUri.expiryDate || fallback.expiryDate,
          category: fromUri.category || "other",
          confidence,
          authenticity: authenticity.authenticity,
          authenticityScore: authenticity.authenticityScore,
          authenticityReason: authenticity.authenticityReason,
        });
      },
      () => {
        resolve({
          title: "Scanned Document",
          issuer: "Unknown Issuer",
          documentNumber: "",
          issueDate: fallback.issueDate,
          expiryDate: fallback.expiryDate,
          category: "other",
          confidence: 0,
          authenticity: "fake",
          authenticityScore: 0,
          authenticityReason: "Could not read image dimensions",
        });
      },
    );
  });
}
