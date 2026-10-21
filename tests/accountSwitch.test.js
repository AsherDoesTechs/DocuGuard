"use strict";

/**
 * The account switch rules.
 *
 * The device holds one vault. When a different account signs in, the previous
 * account's documents, reminders and settings have to go before the new
 * account can read anything, and the retry log has to go with them.
 *
 * These tests cover the cases that decide whether data is kept or removed,
 * and what happens to the records that are still waiting to be pushed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAccountSwitch } = require("../shared/sync/accountSwitch");

test("a different account takes over the device", () => {
  const decision = resolveAccountSwitch({ ownerId: 7, nextUserId: 9 });

  assert.equal(decision.accountChanged, true);
  assert.equal(
    decision.purgePreviousData,
    true,
    "the previous account's documents and reminders must be removed",
  );
  assert.equal(
    decision.clearRetryLog,
    true,
    "the retry log belongs to the previous account",
  );
  assert.equal(decision.releaseAuthBlocked, false);
});

test("the same account signing in again keeps everything", () => {
  const decision = resolveAccountSwitch({ ownerId: 7, nextUserId: 7 });

  assert.equal(decision.accountChanged, false);
  assert.equal(
    decision.purgePreviousData,
    false,
    "documents that never reached the cloud must survive a re-login",
  );
  assert.equal(
    decision.clearRetryLog,
    false,
    "the backoff and the attempt count describe real attempts",
  );
  assert.equal(
    decision.releaseAuthBlocked,
    true,
    "records blocked by an expired session can be pushed again",
  );
});

test("a fresh install keeps nothing and releases nothing", () => {
  const decision = resolveAccountSwitch({ ownerId: null, nextUserId: 7 });

  assert.equal(decision.accountChanged, false);
  assert.equal(decision.purgePreviousData, false);
  assert.equal(decision.clearRetryLog, false);
  assert.equal(decision.releaseAuthBlocked, true);
});

test("a sign-out is not a switch", () => {
  const decision = resolveAccountSwitch({ ownerId: 7, nextUserId: null });

  assert.equal(decision.accountChanged, false);
  assert.equal(
    decision.purgePreviousData,
    false,
    "signing out keeps the documents so the same account finds them again",
  );
  assert.equal(decision.clearRetryLog, false);
  assert.equal(decision.releaseAuthBlocked, false);
});

test("an unusable id is treated as no account", () => {
  for (const value of [0, -1, Number.NaN, "not a number", undefined, null]) {
    const decision = resolveAccountSwitch({
      ownerId: value,
      nextUserId: 7,
    });

    assert.equal(
      decision.purgePreviousData,
      false,
      `owner ${String(value)} must not trigger a purge`,
    );
  }
});

test("the ids are compared as numbers", () => {
  const decision = resolveAccountSwitch({ ownerId: "7", nextUserId: 7 });

  assert.equal(
    decision.accountChanged,
    false,
    "the id of the token is a string and the stored id is a number",
  );
});
