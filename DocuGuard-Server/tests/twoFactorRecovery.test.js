const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} = require("../utils/twoFactorRecovery");

test("generates ten unique high-entropy recovery codes by default", () => {
  const codes = generateRecoveryCodes();

  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);

  for (const code of codes) {
    assert.match(code, /^[A-F0-9]{32}$/);
  }
});

test("rejects invalid recovery-code counts", () => {
  assert.throws(() => generateRecoveryCodes(0), TypeError);
  assert.throws(() => generateRecoveryCodes(21), TypeError);
  assert.throws(() => generateRecoveryCodes(1.5), TypeError);
});

test("normalizes spaces and hyphens without changing code content", () => {
  assert.equal(
    normalizeRecoveryCode("ABCD-EF 0123"),
    "ABCDEF0123",
  );
});

test("hashes recovery codes without storing plaintext", async () => {
  const codes = generateRecoveryCodes(2);
  const hashes = await hashRecoveryCodes(codes);

  assert.equal(hashes.length, 2);
  assert.notEqual(hashes[0], codes[0]);
  assert.notEqual(hashes[1], codes[1]);

  assert.equal(await verifyRecoveryCode(codes[0], hashes), 0);
  assert.equal(await verifyRecoveryCode(codes[1], hashes), 1);
});

test("recovery-code verification is case-insensitive and rejects invalid codes", async () => {
  const codes = generateRecoveryCodes(1);
  const hashes = await hashRecoveryCodes(codes);

  assert.equal(
    await verifyRecoveryCode(codes[0].toLowerCase(), hashes),
    0,
  );
  assert.equal(await verifyRecoveryCode("not-a-valid-code", hashes), -1);
  assert.equal(await verifyRecoveryCode("", hashes), -1);
});

test("rejects malformed codes when hashing", async () => {
  await assert.rejects(
    () => hashRecoveryCodes(["short"]),
    TypeError,
  );
});