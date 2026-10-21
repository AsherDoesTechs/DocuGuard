"use strict";

/**
 * The ownership rules of a device push token.
 *
 * The token belongs to the device, not to the account, and the server keeps
 * it on the account row. A token attached to two accounts at once is the
 * cross-account notification leak: the daily expiry job would push one
 * account's document titles and expiry dates to a device signed in as the
 * other.
 *
 * These rules are pure, so they are checked without a device, a server or a
 * notification permission.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveSignOutTokenOutcome,
  resolveTokenHandover,
} = require("../shared/sync/pushTokenOwnership");

test("a failed removal leaves the device registered and warns the user", () => {
  const outcome = resolveSignOutTokenOutcome({ removalSucceeded: false });

  assert.equal(outcome.removalSucceeded, false);
  assert.equal(outcome.removalPending, true);
  assert.equal(outcome.warnUser, true);
});

test("a successful removal clears the pending state and the warning", () => {
  const outcome = resolveSignOutTokenOutcome({ removalSucceeded: true });

  assert.equal(outcome.removalSucceeded, true);
  assert.equal(outcome.removalPending, false);
  assert.equal(outcome.warnUser, false);
});

test("a missing removal result is treated as a failure", () => {
  const outcome = resolveSignOutTokenOutcome({});

  assert.equal(outcome.removalSucceeded, false);
  assert.equal(outcome.removalPending, true);
  assert.equal(outcome.warnUser, true);
});

test("signing in as a different account registers and detaches the previous", () => {
  const decision = resolveTokenHandover({
    registeredAccountId: 7,
    nextAccountId: 9,
  });

  assert.equal(decision.register, true);
  assert.equal(
    decision.detachPreviousAccount,
    true,
    "the token must be detached from the previous account",
  );
});

test("signing in as the same account registers but does not detach", () => {
  const decision = resolveTokenHandover({
    registeredAccountId: 7,
    nextAccountId: 7,
  });

  assert.equal(decision.register, true);
  assert.equal(decision.detachPreviousAccount, false);
});

test("signing in on a fresh device registers without detaching anything", () => {
  const decision = resolveTokenHandover({
    registeredAccountId: null,
    nextAccountId: 9,
  });

  assert.equal(decision.register, true);
  assert.equal(decision.detachPreviousAccount, false);
});

test("signing in without an account registers nothing", () => {
  const decision = resolveTokenHandover({
    registeredAccountId: 7,
    nextAccountId: null,
  });

  assert.equal(decision.register, false);
  assert.equal(decision.detachPreviousAccount, false);
});

test("unusable ids are treated as no account", () => {
  for (const value of [0, -1, Number.NaN, "not a number", undefined, null]) {
    const decision = resolveTokenHandover({
      registeredAccountId: value,
      nextAccountId: 9,
    });

    assert.equal(decision.register, true);
    assert.equal(
      decision.detachPreviousAccount,
      false,
    `a registration for ${String(value)} must not detach anything`);
  }
});
