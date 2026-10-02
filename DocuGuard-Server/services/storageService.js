const { supabaseAdmin } = require("../config/supabase");

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

const MAX_FILE_BYTES = 15 * 1024 * 1024;

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

exports.generatePresignedUploadUrl = async (userId, fileName, fileType) => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  if (!fileName) {
    throw new Error("File name is required");
  }

  const typeError = exports.validateFileType(fileType);
  if (typeError) {
    throw new Error(typeError);
  }

  // The stored name is fully server-generated. Taking any part of the
  // user-supplied name verbatim is what allowed path traversal attempts to
  // reach other users' objects.
  const extension = (String(fileName).match(/\.[a-zA-Z0-9]{1,8}$/) || [""])[0];
  const storagePath = `${userId}/${crypto.randomUUID()}${extension.toLowerCase()}`;

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath, {
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase signed URL error: ${error.message}`);
  }

  if (!data?.signedUrl) {
    throw new Error("Supabase did not return a signed upload URL");
  }

  // A short-lived signed GET URL, not the permanent public object URL. The
  // client refetches it through /documents/:id/file-url when it expires.
  const fileUrl = await exports.getSignedDownloadUrl(storagePath).catch(
    () => null,
  );

  return {
    uploadUrl: data.signedUrl,
    fileUrl,
    storagePath,
    s3Key: storagePath, // durable identifier; fileUrl is only a cached view
    fileType: String(fileType).toLowerCase().split(";")[0].trim(),
    maxBytes: MAX_FILE_BYTES,
  };
};