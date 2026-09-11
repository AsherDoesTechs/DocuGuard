import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";
import {
  getAllDocuments,
  getAllReminders,
  getUserProfile,
} from "./localDatabase";
import { LocalDocument, LocalReminder, LocalUserProfile } from "../types/offline";

interface ExportData {
  profile: LocalUserProfile | null;
  documents: LocalDocument[];
  reminders: LocalReminder[];
  exportedAt: string;
}

export async function exportLocalBackup(): Promise<void> {
  try {
    const [documents, reminders, profile] = await Promise.all([
      getAllDocuments(),
      getAllReminders(),
      getUserProfile(),
    ]);

    const exportData: ExportData = {
      profile,
      documents,
      reminders,
      exportedAt: new Date().toISOString(),
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    const filename = `docuguard_backup_${new Date().toISOString().split("T")[0]}.json`;

    const file = new FileSystem.File(FileSystem.Paths.document, filename);
    file.write(jsonContent);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Export DocuGuard Backup",
      });
    } else {
      Alert.alert("Backup Created", `Backup saved to: ${file.uri}`);
    }
  } catch (err: any) {
    console.error("Backup export failed:", err);
    Alert.alert("Export Failed", err.message || "Could not create backup.");
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

    const file = new FileSystem.File(FileSystem.Paths.document, filename);
    file.write(jsonContent);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Export Document Archive",
      });
    }
  } catch (err: any) {
    console.error("Archive export failed:", err);
    Alert.alert("Export Failed", err.message || "Could not create archive.");
  }
}
