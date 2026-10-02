import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import {
  getUnsyncedDocuments,
  markDocumentSynced,
  getAllReminders,
  getUserProfile,
  saveUserProfile,
  getAllDocuments,
  getDocumentById,
  getUnsyncedReminders,
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

type SyncResult = {
  success: boolean;
  message: string;
  documentsSynced: number;
  remindersSynced: number;
  errors?: string[];
};

export async function syncToCloud(): Promise<SyncResult> {
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
  let documentsSynced = 0;
  let remindersSynced = 0;

  try {
    // 1. Sync unsynced documents
    const unsyncedDocs = await getUnsyncedDocuments();
    for (const doc of unsyncedDocs) {
      try {
        if (doc.status === "deleted") {
          // Local ids are unrelated to backend ids. Without a stored cloud id the
          // row was never uploaded, so drop it locally and do not call the API.
          if (doc.cloudId) {
            try {
              await api.documents.delete(doc.cloudId);
            } catch (err: any) {
              // A row that is already gone on the server is a successful delete.
              // Treating 404 as a failure left the tombstone queued forever and
              // the document reappeared on the next pull.
              if (err?.response?.status !== 404) throw err;
            }
          }
          await deleteDocument(doc.id!);
          documentsSynced++;
          continue;
        }

        const payload: any = {
          title: doc.title,
          category: formatCategoryForBackend(doc.category),
          issuer: doc.issuer,
          documentNumber: doc.documentNumber,
          issueDate: doc.issueDate,
          expiryDate: doc.expiryDate,
          notes: doc.notes,
          status: doc.status === "verified" ? "verified" : "active",
          enableAlerts: doc.enableAlerts,
          s3Key: doc.s3Key,
          fileUrl: doc.fileUrl,
          fileType: doc.fileType,
          processingStatus: doc.processingStatus,
          riskScore: doc.riskScore,
          riskLevel: doc.riskLevel,
          cloudId: doc.cloudId ?? undefined,
          // Only claim a revision once this device has one, so the first sync of
          // a document still creates it rather than failing the guard.
          baseUpdatedAt: doc.serverUpdatedAt ?? undefined,
        };

        const result = await api.documents.syncDocument(payload);

        if (result?.conflict) {
          // Another device changed the server row since our last sync. Keep the
          // local copy and mark it clearly rather than overwriting either side.
          await updateDocumentSyncStatus(doc.id!, "failed");
          errors.push(
            `Document "${doc.title}": changed on another device, local copy kept. ` +
              `Review it, then sync again to overwrite.`,
          );
          continue;
        }

        const cloudId = result?.document?.id;
        const serverUpdatedAt =
          typeof result?.document?.updatedAt === "string"
            ? result.document.updatedAt
            : null;

        await markDocumentSyncedWithCloud(
          doc.id!,
          typeof cloudId === "number" ? cloudId : doc.cloudId ?? null,
          serverUpdatedAt,
        );
        await logDocumentAction(doc.id!, "synced", doc);
        documentsSynced++;
      } catch (err: any) {
        await updateDocumentSyncStatus(doc.id!, "failed");
        if (err?.response?.status === 409) {
          // Backend refused to touch a row it considered a conflict.
          errors.push(
            `Document ${doc.id} ("${doc.title}"): sync conflict, local copy kept`,
          );
        } else if (err?.isOffline) {
          errors.push(`Document ${doc.id}: offline`);
        } else {
          errors.push(`Document ${doc.id}: ${err.message}`);
        }
      }
    }

    // 2. Sync reminders
    const unsyncedReminders = await getUnsyncedReminders();
    for (const reminder of unsyncedReminders) {
      try {
        // An already-uploaded reminder is updated in place. Without cloud_id the
        // only choice was create-or-create, so any retried or failed sync
        // appended another server copy of the same reminder.
        const response = reminder.cloudId
          ? await api.client.patch(`/reminders/${reminder.cloudId}`, {
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

        const cloudId =
          response?.data?.id ?? response?.data?.reminder?.id ?? null;
        if (typeof cloudId === "number") {
          await setReminderCloudId(reminder.id!, cloudId);
        }

        await markReminderSynced(reminder.id!);
        remindersSynced++;
      } catch (err: any) {
        if (err?.isOffline) {
          errors.push(`Reminder "${reminder.title}": offline`);
        } else if (err?.response?.status === 404 && reminder.cloudId) {
          // The server copy was removed elsewhere; fall back to creating it.
          try {
            const created = await api.client.post("/reminders", {
              title: reminder.title,
              description: reminder.description,
              dueDate: reminder.dueDate,
              severity: reminder.severity,
              isRead: reminder.read,
            });
            const cloudId = created?.data?.id ?? created?.data?.reminder?.id;
            if (typeof cloudId === "number") {
              await setReminderCloudId(reminder.id!, cloudId);
            }
            await markReminderSynced(reminder.id!);
            remindersSynced++;
          } catch (retryErr: any) {
            errors.push(`Reminder "${reminder.title}": ${retryErr.message}`);
          }
        } else {
          errors.push(`Reminder "${reminder.title}": ${err.message}`);
        }
      }
    }

    // 3. Sync profile
    // PATCH /profile only accepts {name, email}; the notification flags were
    // being silently stripped by the server schema while it replied 200. Send
    // them to the endpoints that actually persist them.
    const profile = await getUserProfile();
    if (profile) {
      try {
        if (profile.name) {
          await api.client.patch("/profile", { name: profile.name });
        }

        await api.client.patch("/profile/preferences", {
          notifyPush: profile.notificationsEnabled,
          notifyEmail: profile.notifyEmail,
          notifyExpiry: profile.notifyExpiry,
        });
      } catch (err: any) {
        if (err?.isOffline) {
          errors.push("Profile: offline");
        } else {
          errors.push(`Profile: ${err.message}`);
        }
      }
    }

    // 4. Trigger cloud export
    try {
      await api.cloud.exportData();
    } catch (err: any) {
      // Export is best-effort
    }

    return {
      success: true,
      message: `Synced ${documentsSynced} documents and ${remindersSynced} reminders to cloud.`,
      documentsSynced,
      remindersSynced,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Sync failed: ${err.message}`,
      documentsSynced,
      remindersSynced,
      errors: [err.message],
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
