const { supabaseAdmin } = require("../config/supabase");
const crypto = require("crypto");

const STORAGE_BUCKET = "documents";

/**
 * Signed download URLs are deliberately short-lived. The app displays document
 * images from them, so a permanent public URL would mean that anyone who ever
 * saw or cached the URL kept permanent access to an identity document.
 */
const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Only formats the OCR pipeline can actually read are accepted.
 *
 * This was previously `application/octet-stream` for anything unrecognised,
 * which let an arbitrary executable be uploaded into the documents bucket and
 * then handed to the OCR analyzer as input.
 */
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024;

exports.ALLOWED_FILE_TYPES = ALLOWED_FILE_TYPES;
exports.MAX_FILE_BYTES = MAX_FILE_BYTES;

/**
 * Rejects file types outside the allow-list rather than silently defaulting.
 * Returns null when the type is acceptable.
 */
exports.validateFileType = (fileType) => {
  if (!fileType) {
    return "File type is required";
  }

  const normalized = String(fileType).toLowerCase().split(";")[0].trim();
  if (!ALLOWED_FILE_TYPES.has(normalized)) {
    return `Unsupported file type: ${normalized}. Allowed: ${[
      ...ALLOWED_FILE_TYPES,
    ].join(", ")}`;
  }

  return null;
};

/**
 * Mints a short-lived signed GET URL for a stored object.
 *
 * `s3Key` is the durable identifier; the URL is derived on demand and never
 * persisted as the source of truth.
 */
exports.getSignedDownloadUrl = async (s3Key) => {
  if (!s3Key) {
    return null;
  }

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(s3Key, SIGNED_URL_TTL_SECONDS);

  if (error) {
    throw new Error(`Supabase signed URL error: ${error.message}`);
  }

  return data?.signedUrl ?? null;
};

/**
 * Replaces a stored `fileUrl` with a freshly signed one where possible.
 *
 * Rows written before signed URLs existed only have `fileUrl`. Those are left
 * alone rather than blanked, so existing documents keep working until they are
 * re-uploaded.
 */
exports.rehydrateFileUrls = async (documents) => {
  return Promise.all(
    documents.map(async (document) => {
      if (document.s3Key) {
        try {
          const signedUrl = await exports.getSignedDownloadUrl(document.s3Key);
          if (signedUrl) {
            return { ...document, fileUrl: signedUrl };
          }
        } catch (error) {
          // Fall through to the stored URL rather than failing the whole list.
        }
      }
      return document;
    }),
  );
};

/**
 * Removes a stored object from the documents bucket.
 * Best-effort: logs but does not throw on failure so callers can proceed.
 */
exports.deleteStorageObject = async (s3Key) => {
  if (!s3Key) return;
  try {
    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove([s3Key]);
    if (error) {
      console.warn("Storage: Failed to remove stored object", {
        s3Key,
        error: error.message,
      });
    }
  } catch (err) {
    console.warn("Storage: Exception removing stored object", {
      s3Key,
      error: err.message,
    });
  }
};

/**
 * Get object metadata (size) from Supabase Storage.
 * Uses Supabase JS list API with pagination and returns verified byte size if found.
 */
exports.getObjectMetadata = async (s3Key) => {
  if (!s3Key) return null;
  try {
    const parts = String(s3Key).split("/");
    const fileName = parts[parts.length - 1];
    const prefix = parts.slice(0, -1).join("/") || "";
    const limit = 100;
    for (let page = 0; page < 20; page++) {
      const offset = page * limit;
      const { data, error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .list(prefix, { limit, offset, search: fileName });
      if (error) {
        throw error;
      }
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }
      const match = data.find((d) => d && d.name === fileName);
      if (match) {
        const size =
          match.metadata && typeof match.metadata.size === "number"
            ? match.metadata.size
            : typeof match.size === "number"
              ? match.size
              : null;
        if (typeof size === "number") {
          return { size, exists: true };
        }
        return { size: null, exists: true };
      }
      if (data.length < limit) {
        break;
      }
    }
    return null;
  } catch (err) {
    console.warn("Storage: Failed to get object metadata", {
      s3Key,
      error: err.message,
    });
    throw err;
  }
};

/**
 * Mints a short-lived signed upload URL for uploading files directly to Supabase Storage.
 */
exports.createSignedUploadUrl = async (filePath) => {
  if (!filePath) {
    throw new Error("File path is required for signed upload URL");
  }

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(filePath);

  if (error) {
    throw new Error(`Supabase signed upload URL error: ${error.message}`);
  }

  return {
    signedUrl: data?.signedUrl ?? data?.signed_url,
    path: data?.path ?? filePath,
  };
};

/**
 * Calculate physical storage usage for a user in MB.
 * Counts distinct object keys referenced by documents (including soft-deleted).
 * Does not scan the entire bucket. Orphaned objects not referenced by DB records are not counted by this design.
 * Returns null if calculation cannot be completed reliably.
 */
exports.calculateUserStorageUsage = async (userId) => {
  const db = require("../config/db");
  try {
    const result = await db.query(
      "SELECT DISTINCT s3_key FROM documents WHERE user_id = $1 AND s3_key IS NOT NULL AND s3_key <> ''",
      [userId],
    );
    let totalBytes = BigInt(0);
    const seen = new Set();
    for (const row of result.rows) {
      const key = row.s3_key;
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      try {
        const meta = await exports.getObjectMetadata(key);
        if (!meta) {
          return null;
        }
        if (typeof meta.size === "number") {
          totalBytes += BigInt(meta.size);
        } else {
          return null;
        }
      } catch (metaErr) {
        return null;
      }
    }
    return Number(totalBytes) / (1024 * 1024);
  } catch (err) {
    console.warn("Storage usage calculation failed:", err.message);
    return null;
  }
};
