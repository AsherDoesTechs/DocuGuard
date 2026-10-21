"use strict";

/**
 * The scheduling and scoping rules of the background sync worker.
 *
 * The rules live here, away from React Native and away from the network, so
 * they can be asserted directly: when a pass runs, which documents it covers,
 * and how a request that arrives while a pass is running is folded into the
 * next one.
 */

/**
 * A request for a sync pass.
 *
 * @typedef {Object} SyncRequest
 * @property {boolean} force Attempt every queued record, ignoring the backoff.
 * @property {number[] | null} documentIds The documents to cover, or null for
 *   every queued document.
 */

/**
 * Merges a new request into the request that is already waiting.
 *
 * A request that arrives while a pass is running must not cancel the request
 * that came before it: the document the first request was about would then
 * stay in the queue until the next poll. The scopes are therefore unioned.
 *
 * A scope of `null` means "every queued document", which is a superset of any
 * other scope, so the merged scope stays `null` as soon as one of the two
 * requests is unscoped.
 *
 * @param {SyncRequest | null | undefined} current
 * @param {SyncRequest} request
 * @returns {SyncRequest}
 */
function mergeSyncRequest(current, request) {
  const incoming = {
    force: Boolean(request && request.force),
    documentIds:
      request && Array.isArray(request.documentIds)
        ? request.documentIds.filter(
            (id) => Number.isSafeInteger(id) && id > 0,
          )
        : null,
  };

  if (!current) {
    return incoming;
  }

  const currentIds = Array.isArray(current.documentIds)
    ? current.documentIds
    : null;

  const force = Boolean(current.force) || incoming.force;

  if (currentIds === null || incoming.documentIds === null) {
    return { force, documentIds: null };
  }

  const merged = new Set(currentIds);
  for (const id of incoming.documentIds) {
    merged.add(id);
  }

  return { force, documentIds: Array.from(merged) };
}

/**
 * The options a scope turns into for the sync pass.
 *
 * @param {SyncRequest | null | undefined} scope
 * @returns {{ force: boolean, onlyDocumentIds?: number[] }}
 */
function scopeToSyncOptions(scope) {
  const force = Boolean(scope && scope.force);

  if (!scope || !Array.isArray(scope.documentIds) || scope.documentIds.length === 0) {
    return { force };
  }

  return { force, onlyDocumentIds: scope.documentIds };
}

/**
 * Whether a pass has anything to do at all.
 *
 * @param {{ pendingDocuments?: number, pendingReminders?: number }} counts
 * @returns {boolean}
 */
function hasWork(counts) {
  const documents = Number(counts && counts.pendingDocuments) || 0;
  const reminders = Number(counts && counts.pendingReminders) || 0;

  return documents > 0 || reminders > 0;
}

/**
 * How long to wait before the next pass.
 *
 * A forced request runs immediately. Otherwise the pass waits for the rest of
 * the minimum interval, so a burst of saves does not turn into a burst of
 * network requests.
 *
 * @param {{ elapsedMs: number, force?: boolean, minIntervalMs: number }} options
 * @returns {number} The delay in milliseconds.
 */
function computeNextDelayMs(options) {
  const elapsed = Math.max(0, Number(options && options.elapsedMs) || 0);
  const minInterval = Math.max(0, Number(options && options.minIntervalMs) || 0);
  const force = Boolean(options && options.force);

  if (force) {
    return 0;
  }

  if (elapsed >= minInterval) {
    return 0;
  }

  return minInterval - elapsed;
}

module.exports = {
  mergeSyncRequest,
  scopeToSyncOptions,
  hasWork,
  computeNextDelayMs,
};
