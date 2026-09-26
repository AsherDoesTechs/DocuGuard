import { supabase } from "../DocuGuard-Server/config/supabase";

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

    authenticity: "replica",
    authenticityScore: 0,
    authenticityReason:
      "OCR extraction succeeded. Authenticity has not been independently verified.",
  };
}

async function uploadToSignedUrl(
  uri: string,
  uploadUrl: string,
  mimeType: string,
): Promise<void> {
  const response = await fetch(uri);

  if (!response.ok) {
    throw new Error(`Could not read scanned image (${response.status})`);
  }

  const blob = await response.blob();

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();

    throw new Error(
      `Supabase upload failed: ${uploadResponse.status} ${errorText}`,
    );
  }
}

/**
 * Real OCR pipeline: Automatically fetches session token and API base URL.
 */
export async function extractDocumentData(
  imageUri: string,
): Promise<ExtractedDocumentData> {
  if (!imageUri) {
    throw new Error("No document image was provided.");
  }

  // Automatically get session token from Supabase client
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error(
      "Authentication token is required for document scanning. Please log in again.",
    );
  }

  // Get API base URL from environment variables (e.g., Expo Constants or process.env)
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.API_BASE_URL ||
    "https://your-backend-api-url.com"; // Fallback URL if needed

  const fileName = getFileName(imageUri);
  const fileType = getMimeType(imageUri);

  /*
   * STEP 1
   * Ask backend for a Supabase signed upload URL.
   */
  const uploadUrlResponse = await fetch(
    `${apiBaseUrl}/documents/upload-url?` +
      `fileName=${encodeURIComponent(fileName)}` +
      `&fileType=${encodeURIComponent(fileType)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!uploadUrlResponse.ok) {
    const text = await uploadUrlResponse.text();

    throw new Error(
      `Could not get upload URL: ${uploadUrlResponse.status} ${text}`,
    );
  }

  const uploadData = await uploadUrlResponse.json();
  const uploadUrl = uploadData?.uploadUrl;
  const fileUrl = uploadData?.fileUrl;

  if (!uploadUrl || !fileUrl) {
    throw new Error("Backend did not return valid upload information.");
  }

  /*
   * STEP 2
   * Upload image to Supabase Storage.
   */
  await uploadToSignedUrl(imageUri, uploadUrl, fileType);

  /*
   * STEP 3
   * Create the document database record.
   */
  const createResponse = await fetch(`${apiBaseUrl}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Scanned Document",
      category: "other",
      issuer: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null,
      notes: "Document uploaded for Azure OCR processing.",
      enableAlerts: true,
      status: "active",
      s3Key: uploadData.storagePath || uploadData.s3Key,
      fileUrl,
      fileType,
    }),
  });

  if (!createResponse.ok) {
    const text = await createResponse.text();

    throw new Error(
      `Could not create document: ${createResponse.status} ${text}`,
    );
  }

  const created = await createResponse.json();
  const documentId =
    created?.document?.id || created?.data?.document?.id || created?.id;

  if (!documentId) {
    throw new Error("Document was created but no document ID was returned.");
  }

  /*
   * STEP 4
   * Tell backend to send the uploaded document to Azure.
   */
  const processResponse = await fetch(`${apiBaseUrl}/documents/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      documentId,
    }),
  });

  const processJson = await processResponse.json();

  if (!processResponse.ok) {
    throw new Error(
      processJson?.error ||
        processJson?.message ||
        "Azure document processing failed.",
    );
  }

  if (!processJson?.extractedData) {
    throw new Error(
      "Azure processing completed but returned no extracted data.",
    );
  }

  return normalizeExtractedData(processJson.extractedData);
}
