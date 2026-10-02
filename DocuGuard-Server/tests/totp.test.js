const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateTOTP,
  generateSecret,
  verifyTOTP,
  base32Encode,
  base32Decode,
  buildOtpAuthUri,
} = require("../utils/totp");

// RFC 4226 Appendix D / RFC 6238 use this key: ASCII "12345678901234567890".
const RFC_KEY_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 round-trips the RFC test key", () => {
  const decoded = base32Decode(RFC_KEY_BASE32);
  assert.equal(decoded.length, 20);
  assert.equal(decoded.toString(), "12345678901234567890");
  assert.equal(base32Encode(decoded), RFC_KEY_BASE32);
});

test("base32 rejects characters outside the alphabet", () => {
  assert.throws(() => base32Decode("0189!!!"), /Invalid base32/);
});

test("TOTP matches the RFC 4226 Appendix D vectors", () => {
  // These are HOTP counters, which TOTP with an explicit counter reduces to.
  const vectors = {
    0: "755224",
    1: "287082",
    2: "359152",
    3: "969429",
    4: "338314",
    5: "254676",
    7: "162583",
  };

  for (const [counter, expected] of Object.entries(vectors)) {
    assert.equal(
      generateTOTP(RFC_KEY_BASE32, Number(counter)),
      expected,
      `counter ${counter}`,
    );
  }
});

test("generateTOTP defaults to the current 30-second step", () => {
  const secret = generateSecret();
  const counter = Math.floor(Date.now() / 1000 / 30);
  assert.equal(generateTOTP(secret), generateTOTP(secret, counter));
});

test("generated secrets are 32-character base32", () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.notEqual(secret, generateSecret());
});

test("verifyTOTP accepts the current, previous and next code", () => {
  const secret = generateSecret();
  const counter = Math.floor(Date.now() / 1000 / 30);

  for (const offset of [-1, 0, 1]) {
    assert.ok(
      verifyTOTP(secret, generateTOTP(secret, counter + offset)),
      `offset ${offset} should be inside the drift window`,
    );
  }
});

test("verifyTOTP rejects codes outside the drift window", () => {
  const secret = generateSecret();
  const counter = Math.floor(Date.now() / 1000 / 30);

  // Far enough in the past that no window position can match.
  const stale = generateTOTP(secret, counter - 10);
  assert.equal(verifyTOTP(secret, stale), false);
});

test("verifyTOTP rejects malformed tokens", () => {
  const secret = generateSecret();

  for (const token of ["", "12345", "1234567", "abcdef", "12 45 6", null, 123456]) {
    assert.equal(verifyTOTP(secret, token), false, `token ${token}`);
  }
});

test("verifyTOTP fails closed on a corrupt stored secret", () => {
  // A bad secret must not throw out of the login route as a 500.
  for (const secret of ["", "not-base32!", "1111", null, undefined, 42]) {
    assert.equal(verifyTOTP(secret, "123456"), false, `secret ${secret}`);
  }
});

test("buildOtpAuthUri produces a scannable otpauth URL", () => {
  const uri = buildOtpAuthUri("JBSWY3DPEHPK3PXP", "user@example.com");

  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=DocuGuard/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
  // The account must be encoded, otherwise "@" splits the label.
  assert.match(uri, /user%40example\.com/);
});