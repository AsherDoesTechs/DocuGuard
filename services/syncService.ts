import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import {
  getUnsyncedDocuments,
  getAllReminders,
  getUserProfile,
  setLocalPreferencesDirty,
  getAllDocuments,
  getUnsyncedReminders,
  getLocalUserId,
  markReminderSynced,
  updateDocumentSyncStatus,
  markDocumentSyncedWithCloud,
  setReminderCloudId,
  deleteDocument,
  logDocumentAction,
  LocalDocument,
  LocalReminder,
  LocalUserProfile,
} from "../services/localDatabase";
import { formatCategoryForBackend } from "@/utils/categories";
import {
  SYNC_OUTCOME,
  syncDeletedDocument,
  syncDocumentToCloud,
} from "@/shared/sync/documentSyncCore";
import {
  SyncFailure,
  classifySyncFailure,
  evaluateSyncGate,
} from "@/shared/sync/syncPolicy";
import { normalizeCloudId } from "@/shared/sync/cloudId";
import { createSyncMutex } from "@/shared/sync/syncMutex";
import { syncRetryStore } from "./syncRetryStore";

export type SyncConflict = {
  documentId: number;
  title: string;
  /** The revision the server holds, when the server reported one. */
  serverUpdatedAt: string | null;
};

export type SyncResult = {
  success: boolean;
  message: string;
  documentsSynced: number;
  remindersSynced: number;
  errors?: string[];
  /** Records that are still waiting for the user to resolve a failure. */
  documentsNeedingAttention?: number;
  /**
   * The documents the server refused to overwrite because they had been
   * changed somewhere else.
   *
   * The local copy of each of them is kept. The list is what makes the
   * situation actionable: the user can see which documents moved on and when
   * the server last changed them.
   */
  conflicts?: SyncConflict[];
};

export interface SyncToCloudOptions {
  /**
   * Attempt every queued record, ignoring the backoff. Used by the manual
   * "Sync now" button, where the user has just asked for it explicitly.
   */
  force?: boolean;
  /** Restrict the run to a single local document. */
  onlyDocumentId?: number;
  /**
   * Restrict the run to a set of local documents.
   *
   * The background worker collects the documents it was asked about while it
   * was busy, so two requests never cancel each other out.
   */
  onlyDocumentIds?: number[];
  /** Include reminders. Off for the background worker, which only owns documents. */
  includeReminders?: boolean;
  /** Include the cached profile. */
  includeProfile?: boolean;

  /**
   * Push the notification preferences that are marked as pending.
   *
   * Off for a pass that only owns documents, on for the background worker:
   * a preference that was changed while the device was offline has to reach
   * the server without the user having to press "Sync now".
   */
  includePreferences?: boolean;
  /** Trigger the server side cloud export. */
  triggerExport?: boolean;
}

/**
 * The lock that keeps two sync passes from touching the same queue at the
 * same time.
 *
 * The background worker and the manual "Sync now" button both push the same
 * documents to the same server. Two passes that run at the same time both read
 * the same pending row, both find no server row for it yet and both insert
 * one, so the document ends up on the server twice.
 */
const syncMutex = createSyncMutex();

/**
 * The key the retry log uses for a reminder.
 *
 * Documents and reminders have separate id sequences, so the same number can
 * belong to a document and to a reminder. The prefix keeps the two apart.
 */
function reminderRetryKey(reminderId: number): string {
  return `reminder:${reminderId}`;
}

const documentSyncDeps = {
  requestSync: (payload: any) => api.documents.syncDocument(payload),
  deleteCloudDocument: async (cloudId: number) => {
    await api.documents.delete(cloudId);
  },
  markSynced: (docId: number, cloudId: number | null, serverUpdatedAt: string | null) =>
    markDocumentSyncedWithCloud(docId, cloudId, serverUpdatedAt),
  markFailed: (docId: number) => updateDocumentSyncStatus(docId, "failed"),
  markDeleted: (docId: number) => deleteDocument(docId),
  formatCategory: (value: string | undefined) =>
    formatCategoryForBackend(value ?? "other"),
  onInternalError: (error: unknown, context: { stage: string; docId?: number }) => {
    console.warn(
      `Sync: internal error during ${context.stage} for document ${context.docId ?? "?"}`,
      error,
    );
  },
};

/**
 * Pushes the local vault to the cloud.
 *
 * The guarantees this function makes:
 *
 *   - `needsSync` is cleared only after the remote operation succeeded.
 *   - A failed record keeps its place in the queue and is retried later with
 *     an exponential backoff, up to a bounded number of attempts.
 *   - A permanently failing record is parked instead of being retried
 *     forever, and the user is told about it.
 *   - Nothing is ever deleted locally because the network is unavailable.
 *   - Two passes never run at the same time.
 */
export async function syncToCloud(
  options: SyncToCloudOptions = {},
): Promise<SyncResult> {
  return syncMutex.run(() => performSync(options));
}

async function performSync(options: SyncToCloudOptions): Promise<SyncResult> {
  const {
    force = false,
    onlyDocumentId,
    onlyDocumentIds,
    includeReminders = true,
    includeProfile = true,
    includePreferences = true,
    triggerExport = true,
  } = options;

  const token = await SecureStore.getItemAsync("userToken");
  if (!token) {
    return {
      success: false,
      message: "No authentication token. Please sign in first.",
      documentsSynced: 0,
      remindersSynced: 0,
    };
  }

  const errors: string[] = [];
  const conflicts: SyncConflict[] = [];
  let documentsSynced = 0;
  let remindersSynced = 0;
  let documentsNeedingAttention = 0;

  /*
   * The account this pass belongs to.
   *
   * The queue is read once, at the start of the pass, and the documents are
   * pushed one by one over the network. If the account changes in between,
   * the pass would push the first account's documents with the second
   * account's token - the documents would end up in the wrong account.
   *
   * The account is therefore remembered and checked again before every push.
   * When it changed, the pass stops: the documents stay queued and the next
   * pass of the new account picks up the new account's own queue.
   */
  const accountId = await getLocalUserId();

  const accountChanged = async (): Promise<boolean> => {
    if (accountId === null) {
      // Signed out while the pass was running.
      return true;
    }

    return (await getLocalUserId()) !== accountId;
  };

  try {
    // 1. Sync unsynced documents
    const unsyncedDocs = await getUnsyncedDocuments();

    /*
     * The scope of this pass.
     *
     * A pass may be restricted to one document, to a set of documents, or to
     * the whole queue. The set is the union of the requests that arrived while
     * a previous pass was running, so a request is never dropped because
     * another one came in behind it.
     */
    const scopeIds = new Set<number>();

    if (Array.isArray(onlyDocumentIds)) {
      for (const id of onlyDocumentIds) {
        if (Number.isSafeInteger(id) && id > 0) {
          scopeIds.add(id);
        }
      }
    }

    if (Number.isSafeInteger(onlyDocumentId) && (onlyDocumentId as number) > 0) {
      scopeIds.add(onlyDocumentId as number);
    }

    const targets = scopeIds.size
      ? unsyncedDocs.filter((doc) => scopeIds.has(doc.id as number))
      : unsyncedDocs;

    for (const doc of targets) {
      if (!doc.id) {
        continue;
      }

      /*
       * The account changed while this pass was running. Pushing now would
       * put the document in the wrong account, so the pass stops and the
       * document stays queued for the account that owns it.
       */
      if (await accountChanged()) {
        errors.push(
          "The signed-in account changed during the sync. The remaining documents were left in the queue.",
        );
        break;
      }

      if (!force) {
        const state = await syncRetryStore.get(doc.id);
        const gate = evaluateSyncGate(state, { force, now: Date.now() });

        // A record that already used up its attempts is not retried behind the
        // user's back. It stays visible in the vault and the user is told.
        if (!gate.attempt) {
          if (gate.needsAttention) {
            documentsNeedingAttention++;
            errors.push(
              `Document "${doc.title}": ${state?.lastError || "sync needs your attention"}`,
            );
          }

          // The backoff has not elapsed yet. Leave it queued.
          continue;
        }
      }

      const outcome =
        doc.status === "deleted"
          ? await syncDeletedDocument(doc, documentSyncDeps)
          : await syncDocumentToCloud(doc, documentSyncDeps);

      if (
        outcome.status === SYNC_OUTCOME.SYNCED ||
        outcome.status === SYNC_OUTCOME.DELETED
      ) {
        documentsSynced++;
        await syncRetryStore.clear(doc.id);

        if (outcome.status === SYNC_OUTCOME.SYNCED) {
          await logDocumentAction(doc.id!, "synced", doc);
        }
        continue;
      }

      const failure: SyncFailure =
        outcome.failure ??
        classifySyncFailure(new Error(outcome.message || "Sync failed"));

      /*
       * A conflict is reported separately.
       *
       * The server refused to overwrite the row because it had been changed
       * somewhere else. The local copy is kept and stays queued, and the
       * server's revision is reported so the user can see what the other
       * version is and when it changed. Nothing is overwritten on either
       * side: resolving the conflict is a decision the user has to make.
       */
      if (outcome.status === SYNC_OUTCOME.CONFLICT) {
        conflicts.push({
          documentId: doc.id,
          title: doc.title,
          serverUpdatedAt: outcome.serverUpdatedAt ?? null,
        });
      }

      await syncRetryStore.recordFailure(doc.id, failure, Date.now());

      if (failure.permanent) {
        documentsNeedingAttention++;
      }

      errors.push(`Document "${doc.title}": ${failure.message}`);
    }

    // 2. Sync reminders
    if (includeReminders) {
      const unsyncedReminders = await getUnsyncedReminders();
      for (const reminder of unsyncedReminders) {
        if (!reminder.id) {
          continue;
        }

        /*
         * The account changed while this pass was running. The reminder stays
         * queued for the account that owns it.
         */
        if (await accountChanged()) {
          errors.push(
            "The signed-in account changed during the sync. The remaining reminders were left in the queue.",
          );
          break;
        }

        /*
         * The retry state of a reminder lives under its own key.
         *
         * Documents and reminders have separate id sequences, so the same
         * number can belong to a document and to a reminder. The prefix keeps
         * the two apart.
         */
        const retryKey = reminderRetryKey(reminder.id);

        if (!force) {
          const state = await syncRetryStore.get(retryKey);
          const gate = evaluateSyncGate(state, { force, now: Date.now() });

          if (!gate.attempt) {
            // A parked reminder is not retried behind the user's back.
            if (gate.needsAttention) {
              documentsNeedingAttention++;
              errors.push(
                `Reminder "${reminder.title}": ${state?.lastError || "sync needs your attention"}`,
              );
            }

            // The backoff has not elapsed yet. Leave it queued.
            continue;
          }
        }

        try {
          // An already-uploaded reminder is updated in place. Without cloud_id the
          // only choice was create-or-create, so any retried or failed sync
          // appended another server copy of the same reminder.
          const response = reminder.cloudId
            ? await api.client.put(`/reminders/${reminder.cloudId}`, {
                title: reminder.title,
                description: reminder.description,
                dueDate: reminder.dueDate,
                severity: reminder.severity,
                isRead: reminder.read,
              })
            : await api.client.post("/reminders", {
                title: reminder.title,
                description: reminder.description,
                dueDate: reminder.dueDate,
                severity: reminder.severity,
                isRead: reminder.read,
              });

          /*
           * The id is normalised, not type-checked.
           *
           * `reminders.id` is a BIGSERIAL, so node-postgres returns it as the
           * string "42". The old `typeof cloudId === "number"` check threw
           * that away, `cloud_id` was never stored, and the update-in-place
           * branch above could never be taken: every reminder retry appended
           * another server row.
           */
          const cloudId = normalizeCloudId(
            response?.data?.id ?? response?.data?.reminder?.id,
          );
          if (cloudId) {
            await setReminderCloudId(reminder.id!, cloudId);
          }

          await markReminderSynced(reminder.id!);
          remindersSynced++;
          await syncRetryStore.clear(retryKey);
        } catch (err: any) {
          const failure: SyncFailure = classifySyncFailure(err);

          if (err?.response?.status === 404 && reminder.cloudId) {
            // The server copy was removed elsewhere; fall back to creating it.
            try {
              const created = await api.client.post("/reminders", {
                title: reminder.title,
                description: reminder.description,
                dueDate: reminder.dueDate,
                severity: reminder.severity,
                isRead: reminder.read,
              });
              const cloudId = normalizeCloudId(
                created?.data?.id ?? created?.data?.reminder?.id,
              );
              if (cloudId) {
                await setReminderCloudId(reminder.id!, cloudId);
              }
              await markReminderSynced(reminder.id!);
              remindersSynced++;
              await syncRetryStore.clear(retryKey);
              continue;
            } catch (retryErr: any) {
              errors.push(`Reminder "${reminder.title}": ${retryErr.message}`);
              await syncRetryStore.recordFailure(
                retryKey,
                classifySyncFailure(retryErr),
                Date.now(),
              );
              continue;
            }
          }

          if (failure.permanent) {
            documentsNeedingAttention++;
          }

          await syncRetryStore.recordFailure(retryKey, failure, Date.now());

          errors.push(`Reminder "${reminder.title}": ${failure.message}`);
        }
      }
    }

    // 3. Sync profile
    // PATCH /profile only accepts {name, email}; the notification flags were
    // being silently stripped by the server schema while it replied 200. Send
    // them to the endpoints that actually persist them.
    if (includeProfile || includePreferences) {
      const profile = await getUserProfile();
      if (profile) {
        try {
          if (includeProfile && profile.name) {
            await api.client.patch("/profile", { name: profile.name });
          }

          /*
           * The notification preferences are only pushed when the local copy
           * is marked as pending.
           *
           * The local row is a cache of the server's values, and it was
           * pushed on every pass. A preference that was changed on another
           * device was therefore overwritten by the older copy on this one,
           * and a preference that was changed here while the device was
           * offline was never pushed at all: the background worker does not
           * touch the profile, so the change only reached the server when the
           * user pressed "Sync now".
           *
           * The marker is cleared only after the server has accepted the
           * values, so a failed push is retried by the next pass.
           */
          if (includePreferences && profile.preferencesDirty) {
            await api.client.patch("/profile/preferences", {
              notifyPush: profile.notificationsEnabled,
              notifyEmail: profile.notifyEmail,
              notifyExpiry: profile.notifyExpiry,
            });

            await setLocalPreferencesDirty(false);
          }
        } catch (err: any) {
          if (err?.isOffline) {
            errors.push("Profile: offline");
          } else {
            errors.push(`Profile: ${err.message}`);
          }
        }
      }
    }

    // 4. Trigger cloud export
    if (triggerExport) {
      try {
        await api.cloud.exportData();
      } catch (err: any) {
        // Export is best-effort
      }
    }

    return {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? `Synced ${documentsSynced} documents and ${remindersSynced} reminders to cloud.`
          : `Synced ${documentsSynced} documents. ${errors.length} item(s) still need attention.`,
      documentsSynced,
      remindersSynced,
      errors: errors.length > 0 ? errors : undefined,
      documentsNeedingAttention,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Sync failed: ${err.message}`,
      documentsSynced,
      remindersSynced,
      errors: [err.message],
      documentsNeedingAttention,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }
}

export async function loadProfileFromLocal(): Promise<LocalUserProfile | null> {
  return await getUserProfile();
}

export async function loadDocumentsFromLocal(): Promise<LocalDocument[]> {
  return await getAllDocuments();
}

export async function loadRemindersFromLocal(): Promise<LocalReminder[]> {
  return await getAllReminders();
}
