"use strict";

/**
 * The document creation routine, with every side effect injected.
 *
 * Creating a document touches three different stores: the cloud (a draft row
 * and an uploaded file), the local SQLite database and the notification
 * scheduler. When all of that lived in one `try` block in a screen, a failure
 * in the last step reported the whole save as failed even though the document
 * had already been written, and the natural user reaction - press save again -
 * produced a second copy of the document.
 *
 * The rules enforced here:
 *   - The local insert is the only step that can fail the save.
 *   - A cloud draft whose local insert failed is compensated, so the account
 *     is not left with a half created document.
 *   - Everything after the insert is best effort and reported as a warning.
 */

const SAVE_STAGE = Object.freeze({
  LOCAL_INSERT: "localInsert",
  CLOUD_COMPENSATION: "cloudCompensation",
  HISTORY: "history",
  REMINDERS: "reminders",
  SYNC: "sync",
});

const { normalizeCloudId } = require("./cloudId");

class DocumentSaveError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "DocumentSaveError";
    this.stage = (details && details.stage) || SAVE_STAGE.LOCAL_INSERT;
    this.cause = details && details.cause;
    this.cloudId = (details && details.cloudId) ?? null;
    this.compensated = Boolean(details && details.compensated);
  }
}

/**
 * Saves a new document.
 *
 * `deps` must provide:
 *   - createLocal(payload)          -> the new local row id
 *   - logAction(localId, payload)   -> writes the history entry
 *   - scheduleReminders(document)   -> schedules the expiration alerts
 *   - deleteCloudDraft(cloudId)     -> removes an orphaned cloud draft
 *   - requestSync(localId)          -> optional immediate push to the cloud
 */
async function saveNewDocument(payload, deps) {
  /*
   * The cloud draft id that is compensated when the local insert fails.
   *
   * It is normalised rather than type-checked, because PostgreSQL BIGSERIAL
   * ids arrive as strings. An id that cannot be normalised is treated as "no
   * draft": the compensation then does nothing, which is far better than
   * deleting a row that was never created for this save.
   */
  const cloudId = normalizeCloudId(payload && payload.cloudId);

  let localId;

  try {
    localId = await deps.createLocal(payload);
  } catch (error) {
    /*
     * The cloud already holds a draft for this document but the local insert
     * failed, so the account now has a record the user never completed. Remove
     * it when we can; when we cannot, say so instead of failing silently.
     */
    let compensated = false;
    let compensationError = null;

    if (cloudId && typeof deps.deleteCloudDraft === "function") {
      try {
        await deps.deleteCloudDraft(cloudId);
        compensated = true;
      } catch (cleanupError) {
        compensationError = cleanupError;
      }
    }

    if (typeof deps.onInternalError === "function") {
      deps.onInternalError(error, { stage: SAVE_STAGE.LOCAL_INSERT });
    }

    if (compensationError && typeof deps.onInternalError === "function") {
      deps.onInternalError(compensationError, {
        stage: SAVE_STAGE.CLOUD_COMPENSATION,
      });
    }

    throw new DocumentSaveError(
      "The document could not be saved on this device.",
      {
        stage: SAVE_STAGE.LOCAL_INSERT,
        cause: error,
        cloudId,
        compensated,
      },
    );
  }

  const warnings = [];

  if (typeof deps.logAction === "function") {
    try {
      await deps.logAction(localId, payload);
    } catch (error) {
      warnings.push({
        stage: SAVE_STAGE.HISTORY,
        message: "The document was saved, but its history entry was not.",
      });

      if (typeof deps.onInternalError === "function") {
        deps.onInternalError(error, { stage: SAVE_STAGE.HISTORY, docId: localId });
      }
    }
  }

  if (typeof deps.scheduleReminders === "function") {
    try {
      await deps.scheduleReminders(localId, payload);
    } catch (error) {
      warnings.push({
        stage: SAVE_STAGE.REMINDERS,
        message:
          "The document was saved, but its expiration reminders could not be scheduled.",
      });

      if (typeof deps.onInternalError === "function") {
        deps.onInternalError(error, { stage: SAVE_STAGE.REMINDERS, docId: localId });
      }
    }
  }

  let syncAttempted = false;
  let syncSucceeded = false;

  if (typeof deps.requestSync === "function") {
    syncAttempted = true;

    try {
      const outcome = await deps.requestSync(localId);
      syncSucceeded = outcome === true || (outcome && outcome.synced === true);
    } catch (error) {
      if (typeof deps.onInternalError === "function") {
        deps.onInternalError(error, { stage: SAVE_STAGE.SYNC, docId: localId });
      }
    }
  }

  return {
    localId,
    cloudId,
    warnings,
    syncAttempted,
    syncSucceeded,
    /**
     * The document is on the device. Whether it also reached the cloud is
     * reported separately so the user is told the truth about both.
     */
    savedLocally: true,
  };
}

module.exports = {
  SAVE_STAGE,
  DocumentSaveError,
  saveNewDocument,
};
