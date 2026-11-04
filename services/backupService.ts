import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Alert } from "react-native";
import {
  getAllDocuments,
  getAllReminders,
  getActiveLocalUserIdStrict,
  previewLocalBackupRestore,
  restoreLocalBackup,
  type BackupRestoreSummary,
} from "./localDatabase";
import { getStoredToken, runWithValidatedStoredSession } from "./api";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  validateBackup,
  type BackupData,
} from "../shared/backup/schema";
import {
  normalizeBackupDate,
  normalizeBackupTimestamp,
} from "../shared/backup/normalizers";

type BackupSessionContext = {
  token: string;
  userId: number;
};

async function getBackupSessionContext(): Promise<BackupSessionContext> {
  const token = await getStoredToken();

  if (!token) {
    throw new Error("Please sign in before restoring a backup.");
  }

  const userId = await getActiveLocalUserIdStrict();

  if (!userId) {
    throw new Error("An active account is required to restore a backup.");
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token.");

    const encodedPayload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const paddedPayload = encodedPayload.padEnd(
      Math.ceil(encodedPayload.length / 4) * 4,
      "=",
    );
    const payload = JSON.parse(atob(paddedPayload));
    const tokenUserId = Number(payload?.userId);
    const expiresAt = Number(payload?.exp);

    if (
      !Number.isSafeInteger(tokenUserId) ||
      tokenUserId <= 0 ||
      tokenUserId !== userId
    ) {
      throw new Error("The backup account does not match the active session.");
    }

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    return { token, userId };
  } catch (error) {
    if (error instanceof Error && error.message !== "Invalid token.") {
      throw error;
    }
    throw new Error("Your session token is invalid. Please sign in again.");
  }
}
const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024;

async function pickAndValidateLocalBackup(): Promise<BackupData | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];

  if (!asset) {
    throw new Error("No backup file was selected.");
  }

  const file = new File(asset.uri);
  const fileSize = asset.size ?? file.size;

  if (fileSize !== null && fileSize > MAX_BACKUP_FILE_BYTES) {
    throw new Error("Backup files must be 20 MB or smaller.");
  }

  const contents = await file.text();

  if (contents.length > MAX_BACKUP_FILE_BYTES / 2) {
    throw new Error("The selected backup file is too large.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  const validation = validateBackup(parsed);

  if (!validation.success) {
    throw new Error(
      "This file is not a valid supported DocuGuard backup. Check its format and version.",
    );
  }

  return validation.data;
}

export async function importLocalBackup(): Promise<void> {
  try {
    const backup = await pickAndValidateLocalBackup();

    if (!backup) return;

    const session = await getBackupSessionContext();

    const preview = await runWithValidatedStoredSession(
      session.token,
      () => previewLocalBackupRestore(backup, session.userId),
    );

    const previewMessage = [
      `Documents to restore: ${preview.documentsInserted}`,
      `Exact duplicates skipped: ${preview.documentsSkippedExact}`,
      `Possible duplicates skipped: ${preview.documentsSkippedPossible}`,
      `Reminders to restore: ${preview.remindersInserted}`,
      `Duplicate reminders skipped: ${preview.remindersSkipped}`,
      "",
      "Document files and attachments are not included in this backup.",
      "Existing records will not be overwritten.",
    ].join("\n");

    Alert.alert(
      "Review Backup Restore",
      previewMessage,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Restore",
          onPress: async () => {
            try {
              const restored = await runWithValidatedStoredSession(
                session.token,
                () => restoreLocalBackup(backup, session.userId),
              );

              Alert.alert(
                "Restore Complete",
                [
                  `Documents restored: ${restored.documentsInserted}`,
                  `Exact duplicates skipped: ${restored.documentsSkippedExact}`,
                  `Possible duplicates skipped: ${restored.documentsSkippedPossible}`,
                  `Reminders restored: ${restored.remindersInserted}`,
                  `Duplicate reminders skipped: ${restored.remindersSkipped}`,
                ].join("\n"),
              );
            } catch (error) {
              console.error("Backup restore failed:", error);
              Alert.alert(
                "Restore Failed",
                error instanceof Error
                  ? error.message
                  : "Could not restore this backup. Please try again.",
              );
            }
          },
        },
      ],
    );
  } catch (error) {
    console.error("Backup import failed:", error);
    Alert.alert(
      "Import Failed",
      error instanceof Error
        ? error.message
        : "Could not import this backup. Please try again.",
    );
  }
}
export async function exportLocalBackup(): Promise<void> {
  try {
    const [documents, reminders] = await Promise.all([
      getAllDocuments(),
      getAllReminders(),
    ]);

    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),

      documents: documents.map((doc) => ({
        title: doc.title,
        category: doc.category,
        issuer: doc.issuer || null,
        documentNumber: doc.documentNumber || null,
        issueDate: normalizeBackupDate(doc.issueDate),
        expiryDate: normalizeBackupDate(doc.expiryDate),
        notes: doc.notes ?? null,
        status: doc.status,
        enableAlerts: doc.enableAlerts === true,
        reminderIntervalDays:
          Number.isInteger(doc.reminderIntervalDays) &&
          (doc.reminderIntervalDays as number) >= 1 &&
          (doc.reminderIntervalDays as number) <= 365
            ? doc.reminderIntervalDays
            : null,
        reminderIntervals: Array.isArray(doc.reminderIntervals)
          ? doc.reminderIntervals.filter(
              (value) =>
                Number.isInteger(value) && value >= 1 && value <= 365,
            ).slice(0, 20)
          : [],
        fileType: doc.fileType ?? null,
        processingStatus: doc.processingStatus,
        riskScore: doc.riskScore ?? null,
        riskLevel: doc.riskLevel ?? null,
        createdAt: normalizeBackupTimestamp(doc.createdAt),
        updatedAt: normalizeBackupTimestamp(doc.updatedAt),
        tags: Array.isArray(doc.tags) ? doc.tags : [],
      })),

      reminders: reminders.map((reminder) => ({
        title: reminder.title,
        description: reminder.description ?? null,
        dueDate: normalizeBackupDate(reminder.dueDate),
        severity: reminder.severity,
        read: reminder.read === true,
        createdAt: normalizeBackupTimestamp(reminder.createdAt),
      })),
    };

    const validation = validateBackup(backup);

    if (!validation.success) {
      console.error("Backup validation failed:", validation.error);
      throw new Error("Generated backup failed schema validation.");
    }

    const jsonContent = JSON.stringify(backup, null, 2);
    const filename = `docuguard_backup_${new Date().toISOString().split("T")[0]}.json`;
    const fileUri = `${(FileSystem as any).documentDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(fileUri, jsonContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        dialogTitle: "Export DocuGuard Backup",
      });
    } else {
      Alert.alert("Backup Created", `Backup saved to: ${fileUri}`);
    }
  } catch (err) {
    console.error("Backup export failed:", err);
    Alert.alert(
      "Export Failed",
      "Could not create backup. Please try again.",
    );
  }
}


export async function exportDocumentArchive(): Promise<void> {
  try {
    const documents = await getAllDocuments();

    const archive = {
      documents: documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        issuer: doc.issuer,
        documentNumber: doc.documentNumber,
        issueDate: doc.issueDate,
        expiryDate: doc.expiryDate,
        status: doc.status,
        notes: doc.notes,
        fileType: doc.fileType,
        s3Key: doc.s3Key,
      })),
      exportedAt: new Date().toISOString(),
    };

    const jsonContent = JSON.stringify(archive, null, 2);
    const filename = `docuguard_archive_${new Date().toISOString().split("T")[0]}.json`;
    const fileUri = `${(FileSystem as any).documentDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(fileUri, jsonContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        dialogTitle: "Export Document Archive",
      });
    } else {
      Alert.alert("Archive Created", `Archive saved to: ${fileUri}`);
    }
  } catch (err: any) {
    console.error("Archive export failed:", err);
    Alert.alert("Export Failed", "Could not create archive.");
  }
}
