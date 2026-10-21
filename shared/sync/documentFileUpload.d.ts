/** The formats the storage service accepts. */
export declare const ALLOWED_FILE_TYPES: string[];

/** The upload limit of the storage bucket, in bytes. */
export declare const MAX_FILE_BYTES: number;

/** Normalises a mime type the way the server does. */
export declare function normalizeFileType(value: unknown): string;

/** Whether a mime type is accepted by the storage service. */
export declare function isAllowedFileType(fileType: unknown): boolean;

/** The reason a file cannot be uploaded, or null when it can. */
export declare function validateUploadFile(file: {
  fileType?: unknown;
  size?: unknown;
}): string | null;

/** Whether the document still needs its file uploaded. */
export declare function needsStorageUpload(document: {
  s3Key?: unknown;
  fileUrl?: unknown;
} | null): boolean;

/** The file name to send to the upload endpoint. */
export declare function buildUploadFileName(file: {
  name?: unknown;
  fileType?: unknown;
}): string;
