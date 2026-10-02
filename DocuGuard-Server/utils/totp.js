const crypto = require("crypto");

/**
 * RFC 4648 base32 encoding/decoding, used to represent the shared secret in the
 * form authenticator apps expect (no 0/1/8/9, grouped for readability).
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 character in TOTP secret");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

const DEFAULT_PERIOD_SECONDS = 30;

/** The current TOTP step counter (T = floor(unix time / 30)). */
function currentCounter(periodSeconds = DEFAULT_PERIOD_SECONDS) {
  return Math.floor(Date.now() / 1000 / periodSeconds);
}

/**
 * HMAC-SHA1 based one-time password, truncated to 6 digits.
 *
 * `counter` defaults to the current step so callers do not have to compute it.
 * Passing it explicitly is what makes RFC 6238 test vectors reproducible.
 */
function generateTOTP(secretBase32, counter, digits = 6) {
  const step = counter === undefined ? currentCounter() : counter;

  const key = base32Decode(secretBase32);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(step));

  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Generates a fresh shared secret. 20 bytes matches the RFC 4226 recommendation. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Verifies a user-supplied code, allowing a small window of steps on either
 * side to tolerate clock drift between the phone and the server.
 */
function verifyTOTP(secretBase32, token, window = 1) {
  if (typeof token !== "string" || !/^\d{6}$/.test(token.trim())) {
    return false;
  }

  if (typeof secretBase32 !== "string" || secretBase32.length === 0) {
    return false;
  }

  const cleaned = token.trim();
  const counter = currentCounter();

  for (let offset = -window; offset <= window; offset++) {
    let expected;
    try {
      expected = generateTOTP(secretBase32, counter + offset);
    } catch {
      // A corrupt stored secret must fail closed rather than propagate out of
      // the login route as a 500.
      return false;
    }

    // Constant-time comparison so a mismatch does not leak how much matched.
    if (
      expected.length === cleaned.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))
    ) {
      return true;
    }
  }

  return false;
}

function buildOtpAuthUri(secretBase32, account, issuer = "DocuGuard") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(
    issuer,
  )}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  base32Encode,
  base32Decode,
  generateTOTP,
  generateSecret,
  verifyTOTP,
  buildOtpAuthUri,
};
