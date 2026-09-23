import { Image } from "react-native";

export interface ExtractedDocumentData {
  title: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  category: string;
  confidence: number;
}

function extractFromUri(uri: string): Partial<ExtractedDocumentData> {
  const result: Partial<ExtractedDocumentData> = {};
  const filename = uri.split("/").pop() || "";
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  const parts = nameWithoutExt.split(/[_-]/);

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

    const dateMatch = part.match(/(\d{4})(\d{2})(\d{2})/);
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

export async function extractDocumentData(
  imageUri: string,
): Promise<ExtractedDocumentData> {
  const fromUri = extractFromUri(imageUri);

  return new Promise((resolve) => {
    Image.getSize(
      imageUri,
      (width, height) => {
        const confidence = Math.round(
          Math.min(width, height) > 400 ? 92 : Math.min(width, height) / 5,
        );
        resolve({
          title: fromUri.title || "Scanned Document",
          issuer: fromUri.issuer || "Unknown Issuer",
          documentNumber: fromUri.documentNumber || "",
          issueDate: fromUri.issueDate || "",
          expiryDate: fromUri.expiryDate || "",
          category: fromUri.category || "other",
          confidence,
        });
      },
      () => {
        resolve({
          title: "Scanned Document",
          issuer: "Unknown Issuer",
          documentNumber: "",
          issueDate: "",
          expiryDate: "",
          category: "other",
          confidence: 0,
        });
      },
    );
  });
}
