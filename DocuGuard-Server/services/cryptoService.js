const crypto = require("crypto");

/**
 * Field-level encryption for PII at rest (ISO/IEC 27001 A.10 / A.8).
 *
 * Uses AES-256-GCM with a key derived from DOCUMENT_ENCRYPTION_KEY.
 * Each value is encrypted with a random 96-bit nonce, prepended to the
 * ciphertext, and authenticated with a 128-bit GCM tag.
 *
 * Format: base64(nonce(12) || ciphertext || tag(16))
 *
 * If DOCUMENT_ENCRYPTION_KEY is not set, encrypt() returns the plaintext
 * unchanged and decrypt() returns the input unchanged, with a warning.
 * This allows graceful degradation for deployments that have not rotated
 * their keys yet. Production deployments must set the key.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BITS = 256;
const NONCE_BITS = 96;
const TAG_BITS = 128;
const ENCRYPTED_MIN_LEN = (NONCE_BITS / 8) + (TAG_BITS / 8); // 28 bytes

function getKey() {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw) {
    return null;
  }
  // Derive a 32-byte key from the env var using SHA-256 so the key length
  // requirement is flexible (the env var can be a passphrase of any length).
  return crypto.createHash("sha256").update(raw).digest();
}

function hasKey() {
  return getKey() !== null;
}

/**
 * Detect whether a value is already encrypted (base64 nonce+ciphertext+tag).
 * Returns false for null/undefined, short strings, or non-base64 text
 * (legacy plaintext).
 */
function isEncrypted(value) {
  if (value === null || value === undefined) {
    return false;
  }
  const str = String(value);
  let buffer;
  try {
    buffer = Buffer.from(str, "base64");
  } catch (err) {
    return false;
  }
  return buffer.length >= ENCRYPTED_MIN_LEN;
}

/**
 * Encrypt a string value. Throws when no key is available — never silently
 * writes sensitive fields in plaintext.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) {
    return plaintext;
  }

  const key = getKey();
  if (!key) {
    throw new Error(
      "DOCUMENT_ENCRYPTION_KEY is not set. Refusing to store PII plaintext.",
    );
  }

  // Never double-encrypt an already-encrypted value.
  if (isEncrypted(plaintext)) {
    return plaintext;
  }

  const nonce = crypto.randomBytes(NONCE_BITS / 8);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([nonce, encrypted, tag]).toString("base64");
}

/**
 * Decrypt a value produced by encrypt(). Throws if the value appears to be
 * encrypted but decryption fails (tampered or corrupted ciphertext).
 * Legacy plaintext (non-encrypted) values are returned unchanged for
 * backward compatibility during migration.
 */
function decrypt(ciphertext) {
  if (ciphertext === null || ciphertext === undefined) {
    return ciphertext;
  }

  const key = getKey();
  if (!key) {
    throw new Error(
      "DOCUMENT_ENCRYPTION_KEY is not set. Refusing to read PII plaintext.",
    );
  }

  // Not encrypted (too short or not base64): legacy plaintext, return as-is.
  if (!isEncrypted(ciphertext)) {
    return String(ciphertext);
  }

  const buffer = Buffer.from(String(ciphertext), "base64");
  const nonce = buffer.subarray(0, NONCE_BITS / 8);
  const tag = buffer.subarray(buffer.length - TAG_BITS / 8);
  const encrypted = buffer.subarray(
    NONCE_BITS / 8,
    buffer.length - TAG_BITS / 8,
  );

  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new Error(
      "Failed to decrypt field: ciphertext may be tampered or corrupted",
    );
  }
}

/**
 * Encrypt an object's sensitive fields in place. Fields not present are
 * skipped. Returns the same object reference.
 */
function encryptFields(obj, fields) {
  for (const field of fields) {
    if (obj[field] !== undefined && obj[field] !== null) {
      obj[field] = encrypt(obj[field]);
    }
  }
  return obj;
}

/**
 * Decrypt an object's sensitive fields in place. Fields not present are
 * skipped. Returns the same object reference.
 *
 * If a field cannot be decrypted (e.g. tampered/corrupted ciphertext or
 * key mismatch for legacy data), it is set to null so reads do not fail.
 */
function decryptFields(obj, fields) {
  for (const field of fields) {
    if (obj[field] !== undefined && obj[field] !== null) {
      try {
        obj[field] = decrypt(obj[field]);
      } catch (_err) {
        obj[field] = null;
      }
    }
  }
  return obj;
}

// PII fields that must be encrypted at rest.
const PII_FIELDS = ["document_number", "issuer"];

module.exports = {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields,
  PII_FIELDS,
  hasKey,
  ALGORITHM,
};
