"use strict";

/**
 * Unit tests for field-level encryption (cryptoService).
 *
 * No real keys, no production data, no network. Tests use in-memory
 * environment variables only.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const originalEnv = process.env.DOCUMENT_ENCRYPTION_KEY;

function withKey(key) {
  if (key === undefined) {
    delete process.env.DOCUMENT_ENCRYPTION_KEY;
  } else {
    process.env.DOCUMENT_ENCRYPTION_KEY = key;
  }

  // Clear the module cache so cryptoService picks up the new env var.
  delete require.cache[require.resolve("../services/cryptoService")];
  return require("../services/cryptoService");
}

function restore() {
  if (originalEnv === undefined) {
    delete process.env.DOCUMENT_ENCRYPTION_KEY;
  } else {
    process.env.DOCUMENT_ENCRYPTION_KEY = originalEnv;
  }
  delete require.cache[require.resolve("../services/cryptoService")];
}

test("encrypt and decrypt round-trip with a key", () => {
  const { encrypt, decrypt, hasKey } = withKey("my-test-encryption-key-12345");

  assert.equal(hasKey(), true);

  const plaintext = "X1234567";
  const encrypted = encrypt(plaintext);

  // Encrypted value should differ from plaintext and be base64.
  assert.notEqual(encrypted, plaintext);
  assert.match(encrypted, /^[A-Za-z0-9+/]+={0,2}$/);

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, plaintext);

  restore();
});

test("encrypt produces different ciphertext each time (random nonce)", () => {
  const { encrypt } = withKey("my-test-encryption-key-12345");

  const plaintext = "same-value";
  const e1 = encrypt(plaintext);
  const e2 = encrypt(plaintext);

  assert.notEqual(e1, e2, "random nonce should produce different ciphertext");
  restore();
});

test("decrypt throws on tampered ciphertext", () => {
  const { encrypt, decrypt } = withKey("my-test-encryption-key-12345");

  const encrypted = encrypt("secret-value");
  const buffer = Buffer.from(encrypted, "base64");

  // Corrupt a byte in the ciphertext region (not nonce, not tag).
  const corrupted = Buffer.from(buffer);
  corrupted[15] ^= 0xff; // byte 15 is inside the ciphertext region

  assert.throws(
    () => decrypt(corrupted.toString("base64")),
    /Failed to decrypt field/,
    "tampered ciphertext should throw",
  );
  restore();
});

test("decrypt of valid base64 that is too short returns input as-is", () => {
  const { decrypt } = withKey("my-test-encryption-key-12345");

  // Short base64 string - not long enough to be nonce + ciphertext + tag.
  // Returns the input unchanged (legacy plaintext handling).
  const short = "SGVsbG8=";
  assert.equal(decrypt(short), short);
  restore();
});

test("encrypt and decrypt handle null and undefined", () => {
  const { encrypt, decrypt } = withKey("my-test-encryption-key-12345");

  assert.equal(encrypt(null), null);
  assert.equal(encrypt(undefined), undefined);
  assert.equal(decrypt(null), null);
  assert.equal(decrypt(undefined), undefined);
  restore();
});

test("without a key, encrypt and decrypt throw (fail-safe, no plaintext)", () => {
  const { encrypt, decrypt, hasKey } = withKey(undefined);

  assert.equal(hasKey(), false);

  const plaintext = "X1234567";
  assert.throws(
    () => encrypt(plaintext),
    /Refusing to store PII plaintext/,
    "encrypt without key must throw",
  );
  assert.throws(
    () => decrypt(plaintext),
    /Refusing to read PII plaintext/,
    "decrypt without key must throw",
  );
  restore();
});

test("encrypt does not double-encrypt an already-encrypted value", () => {
  const { encrypt } = withKey("my-test-encryption-key-12345");

  const once = encrypt("secret-value");
  const twice = encrypt(once);

  assert.equal(twice, once, "already-encrypted value must be returned unchanged");
  restore();
});

test("decrypt returns legacy plaintext unchanged for backward compatibility", () => {
  const { decrypt } = withKey("my-test-encryption-key-12345");

  // Non-base64 legacy value.
  assert.equal(decrypt("not-encrypted-value"), "not-encrypted-value");
  // Too-short base64 legacy value.
  assert.equal(decrypt("SGVsbG8="), "SGVsbG8=");
  restore();
});

test("encryptFields skips already-encrypted fields on update", () => {
  const { encryptFields, decryptFields } = withKey("my-test-encryption-key-12345");

  const obj = {
    title: "Passport",
    document_number: "X1234567",
    issuer: "Department of Passports",
    expiry_date: "2030-05-03",
  };

  // First encryption.
  encryptFields(obj, ["document_number", "issuer"]);
  const encryptedDocNum = obj.document_number;
  const encryptedIssuer = obj.issuer;
  assert.notEqual(encryptedDocNum, "X1234567");
  assert.notEqual(encryptedIssuer, "Department of Passports");

  // Second encryption must not double-encrypt.
  encryptFields(obj, ["document_number", "issuer"]);
  assert.equal(obj.document_number, encryptedDocNum);
  assert.equal(obj.issuer, encryptedIssuer);

  // Decrypt returns original values.
  decryptFields(obj, ["document_number", "issuer"]);
  assert.equal(obj.document_number, "X1234567");
  assert.equal(obj.issuer, "Department of Passports");
  restore();
});

test("encryptFields and decryptFields operate on objects", () => {
  const { encryptFields, decryptFields } = withKey("my-test-encryption-key-12345");

  const obj = {
    title: "Passport",
    document_number: "X1234567",
    issuer: "Department of Passports",
    expiry_date: "2030-05-03",
  };

  encryptFields(obj, ["document_number", "issuer"]);
  assert.notEqual(obj.document_number, "X1234567");
  assert.notEqual(obj.issuer, "Department of Passports");
  assert.equal(obj.title, "Passport"); // not a PII field, unchanged
  assert.equal(obj.expiry_date, "2030-05-03"); // not a PII field, unchanged

  decryptFields(obj, ["document_number", "issuer"]);
  assert.equal(obj.document_number, "X1234567");
  assert.equal(obj.issuer, "Department of Passports");

  restore();
});

test("PII_FIELDS contains document_number and issuer", () => {
  const { PII_FIELDS } = withKey("my-test-encryption-key-12345");
  assert.deepEqual(PII_FIELDS, ["document_number", "issuer"]);
  restore();
});

test("decrypt of legacy plaintext (non-base64 or too short) returns as-is", () => {
  const { decrypt } = withKey("my-test-encryption-key-12345");

  // Plain text that isn't valid base64.
  assert.equal(decrypt("not-encrypted-value"), "not-encrypted-value");
  restore();
});
