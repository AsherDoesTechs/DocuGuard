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
} from "../services/localDatabase";
import { LocalDocument, LocalReminder, LocalUserProfile } from "../types/offline";
import { formatCategoryForBackend } from "@/DocuGuard-Server/utils/categories";

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
          await api.documents.delete(doc.id!);
        } else {
          const payload: any = {
            title: doc.title,
            category: formatCategoryForBackend(doc.category),
            issuer: doc.issuer,
            documentNumber: doc.documentNumber,
            issueDate: doc.issueDate,
            expiryDate: doc.expiryDate,
            notes: doc.notes,
            status: doc.status,
            enableAlerts: doc.enableAlerts,
            s3Key: doc.s3Key,
            fileUrl: doc.fileUrl,
            fileType: doc.fileType,
            processingStatus: doc.processingStatus,
            riskScore: doc.riskScore,
            riskLevel: doc.riskLevel,
          };
          await api.documents.syncDocument(payload);
        }
        await markDocumentSynced(doc.id!);
        documentsSynced++;
      } catch (err: any) {
        errors.push(`Document ${doc.id}: ${err.message}`);
      }
    }

    // 2. Sync reminders
    const unsyncedReminders = await getUnsyncedReminders();
    for (const reminder of unsyncedReminders) {
      try {
        await api.client.post("/reminders", {
          title: reminder.title,
          description: reminder.description,
          dueDate: reminder.dueDate,
          severity: reminder.severity,
          isRead: reminder.read,
        });
        remindersSynced++;
      } catch (err: any) {
        errors.push(`Reminder: ${err.message}`);
      }
    }

    // 3. Sync profile
    const profile = await getUserProfile();
    if (profile) {
      await api.client.patch("/profile", {
        name: profile.name,
        notificationsEnabled: profile.notificationsEnabled,
        notifyEmail: profile.notifyEmail,
        notifyExpiry: profile.notifyExpiry,
        twoFactor: profile.twoFactor,
      });
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
