"use strict";

/**
 * The decision a sign-in makes about the data that is on the device.
 *
 * The device holds one vault. When a different account signs in, the previous
 * account's documents, reminders and settings have to go before the new
 * account can read anything, and the retry log has to go with them: the log
 * says which records were pushed already, and that is only true for the
 * account it was written for.
 *
 * The rules live here so they can be checked without a database.
 */

/**
 * @param {{ ownerId?: number | null, nextUserId?: number | null }} state
 *   `ownerId` is the account the rows on disk belong to. `null` means that no
 *   account owns them, which is the case on a fresh install and after the
 *   upgrade that introduced per-account scoping.
 *   `nextUserId` is the account that is signing in.
 * @returns {{
 *   accountChanged: boolean,
 *   purgePreviousData: boolean,
 *   clearRetryLog: boolean,
 *   releaseAuthBlocked: boolean,
 * }}
 */
function resolveAccountSwitch(state) {
  const owner = normalise(state && state.ownerId);
  const next = normalise(state && state.nextUserId);

  // Nothing to compare: the rows on disk belong to nobody yet.
  if (owner === null) {
    return {
      accountChanged: false,
      purgePreviousData: false,
      clearRetryLog: false,
      // Records that were blocked by an expired session can be pushed again
      // now that there is a valid session.
      releaseAuthBlocked: true,
    };
  }

  if (next === null) {
    // No account is signing in. Nothing is purged and nothing is released.
    return {
      accountChanged: false,
      purgePreviousData: false,
      clearRetryLog: false,
      releaseAuthBlocked: false,
    };
  }

  if (owner === next) {
    /*
     * The same account signs in again.
     *
     * The vault stays exactly as it is, including the documents that never
     * reached the cloud. The retry log keeps the backoff and the attempt
     * count, because they describe real attempts against a reachable server.
     * The records that were blocked by an expired session are released: they
     * can be pushed now that there is a valid session again.
     */
    return {
      accountChanged: false,
      purgePreviousData: false,
      clearRetryLog: false,
      releaseAuthBlocked: true,
    };
  }

  /*
   * A different account.
   *
   * The previous account's rows are removed before the new account can read
   * anything, and the retry log is emptied: it belongs to the other account.
   */
  return {
    accountChanged: true,
    purgePreviousData: true,
    clearRetryLog: true,
    releaseAuthBlocked: false,
  };
}

/**
 * A usable account id, or null.
 */
function normalise(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

module.exports = {
  resolveAccountSwitch,
};
