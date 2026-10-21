import {
  createDocument,
  logDocumentAction,
  LocalDocument,
} from "./localDatabase";
import { api } from "./api";
import { scheduleRemindersForDocument } from "./notificationScheduler";
import {
  DocumentSaveResult,
  saveNewDocument,
} from "@/shared/sync/documentSaveCore";
import { normalizeCloudId } from "@/shared/sync/cloudId";
import { DebugLogger } from "./debugLogger";

/**
 * Creates a document in the local vault.
 *
 * The local insert is the only step that can fail the save. Everything after
 * it - the history entry, the expiration reminders, the push to the cloud - is
 * best effort and reported as a warning, because a document that is already
 * on the device is a document that exists.
 *
 * The cloud draft of a scanned document is linked to the local row through
 * `cloudId`. That link is what makes the later sync an update of the draft
 * instead of the creation of a second row for the same document.
 */
export async function saveDocumentToVault(
  payload: Partial<LocalDocument>,
): Promise<DocumentSaveResult> {
  return saveNewDocument(payload, {
    createLocal: (doc) => createDocument(doc),

    logAction: (localId, doc) =>
      logDocumentAction(localId, "created", doc as Partial<LocalDocument>),

    scheduleReminders: (localId, doc) =>
      scheduleRemindersForDocument({
        ...(doc as Partial<LocalDocument>),
        id: localId,
      } as LocalDocument),

    /*
     * The cloud draft exists because the scan uploaded the file and created
     * the draft before the user reviewed it. When the local insert fails, that
     * draft is an orphan that the user never completed, so it is removed
     * instead of being left in the account as a stray "Scanned Document".
     *
     * The id is normalised first: an id that cannot be normalised is not
     * sent at all, because a request with a malformed id could address a row
     * that was never created for this save. The server additionally scopes
     * the delete to the signed-in account, so it can only ever remove a row
     * that belongs to this user.
     */
    deleteCloudDraft: async (cloudId: number) => {
      const id = normalizeCloudId(cloudId);

      if (!id) {
        DebugLogger.warn("DocumentSave", "Skipped cloud draft compensation", {
          cloudId,
        });
        return;
      }

      await api.documents.delete(id);
    },

    onInternalError: (error, context) => {
      DebugLogger.warn("DocumentSave", "Save step failed", {
        stage: context.stage,
        docId: context.docId,
        error,
      });
    },
  });
}
