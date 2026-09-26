import { documents } from "@/services/api";

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

interface DocumentCreatePayload {
  title: string;
  category: string;
  issuer: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string;
  enableAlerts: boolean;
  status: string;
  s3Key: string;
  fileUrl: string;
  fileType: string;
}

function getFileName(uri: string): string {
  const cleanUri = uri.split("?")[0];
  const filename = cleanUri.split("/").pop();

  return filename || `scanned_document_${Date.now()}.jpg`;
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

/**
 * Upload the scanned document to Supabase Storage
 * using the backend-generated signed upload URL.
 */
async function uploadScannedDocument(
  imageUri: string,
  fileName: string,
  fileType: string,
) {
  console.log("Requesting signed upload URL...");

  const uploadData = await documents.getUploadUrl(fileName, fileType);

  if (!uploadData?.uploadUrl) {
    throw new Error("The server did not return a valid upload URL.");
  }

  console.log("Uploading document to Supabase Storage...");

  await documents.uploadToS3(uploadData.uploadUrl, imageUri, fileType);

  return uploadData;
}

/**
 * Complete OCR pipeline:
 *
 * Camera
 * ↓
 * Backend signed upload URL
 * ↓
 * Supabase Storage
 * ↓
 * PostgreSQL document record
 * ↓
 * Azure Document Intelligence
 * ↓
 * Extracted document data
 */
export async function extractDocumentData(
  imageUri: string,
): Promise<ExtractedDocumentData> {
  if (!imageUri) {
    throw new Error("No document image was provided.");
  }

  const fileName = getFileName(imageUri);
  const fileType = getMimeType(imageUri);

  console.log("Starting document OCR:", fileName, fileType);

  // --------------------------------------------------
  // STEP 1: Upload scanned image to Supabase
  // --------------------------------------------------
  const uploadData = await uploadScannedDocument(imageUri, fileName, fileType);

  console.log("Document uploaded successfully:", uploadData.fileUrl);

  // --------------------------------------------------
  // STEP 2: Create document record in PostgreSQL
  // --------------------------------------------------
  const resolvedS3Key = uploadData.storagePath || uploadData.s3Key || "";

  const payload: DocumentCreatePayload = {
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
  };

  const created = await documents.create(payload);

  const documentId =
    created?.document?.id ?? created?.data?.document?.id ?? created?.id;

  if (!documentId) {
    throw new Error(
      "The document was uploaded, but the server did not return a document ID.",
    );
  }

  console.log("Document record created:", documentId);

  // --------------------------------------------------
  // STEP 3: Process document with Azure
  // --------------------------------------------------
  console.log("Sending document to Azure Document Intelligence...");

  const processed = await documents.processDocument(Number(documentId));

  if (!processed?.extractedData) {
    throw new Error(
      "Azure processing completed without returning extracted data.",
    );
  }

  console.log("Azure extraction completed:", processed.extractedData);

  // --------------------------------------------------
  // STEP 4: Normalize Azure response
  // --------------------------------------------------
  const data = processed.extractedData;

  return {
    title: data.title || "Scanned Document",
    issuer: data.issuer || "",
    documentNumber: data.documentNumber || "",
    issueDate: data.issueDate || "",
    expiryDate: data.expiryDate || "",
    category: data.category || "other",
    confidence:
      typeof data.confidence === "number"
        ? Math.max(0, Math.min(100, Math.round(data.confidence)))
        : 0,
    /*
     * OCR extraction does NOT prove authenticity.
     */
    authenticity: "replica",
    authenticityScore: 0,
    authenticityReason:
      "Document text was extracted successfully. Authenticity has not been independently verified.",
  };
}
