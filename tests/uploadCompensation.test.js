"use strict";

/**
 * The compensation for an upload that never became a document.
 *
 * The upload of a picked file happens before the document is written to the
 * database. When that write then fails, the object is in the bucket with
 * nothing pointing at it: nobody can reach it any more and nothing would
 * ever remove it.
 *
 * These tests cover the two questions that decide what happens: may this key
 * be removed, and should it be.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ownsStorageKey,
  resolveUploadCompensation,
} = require("../shared/sync/storageObjectPolicy");

const KEY = "7/2f1c9a0e-4b3d-4a1f-9c2e-8d5b6a7c8d9e.pdf";
const OTHER_KEY = "8/2f1c9a0e-4b3d-4a1f-9c2e-8d5b6a7c8d9e.pdf";

test("a key belongs to the account that uploaded it", () => {
  assert.equal(ownsStorageKey(KEY, 7), true);
  assert.equal(ownsStorageKey(OTHER_KEY, 7), false);
});

test("a key of another account is never removed", () => {
  assert.equal(ownsStorageKey("8/2f1c9a0e-4b3d-4a1f-9c2e-8d5b6a7c8d9e.pdf", 7), false);
  assert.equal(ownsStorageKey("7/../8/2f1c9a0e-4b3d-4a1f-9c2e-8d5b6a7c8d9e.pdf", 7), false);
  assert.equal(ownsStorageKey("somebody-else/file.pdf", 7), false);
});

test("a key that is not a stored name is refused", () => {
  assert.equal(ownsStorageKey("", 7), false);
  assert.equal(ownsStorageKey("   ", 7), false);
  assert.equal(ownsStorageKey(null, 7), false);
  assert.equal(ownsStorageKey(KEY, "7"), false);
  assert.equal(ownsStorageKey("7/not-a-uuid.pdf", 7), false);
  assert.equal(ownsStorageKey("7/2f1c9a0e4b3d4a1f9c2e8d5b6a7c8d9e.pdf", 7), false);
});

test("an object that never became a document is removed", () => {
  const decision = resolveUploadCompensation({
    uploadedKey: KEY,
    documentSaved: false,
  });

  assert.equal(decision.action, "remove");
  assert.equal(decision.s3Key, KEY);
});

test("an object that belongs to a document is kept", () => {
  const decision = resolveUploadCompensation({
    uploadedKey: KEY,
    documentSaved: true,
  });

  assert.equal(decision.action, "keep");
  assert.equal(decision.s3Key, KEY);
});

test("there is nothing to remove when no upload happened", () => {
  assert.equal(
    resolveUploadCompensation({ uploadedKey: null, documentSaved: false }).action,
    "none",
  );
  assert.equal(
    resolveUploadCompensation({ documentSaved: false }).action,
    "none",
  );
  assert.equal(
    resolveUploadCompensation({ uploadedKey: "  ", documentSaved: false }).action,
    "none",
  );
});
