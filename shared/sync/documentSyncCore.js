"use strict";

/**
 * The per-document sync routine, with every side effect injected.
 *
 * The previous implementation was a `for` loop inside a React screen that
 * called Axios and SQLite directly, which made three guarantees impossible to
 * test and easy to break:
 *
 *   1. `needsSync` was cleared by a separate call that could run even when the
 *      remote write had failed.
 *   2. A failed record was retried on every single sync pass, forever, with no
 *      bound and no backoff.
 *   3. A retry could create a second copy of the same document on the server.
 *
 * Here the remote call, the local bookkeeping and the clock are all
 * parameters, so each of those guarantees can be asserted directly.
 */

const {
  classifySyncFailure,
  buildDocumentSyncPayload,
  canonicalizeServerRevision,
  SYNC_FAILURE_KIND,
} = require("./syncPolicy");
const { normalizeCloudId } = require("./cloudId");

const SYNC_OUTCOME = Object.freeze({
  SYNCED: "synced",
  FAILED: "failed",
  CONFLICT: "conflict",
  DELETED: "deleted",
});

/**
 * Reads the server id out of a sync response.
 *
 * The id addresses the server row on the next push, so it has to be stored as
 * a number: a string in the `cloud_id` column would not match the integer the
 * server compares against.
 *
 * PostgreSQL `BIGSERIAL` ids arrive as strings (node-postgres parses `int8`
 * with `parseBigInteger`, which keeps the value as text). The id is therefore
 * normalised rather than type-checked. A value that cannot be normalised is
 * reported as "no id": a missing id costs one extra server-side resolution,
 * a wrong id would address the wrong row.
 *
 * @param {any} result
 * @returns {number | null}
 */
function readCloudId(result) {
  if (!result) {
    return null;
  }

  const candidate =
    (result.document && result.document.id) ?? result.id ?? null;

  return normalizeCloudId(candidate);
}

/**
 * Reads the server revision out of a sync response.
 *
 * The value is normalised into the format the server compares. A revision the
 * server did not send, or one that cannot be parsed, is reported as "no
 * revision" rather than stored, because a revision that cannot be compared
 * would turn every later push into a false conflict.
 */
function readServerUpdatedAt(result) {
  if (!result || !result.document) {
    return null;
  }

  const value = result.document.updatedAt ?? result.document.updated_at ?? null;

  return canonicalizeServerRevision(value);
}

/**
 * Reads the revision the server holds for a document it refused to overwrite.
 *
 * The value is deliberately not stored locally: adopting it would make the
 * next push compare against the revision the client never saw, which would
 * silently overwrite the change the conflict was raised for.
 */
function readConflictServerUpdatedAt(error) {
  const value =
    error?.response?.data?.serverUpdatedAt ??
    error?.response?.data?.server_updated_at ??
    null;

  return canonicalizeServerRevision(value);
}

/**
 * Marks the local row as failed without ever throwing.
 *
 * A failure to write the failure marker must not abort the whole sync pass
 * and strand every remaining document in the queue.
 */
async function safeMarkFailed(deps, docId) {
  try {
    await deps.markFailed(docId);
  } catch (error) {
    if (typeof deps.onInternalError === "function") {
      deps.onInternalError(error, { stage: "markFailed", docId });
    }
  }
}

/**
 * Pushes one document to the server.
 *
 * The contract:
 *   - `needsSync` is cleared only after the remote write has succeeded.
 *   - A remote failure leaves the record pending, so it is retried later.
 *   - A conflict never overwrites either side; the local copy is kept.
 */
async function syncDocumentToCloud(doc, deps) {
  const docId = doc && doc.id;
  const payload = buildDocumentSyncPayload(doc, {
    formatCategory: deps.formatCategory,
  });

  let result;

  try {
    result = await deps.requestSync(payload);
  } catch (error) {
    const failure = classifySyncFailure(error);
    await safeMarkFailed(deps, docId);

    const outcome = {
      status: SYNC_OUTCOME.FAILED,
      docId,
      failure,
      retryable: failure.retryable,
      permanent: failure.permanent,
      message: failure.message,
    };

    /*
     * A conflict carries the revision the server holds. It is reported so the
     * user can be told which version is on the server, but it is never stored:
     * adopting it would make the next push compare against a revision this
     * device never saw and would silently overwrite the change the conflict
     * was raised for.
     */
    if (failure.kind === SYNC_FAILURE_KIND.CONFLICT) {
      outcome.status = SYNC_OUTCOME.CONFLICT;
      outcome.serverUpdatedAt = readConflictServerUpdatedAt(error);
    }

    return outcome;
  }

  if (result && result.conflict) {
    const failure = {
      kind: SYNC_FAILURE_KIND.CONFLICT,
      retryable: false,
      permanent: true,
      status: 409,
      message:
        "This document was changed on another device. The local copy was kept.",
    };

    await safeMarkFailed(deps, docId);

    return {
      status: SYNC_OUTCOME.CONFLICT,
      docId,
      failure,
      serverUpdatedAt: readConflictServerUpdatedAt(result),
      retryable: false,
      permanent: true,
      message: failure.message,
    };
  }

  const cloudId = readCloudId(result);
  const serverUpdatedAt = readServerUpdatedAt(result);

  try {
    await deps.markSynced(docId, cloudId, serverUpdatedAt);
  } catch (error) {
    /*
     * The server already has the document, but the local row could not be
     * updated. The row therefore still carries `needsSync = 1` and the next
     * attempt re-sends the identical payload. The server resolves the same
     * row again, so this produces an update and never a second document.
     */
    const failure = {
      kind: SYNC_FAILURE_KIND.UNKNOWN,
      retryable: true,
      permanent: false,
      status: undefined,
      message:
        "The document reached the cloud but the local copy could not be updated.",
    };

    await safeMarkFailed(deps, docId);

    if (typeof deps.onInternalError === "function") {
      deps.onInternalError(error, { stage: "markSynced", docId });
    }

    return {
      status: SYNC_OUTCOME.FAILED,
      docId,
      failure,
      retryable: true,
      permanent: false,
      message: failure.message,
    };
  }

  return {
    status: SYNC_OUTCOME.SYNCED,
    docId,
    cloudId: cloudId ?? (doc.cloudId ?? null),
    serverUpdatedAt,
    retryable: false,
    permanent: false,
    message: "Synced",
  };
}

/**
 * Pushes a deletion.
 *
 * A tombstone without a cloud id was never uploaded, so there is nothing to
 * delete on the server and the local row is simply removed. A 404 counts as
 * success: the server copy is already gone.
 */
async function syncDeletedDocument(doc, deps) {
  const docId = doc && doc.id;

  try {
    if (doc.cloudId) {
      try {
        await deps.deleteCloudDocument(doc.cloudId);
      } catch (error) {
        const status =
          error && error.response && typeof error.response.status === "number"
            ? error.response.status
            : undefined;

        if (status !== 404) {
          throw error;
        }
      }
    }

    await deps.markDeleted(docId);
  } catch (error) {
    const failure = classifySyncFailure(error);
    await safeMarkFailed(deps, docId);

    return {
      status: SYNC_OUTCOME.FAILED,
      docId,
      failure,
      retryable: failure.retryable,
      permanent: failure.permanent,
      message: failure.message,
    };
  }

  return {
    status: SYNC_OUTCOME.DELETED,
    docId,
    retryable: false,
    permanent: false,
    message: "Deleted",
  };
}

module.exports = {
  SYNC_OUTCOME,
  syncDocumentToCloud,
  syncDeletedDocument,
  readCloudId,
  readServerUpdatedAt,
  readConflictServerUpdatedAt,
};
