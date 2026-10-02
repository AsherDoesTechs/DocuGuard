import * as SecureStore from "expo-secure-store";
import { documents } from "../services/api";

export interface ExtractedDocumentData {
  title: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  category: string;
  /**
   * Percentage of the expected fields the OCR pass recovered.
   * This measures the OCR result only. It says nothing about whether the
   * document is genuine, and must never be presented as a risk or
   * authenticity score.
   */
  confidence: number;
  fileUrl?: string;
  s3Key?: string;
  storagePath?: string;
  documentId?: string | number;
}

function getFileName(uri: string): string {
  const cleanUri = uri.split("?")[0];
  const filename = cleanUri.split("/").pop();
  return filename || `document_${Date.now()}.jpg`;
}

function getMimeType(uri: string): string {
  const filename = getFileName(uri).toLowerCase();

  if (filename.endsWith(".png")) {
    return "image/png";
  }

  if (filename.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  return "image/jpeg";
}

function normalizeExtractedData(data: any): ExtractedDocumentData {
  return {
    title: data?.title || "Scanned Document",
    issuer: data?.issuer || "",
    documentNumber: data?.documentNumber || "",
    issueDate: data?.issueDate || "",
    expiryDate: data?.expiryDate || "",
    category: data?.category || "other",

    confidence:
      typeof data?.confidence === "number"
        ? Math.max(0, Math.min(100, Math.round(data.confidence)))
        : 0,
  };
}

/**
 * Real OCR pipeline using the backend API service.
 * Uploads to Supabase Storage via signed URL, creates a record, triggers Azure OCR.
 */
export async function extractDocumentData(
  imageUri: string,
): Promise<ExtractedDocumentData> {
  if (!imageUri) {
    throw new Error("No document image was provided.");
  }

  const fileName = getFileName(imageUri);
  const fileType = getMimeType(imageUri);

  try {
    const uploadData = await documents.getUploadUrl(fileName, fileType);

    if (!uploadData?.uploadUrl) {
      throw new Error("The server did not return a valid upload URL.");
    }

    await documents.uploadToS3(uploadData.uploadUrl, imageUri, fileType);

    const resolvedS3Key = uploadData.storagePath || uploadData.s3Key || "";

    const created = await documents.create({
      title: "Scanned Document",
      category: "other",
      issuer: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null,
      notes: "Scanned document awaiting Azure OCR processing.",
      enableAlerts: true,
      status: "active",
      s3Key: String(resolvedS3Key),
      fileUrl: uploadData.fileUrl,
      fileType,
    });

    const documentId =
      created?.document?.id ?? created?.id;

    if (!documentId) {
      throw new Error(
        "The document was uploaded, but the server did not return a document ID.",
      );
    }

    const processed = await documents.processDocument(Number(documentId));

    if (!processed?.extractedData) {
      throw new Error(
        "Azure processing completed without returning extracted data.",
      );
    }

    return {
      ...normalizeExtractedData(processed.extractedData),
      fileUrl: uploadData.fileUrl,
      s3Key: resolvedS3Key,
      storagePath: uploadData.storagePath || resolvedS3Key,
      documentId,
    };
  } catch (error: any) {
    if (error?.isOffline) {
      throw new Error(
        "Network unavailable. Scan requires an internet connection.",
      );
    }
    throw error;
  }
}
