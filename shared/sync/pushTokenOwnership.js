"use strict";

/**
 * The ownership of the push token of a device.
 *
 * The token is a property of the device, not of the account. The server
 * keeps it on the account row, and a token that is attached to two accounts
 * at once makes the daily expiry job push one account's document titles and
 * expiry dates to a device that is signed in as the other.
 *
 * The rules live here so they can be checked without a device and without a
 * server.
 */

/**
 * What the sign-out does with the token of the device.
 *
 * @param {{ removalSucceeded?: boolean }} state
 *   `removalSucceeded` is the outcome of the removal request. The removal
 *   runs while the session of the account is still valid, so the server
 *   knows whose token it is. A request that fails - an offline sign-out, a
 *   server error - leaves the token on the account row.
 * @returns {{
 *   removalSucceeded: boolean,
 *   removalPending: boolean,
 *   warnUser: boolean,
 * }}
 */
function resolveSignOutTokenOutcome(state) {
  const removalSucceeded = Boolean(state && state.removalSucceeded);

  return {
    removalSucceeded,
    /*
     * The device stays registered for the account until the server has been
     * told. It is not a leak into another account: the next registration
     * detaches the token from this one, because a token belongs to a single
     * account.
     */
    removalPending: !removalSucceeded,
    // The user has to know that the device is still registered, because the
    // notifications of the account they just left can still reach it.
    warnUser: !removalSucceeded,
  };
}

/**
 * What the sign-in does with the token of the device.
 *
 * @param {{ registeredAccountId?: number | null, nextAccountId?: number | null }} state
 *   `registeredAccountId` is the account the token was registered for, when
 *   the device knows it. `nextAccountId` is the account that is signing in.
 * @returns {{
 *   register: boolean,
 *   detachPreviousAccount: boolean,
 * }}
 */
function resolveTokenHandover(state) {
  const registered = normalise(state && state.registeredAccountId);
  const next = normalise(state && state.nextAccountId);

  return {
    // The token belongs to the account that is signing in, so it is
    // registered again for that account.
    register: next !== null,
    /*
     * A token that was registered for another account is detached from it.
     * The server does the detaching when the token is registered again, so
     * the client only has to register it.
     */
    detachPreviousAccount:
      registered !== null && next !== null && registered !== next,
  };
}

/**
 * A usable account id, or null.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function normalise(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

module.exports = {
  resolveSignOutTokenOutcome,
  resolveTokenHandover,
};
