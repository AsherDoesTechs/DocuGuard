import { documents } from "../services/api";

export interface ExtractedDocumentData {
  title: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  category: string;

  /**
   * Percentage of expected fields recovered by OCR.
   * This is extraction completeness, not authenticity or risk.
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

  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".heic")) return "image/heic";
  if (filename.endsWith(".heif")) return "image/heif";

  return "image/jpeg";
}

function normalizeExtractedData(data: any): ExtractedDocumentData {
  return {
    title: data?.title || "",
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
 * Uploads a scan, creates an OCR draft, and runs Azure OCR.
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
    // 1. Request a signed upload URL.
    const uploadData = await documents.getUploadUrl(fileName, fileType);

    if (!uploadData?.uploadUrl) {
      throw new Error("The server did not return a valid upload URL.");
    }

    // 2. Upload the actual file.
    await documents.uploadToS3(uploadData.uploadUrl, imageUri, fileType);

    const resolvedS3Key = String(
      uploadData.storagePath || uploadData.s3Key || "",
    ).trim();

    if (!resolvedS3Key) {
      throw new Error(
        "The upload succeeded, but the server did not return a storage key.",
      );
    }

    // 3. Create a draft that does not require OCR fields yet.
    const created = await documents.createOcrDraft({
      s3Key: resolvedS3Key,
      storagePath: resolvedS3Key,
      fileType,
    });

    const documentId = created?.document?.id ?? created?.id;

    if (!documentId) {
      throw new Error(
        "The file was uploaded, but the server did not return a document ID.",
      );
    }

    // 4. Run OCR against the saved draft.
    const processed = await documents.processDocument(Number(documentId));

    if (!processed?.extractedData) {
      throw new Error("OCR completed without returning extracted data.");
    }

    return {
      ...normalizeExtractedData(processed.extractedData),
      fileUrl: processed.document?.fileUrl ?? uploadData.fileUrl ?? undefined,
      s3Key: resolvedS3Key,
      storagePath: resolvedS3Key,
      documentId,
    };
  } catch (error: any) {
    // Log the failing stage and HTTP status for diagnosis without exposing
    // sensitive document data, tokens, or signed URLs.
    const endpoint = error?.config?.url;
    const stage = endpoint?.includes("/ocr-draft")
      ? "createOcrDraft"
      : endpoint?.includes("/process")
        ? "processDocument"
        : endpoint?.includes("/upload-url")
          ? "getUploadUrl"
          : endpoint?.includes("supabase")
            ? "uploadToS3"
            : "unknown";
    const status = error?.response?.status;
    const statusText = error?.response?.statusText;
    const errorCode = error?.response?.data?.code || error?.code;
    const serverMessage = error?.response?.data?.error || error?.message;
    console.warn("OCR pipeline failed", {
      stage,
      endpoint: endpoint ? endpoint.replace(/^https?:\/\/[^\/]+/, "") : undefined,
      status,
      statusText,
      errorCode,
      // Sanitized response details if present
      responseCode: error?.response?.data?.code,
      responseError: typeof error?.response?.data?.error === "string" ? error?.response?.data?.error.slice(0, 200) : undefined,
      responseErrorCode: error?.response?.data?.errorCode,
    });

    if (error?.isOffline) {
      throw new Error(
        "Network unavailable. Scanning requires an internet connection.",
      );
    }

    if (typeof serverMessage === "string" && serverMessage.trim()) {
      throw new Error(serverMessage);
    }

    throw error;
  }
}
