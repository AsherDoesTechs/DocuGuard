const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 16;
const BCRYPT_ROUNDS = 12;

function normalizeRecoveryCode(code) {
  if (typeof code !== "string") return "";
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new TypeError("Recovery-code count must be between 1 and 20.");
  }

  return Array.from({ length: count }, () =>
    crypto.randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase(),
  );
}

async function hashRecoveryCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new TypeError("At least one recovery code is required.");
  }

  return Promise.all(
    codes.map(async (code) => {
      const normalized = normalizeRecoveryCode(code);

      if (!/^[A-F0-9]{32}$/.test(normalized)) {
        throw new TypeError("Invalid recovery-code format.");
      }

      return bcrypt.hash(normalized, BCRYPT_ROUNDS);
    }),
  );
}

async function verifyRecoveryCode(code, hashes) {
  const normalized = normalizeRecoveryCode(code);

  if (!/^[A-F0-9]{32}$/.test(normalized) || !Array.isArray(hashes)) {
    return -1;
  }

  for (let index = 0; index < hashes.length; index += 1) {
    if (typeof hashes[index] !== "string") continue;

    if (await bcrypt.compare(normalized, hashes[index])) {
      return index;
    }
  }

  return -1;
}

module.exports = {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  verifyRecoveryCode,
};