/**
 * The rules around an uploaded file that is not a document yet.
 */
export declare const STORAGE_KEY_PATTERN: RegExp;

/**
 * True when the key belongs to the given account.
 */
export declare function ownsStorageKey(
  s3Key: unknown,
  userId: unknown,
): boolean;

/**
 * Decides what happens to an uploaded object.
 */
export declare function resolveUploadCompensation(state: {
  uploadedKey?: string | null;
  documentSaved?: boolean;
}): { action: "keep" | "remove" | "none"; s3Key: string | null };
