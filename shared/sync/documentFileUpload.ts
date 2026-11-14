/**
 * The rules for uploading a file that the user picked into the cloud.
 *
 * Mirrors backend (DocuGuard-Server/services/storageService.js).
 */

/** The formats the OCR pipeline can read, and therefore the only ones allowed. */
export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** The upload limit of the storage bucket. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function normalizeFileType(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.toLowerCase().split(";")[0].trim();
}

export function isAllowedFileType(fileType: unknown): boolean {
  return (ALLOWED_FILE_TYPES as readonly string[]).indexOf(normalizeFileType(fileType)) !== -1;
}

export function validateUploadFile(file: { fileType?: unknown; size?: unknown }): string | null {
  const type = normalizeFileType(file?.fileType);

  if (!type) {
    return "The file type could not be determined.";
  }

  if (!isAllowedFileType(type)) {
    return `Unsupported file type: ${type}. Allowed: ${ALLOWED_FILE_TYPES.join(", ")}`;
  }

  const size = file?.size;
  if (typeof size === "number" && Number.isFinite(size) && size > MAX_FILE_BYTES) {
    return `The file is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB limit.`;
  }

  return null;
}

export function needsStorageUpload(document: { s3Key?: unknown; fileUrl?: unknown } | null): boolean {
  if (!document) {
    return false;
  }

  const s3Key = document.s3Key;
  if (typeof s3Key === "string" && s3Key.trim().length > 0) {
    return false;
  }

  const fileUrl = document.fileUrl;
  if (typeof fileUrl === "string" && /^https:\/\//i.test(fileUrl.trim())) {
    return false;
  }

  return true;
}

export function buildUploadFileName(file: { name?: unknown; fileType?: unknown }): string {
  const type = normalizeFileType(file?.fileType);
  const extension = type === "application/pdf" ? "pdf" : type.split("/")[1] || "jpg";
  const original = typeof file?.name === "string" ? file.name : "";

  const match = original.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (match) {
    return `document.${match[1].toLowerCase()}`;
  }

  return `document.${extension}`;
}
