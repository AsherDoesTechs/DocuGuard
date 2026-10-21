"use strict";

/**
 * The rules around an uploaded file that is not a document yet.
 *
 * The upload of a picked file happens before the document is written to the
 * database. Two questions follow from that order:
 *
 *   - may this storage key be removed? Only the account that uploaded it may
 *     remove it, and never while a document still points at it.
 *   - should it be removed? When the document was never written, the object is
 *     in the bucket with nothing pointing at it.
 *
 * Both rules live here so the client and the server cannot disagree about
 * them.
 */

/**
 * The storage key of an upload that is not attached to a document.
 */
const STORAGE_KEY_PATTERN = /^[0-9a-z-]+\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,8})?$/i;

/**
 * True when the key belongs to the given account.
 *
 * The stored name is always "<userId>/<uuid>.<ext>". A key that does not
 * follow that shape is refused, and so is a key that tries to walk out of the
 * account's own folder.
 *
 * @param {unknown} s3Key
 * @param {unknown} userId
 * @returns {boolean}
 */
function ownsStorageKey(s3Key, userId) {
  if (typeof s3Key !== "string" || typeof userId !== "number") {
    return false;
  }

  const trimmed = s3Key.trim();

  if (!trimmed || trimmed.includes("..")) {
    return false;
  }

  if (!trimmed.startsWith(`${userId}/`)) {
    return false;
  }

  return STORAGE_KEY_PATTERN.test(trimmed);
}

/**
 * Decides what happens to an uploaded object.
 *
 * @param {{ uploadedKey?: string | null, documentSaved?: boolean }} state
 * @returns {{ action: "keep" | "remove" | "none", s3Key: string | null }}
 *   "keep"   - the document exists, so the object belongs to it.
 *   "remove" - the object has to be removed, and the key says which one.
 *   "none"   - there is nothing to remove.
 */
function resolveUploadCompensation(state) {
  const uploadedKey =
    state && typeof state.uploadedKey === "string" ? state.uploadedKey.trim() : "";

  if (state && state.documentSaved) {
    return { action: "keep", s3Key: uploadedKey || null };
  }

  if (!uploadedKey) {
    return { action: "none", s3Key: null };
  }

  return { action: "remove", s3Key: uploadedKey };
}

module.exports = {
  STORAGE_KEY_PATTERN,
  ownsStorageKey,
  resolveUploadCompensation,
};
