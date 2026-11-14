import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  DeviceEventEmitter,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, StatusBadge, DocumentTags } from "@/components/ui";
import { useColors } from "@/context/ThemeContext";
import {
  formatShortDate,
  getDaysUntilExpiry,
  classifyExpiration,
  getSyncStatusDisplay,
} from "@/utils";
import {
  getDocumentById,
  hardDeleteDocument,
  updateDocument,
  getDocumentHistory,
  logDocumentAction,
  LocalDocument,
} from "@/services/localDatabase";
import { recordAuditLog } from "@/services/auditService";
import { cancelDocumentNotifications } from "@/services/notificationScheduler";
import * as SecureStore from "expo-secure-store";
import { api } from "@/services/api";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import {
  feedbackService,
  useFeedbackService,
} from "@/services/feedbackService";

export default function DocumentDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [document, setDocument] = useState<LocalDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const mountedRef = useRef(true);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Initialize feedback service
  useFeedbackService();

  const fetchDocumentDetails = useCallback(async () => {
    if (!id || !mountedRef.current) return;
    try {
      const docId = parseInt(id as string, 10);
      if (isNaN(docId)) throw new Error("Invalid document ID");
      const doc = await getDocumentById(docId);
      if (!doc) throw new Error("Document not found");
      if (mountedRef.current) {
        setDocument(doc);
      }

      // Record ACCESS audit log
      await recordAuditLog(doc.documentNumber || String(doc.id), "ACCESS", {
        message: `Viewed "${doc.title || "document"}" details`,
      });
    } catch (error: any) {
      if (mountedRef.current) {
        feedbackService.error(
          error.message || "Could not retrieve document details.",
        );
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [id]);

  const fetchHistory = useCallback(async () => {
    if (!id) return;
    setLoadingHistory(true);
    try {
      const docId = parseInt(id as string, 10);
      const hist = await getDocumentHistory(docId);
      if (mountedRef.current) {
        setHistory(hist || []);
      }
    } catch (err) {
      console.warn("Failed to load history:", err);
    } finally {
      if (mountedRef.current) setLoadingHistory(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDocumentDetails();
    fetchHistory();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchDocumentDetails, fetchHistory]);

  const handleDelete = async () => {
    if (!document?.id || isDeleting) return;

    await feedbackService.confirm({
      title: "Move to Trash",
      message: "Move this document to Trash? You can restore it later from Trash.",
      confirmText: "Move to Trash",
      cancelText: "Cancel",
      destructive: true,
      onConfirm: async () => {
        const localId = document.id as number;
        setIsDeleting(true);
        try {
          await recordAuditLog(document.documentNumber || String(document.id), "DELETE", {
            message: `Moved "${document.title || "document"}" to Trash`,
          });
          await cancelDocumentNotifications(localId);
          const { moveDocumentToTrash } = await import("@/services/localDatabase");
          await moveDocumentToTrash(localId);
          if (document.cloudId) {
            try { await api.documents.delete(document.cloudId); } catch {}
          }
          DeviceEventEmitter.emit("documentVaultChanged");
          feedbackService.success("Document moved to Trash.");
          router.back();
        } catch (err: any) {
          console.error("Failed to move document to trash:", err);
          feedbackService.error("Could not move document to Trash. Please try again.");
        } finally {
          if (mountedRef.current) setIsDeleting(false);
        }
      },
      onCancel: () => {},
    });
  };

  const handleDownload = async () => {
    if (!document) return;
    setIsDownloading(true);
    try {
      const localUri =
        document.fileUrl &&
        (document.fileUrl.startsWith("file://") ||
          document.fileUrl.startsWith("content://"))
          ? document.fileUrl
          : null;

      let remoteUrl: string | null =
        document.fileUrl && /^https?:\/\//i.test(document.fileUrl)
          ? document.fileUrl
          : null;

      if (!localUri) {
        const docRef = document.cloudId ?? document.id;
        if (docRef != null) {
          try {
            const res = await api.client.get(`/documents/${docRef}/file-url`);
            if (typeof res.data?.fileUrl === "string" && res.data.fileUrl) {
              remoteUrl = res.data.fileUrl;
            }
          } catch {
            // fall back to any existing remote URL
          }
        }
      }

      if (!localUri && !remoteUrl) {
        feedbackService.error("No file available to download for this document.");
        return;
      }

      const mime = (document.fileType || "").toLowerCase();
      const ext = mime.includes("png")
        ? "png"
        : mime.includes("jpeg") || mime.includes("jpg") || mime.includes("image")
          ? "jpg"
          : "pdf";
      const cleanTitle = (document.title || "document")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase() || "document";
      const idPart = document.id ?? document.cloudId ?? "file";
      const filename = `${cleanTitle}_${idPart}.${ext}`;
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) throw new Error("Storage is not available on this device.");
      const tempUri = `${baseDir}${filename}`;

      let sourceUri = tempUri;

      if (localUri) {
        const info = await FileSystem.getInfoAsync(localUri);
        if (!info.exists) {
          throw new Error("The original file is not available on this device.");
        }
        if (localUri !== tempUri) {
          await FileSystem.copyAsync({ from: localUri, to: tempUri });
        }
        sourceUri = tempUri;
      } else if (remoteUrl) {
        const result = await FileSystem.downloadAsync(remoteUrl, tempUri);
        if (result.status < 200 || result.status >= 300) {
          throw new Error("Failed to download the file. Please try again.");
        }
        sourceUri = result.uri;
      }

      const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
      if (!sourceInfo.exists) {
        throw new Error("Downloaded file could not be prepared.");
      }

      const mimeType =
        document.fileType ||
        (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");

      if (Platform.OS === "android") {
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) {
          feedbackService.error("Storage permission was not granted.");
          return;
        }

        const base64 = await FileSystem.readAsStringAsync(sourceUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permissions.directoryUri,
          filename,
          mimeType,
        );
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        feedbackService.success(
          "File saved to the selected folder. You can find it in your file manager.",
        );
      } else {
        const savedUri = `${FileSystem.documentDirectory}${filename}`;
        if (sourceUri !== savedUri) {
          await FileSystem.copyAsync({ from: sourceUri, to: savedUri });
        }
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(savedUri, {
            mimeType,
            dialogTitle: "Save to Files",
            UTI:
              ext === "pdf"
                ? "com.adobe.pdf"
                : ext === "png"
                  ? "public.png"
                  : "public.jpeg",
          });
        }
        feedbackService.success(
          "File saved. Use 'Save to Files' to store it in your device storage.",
        );
      }
    } catch (error: any) {
      console.error("Download error:", error);
      feedbackService.error(
        error?.response?.data?.error ||
          error?.message ||
          "Could not download the document file.",
      );
    } finally {
      if (mountedRef.current) setIsDownloading(false);
    }
  };

  const handleVerify = async () => {
    if (!document?.id) return;
    const localId = document.id;
    setIsVerifying(true);
    try {
      await updateDocument(localId, {
        status: "verified",
        needsSync: true,
      });
      setDocument((prev) =>
        prev ? { ...prev, status: "verified", needsSync: true } : null,
      );

      const token = await SecureStore.getItemAsync("userToken");
      if (token && document.cloudId) {
        try {
          await api.documents.verifyDocument(document.cloudId);
          await logDocumentAction(localId, "verified", { status: "verified" });
        } catch (syncErr) {
          console.warn("Could not sync verification:", syncErr);
        }
      }

      // 🔔 Emit event to update dashboard stats/counters in real time
      DeviceEventEmitter.emit("documentVaultChanged");

      feedbackService.success("Document has been marked as verified.");
    } catch (err: any) {
      feedbackService.error("Could not verify document locally.");
    } finally {
      if (mountedRef.current) setIsVerifying(false);
    }
  };

  const handleExport = async () => {
    if (!document) return;
    try {
      const content = [
        `${document.title}`,
        `Issuing Agency: ${document.issuer || "N/A"}`,
        `Document Number: ${document.documentNumber || "N/A"}`,
        `Issue Date: ${formatShortDate(document.issueDate || "")}`,
        `Expiry Date: ${formatShortDate(document.expiryDate || "")}`,
        `Status: ${document.status}`,
        document.notes ? `\nNotes: ${document.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const fileName = `${document.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${document.id}.txt`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, content);
      await Sharing.shareAsync(fileUri, {
        mimeType: "text/plain",
        dialogTitle: "Export Document Details",
      });
    } catch (err: any) {
      feedbackService.error(err.message || "Could not export document.");
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      feedbackService.success(`${label} copied!`);
    } catch (err) {
      console.error("Clipboard error:", err);
    }
  };

  function getHistoryIcon(action: string): keyof typeof Ionicons.glyphMap {
    switch (action) {
      case "created":
        return "add-circle";
      case "updated":
        return "create";
      case "deleted":
        return "trash";
      case "synced":
        return "cloud-upload";
      case "verified":
        return "checkmark-circle";
      case "reminder_sent":
        return "time";
      default:
        return "document-text";
    }
  }

  function formatHistoryAction(action: string): string {
    const map: Record<string, string> = {
      created: "Document Created",
      updated: "Document Updated",
      deleted: "Document Deleted",
      synced: "Document Synced",
      verified: "Document Verified",
      reminder_sent: "Reminder Sent",
      processed: "OCR Processing Completed",
    };
    return map[action] || action.replace(/_/g, " ");
  }

  if (!isLoading && !document) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons
            name="document-text"
            size={48}
            color={colors.textSecondary}
          />
          <Text style={styles.errorText}>Document not found</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={fetchDocumentDetails}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const daysUntilExpiry = document?.expiryDate
    ? getDaysUntilExpiry(document.expiryDate)
    : null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Document Details</Text>
          <TouchableOpacity
            onPress={() =>
              document?.documentNumber &&
              copyToClipboard(document.documentNumber, "Document Number")
            }
            hitSlop={10}
            disabled={!document?.documentNumber}
          >
            <Ionicons
              name="copy"
              size={24}
              color={document?.documentNumber ? colors.primary : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <Card style={styles.docCard}>
          <View style={styles.docHeader}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.docTitle}>{document?.title || " "}</Text>
              <Text style={styles.docIssuer}>{document?.issuer || " "}</Text>
            </View>
            {document ? <StatusBadge status={document.status || "ACTIVE"} /> : null}
          </View>
          <View style={styles.metaGrid}>
            <Card style={styles.metaItem}>
              <TouchableOpacity
                onPress={() =>
                  document?.documentNumber &&
                  copyToClipboard(document.documentNumber, "Document Number")
                }
                activeOpacity={0.7}
                disabled={!document?.documentNumber}
                style={{ alignItems: "center" }}
              >
                <Ionicons name="file-tray" size={24} color={colors.primary} />
                <Text style={styles.metaLabel}>Document Number</Text>
                <Text style={styles.metaValue}>
                  {document?.documentNumber || "—"}
                </Text>
              </TouchableOpacity>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name="calendar" size={24} color={colors.primary} />
              <Text style={styles.metaLabel}>Issue Date</Text>
              <Text style={styles.metaValue}>
                {document?.issueDate ? formatShortDate(document.issueDate) : "—"}
              </Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name="time" size={24} color={colors.primary} />
              <Text style={styles.metaLabel}>Expiry Date</Text>
              <Text style={styles.metaValue}>
                {document?.expiryDate
                  ? formatShortDate(document.expiryDate)
                  : "—"}
              </Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons
                name={
                  daysUntilExpiry != null && daysUntilExpiry < 0
                    ? "alert-circle"
                    : "checkmark-circle"
                }
                size={24}
                color={
                  daysUntilExpiry != null && daysUntilExpiry < 0
                    ? colors.error
                    : colors.success
                }
              />
              <Text style={styles.metaLabel}>Days Until Expiry</Text>
              <Text
                style={[
                  styles.metaValue,
                  {
                    color:
                      daysUntilExpiry != null && daysUntilExpiry < 0
                        ? colors.error
                        : colors.success,
                  },
                ]}
              >
                {daysUntilExpiry == null
                  ? "—"
                  : daysUntilExpiry < 0
                    ? `Expired ${Math.abs(daysUntilExpiry)} days ago`
                    : `${daysUntilExpiry} days`}
              </Text>
            </Card>
          </View>

          <View style={styles.syncStatusRow}>
            <View style={styles.syncStatusItem}>
              <Ionicons
                name={
                  document?.needsSync
                    ? "cloud-upload-outline"
                    : document?.syncStatus === "failed"
                      ? "alert-circle-outline"
                      : "cloud-done-outline"
                }
                size={16}
                color={
                  document?.needsSync
                    ? colors.warning
                    : document?.syncStatus === "failed"
                      ? colors.error
                      : colors.success
                }
              />
              <Text style={styles.syncStatusText}>
                {document
                  ? getSyncStatusDisplay(
                      document.syncStatus || "local",
                      document.needsSync,
                    )
                  : " "}
              </Text>
            </View>
          </View>
        </Card>

        {Array.isArray((document as any)?.tags) && (document as any).tags.length > 0 ? (
          <Card style={styles.notesCard}>
            <Text style={styles.notesTitle}>Tags</Text>
            <DocumentTags tags={(document as any).tags} />
          </Card>
        ) : null}

        {document?.notes ? (
          <Card style={styles.notesCard}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle}>Notes</Text>
              <TouchableOpacity
                onPress={() => document?.notes && copyToClipboard(document.notes, "Notes")}
                hitSlop={10}
              >
                <Ionicons name="copy" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.notesText}>{document.notes}</Text>
          </Card>
        ) : null}

        {document?.processingStatus === "processing" && (
          <Card style={styles.processingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.processingText}>
              Processing document with AI...
            </Text>
          </Card>
        )}

        {document?.processingStatus === "manual_review" && (
          <Card style={styles.processingCard}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.warning}
            />
            <Text style={styles.processingText}>
              Manual review needed. AI could not confidently verify the
              extracted details. Please review the original document and enter
              its information manually.
            </Text>
          </Card>
        )}
        {document?.processingStatus === "failed" && (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={styles.errorText}>
              Processing failed. You can still view the document.
            </Text>
          </Card>
        )}

        {document?.riskLevel != null && document?.riskScore != null && (
          <Card style={styles.riskCard}>
            <Text style={styles.riskLabel}>AI Risk Assessment</Text>
            <View style={styles.riskRow}>
              <Text style={styles.riskScore}>
                Score: {document.riskScore}/100
              </Text>
              <StatusBadge
                status={
                  document.riskLevel === "Low"
                    ? "success"
                    : document.riskLevel === "Medium"
                      ? "warning"
                      : "danger"
                }
                text={document.riskLevel}
              />
            </View>
          </Card>
        )}

        <Card style={styles.historyCard}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Document Activity</Text>
            <Ionicons
              name="time-outline"
              size={20}
              color={colors.textSecondary}
            />
          </View>
          {loadingHistory ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : history.length === 0 ? (
            <Text style={styles.historyEmpty}>No activity recorded yet</Text>
          ) : (
            <View style={styles.historyList}>
              {history.map((item) => (
                <View key={item.id} style={styles.historyItem}>
                  <View style={styles.historyDot}>
                    <Ionicons
                      name={getHistoryIcon(item.action)}
                      size={14}
                      color={colors.primary}
                    />
                  </View>
                  <View style={styles.historyContent}>
                    <Text style={styles.historyAction}>
                      {formatHistoryAction(item.action)}
                    </Text>
                    <Text style={styles.historyTime}>
                      {formatShortDate(item.createdAt || item.created_at)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        <View style={styles.actions}>
          {document?.status !== "verified" && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionVerify]}
              onPress={handleVerify}
              disabled={!document || isVerifying || isDeleting}
            >
              {isVerifying ? (
                <ActivityIndicator size="small" color={colors.buttonPrimaryText} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={colors.buttonPrimaryText} />
                  <Text style={[styles.actionButtonText, { color: colors.buttonPrimaryText }]}>
                    Verify Document
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionButton, styles.actionPrimary]}
            onPress={() =>
              document?.id && router.push(`/edit-document/${document.id}` as any)
            }
            disabled={!document?.id || isDownloading || isVerifying || isDeleting}
          >
            <Ionicons name="create" size={20} color={colors.buttonPrimaryText} />
            <Text style={[styles.actionButtonText, { color: colors.buttonPrimaryText }]}>
              Edit Document
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionSecondary]}
            onPress={() =>
              document?.id &&
              router.push({ pathname: "/document-viewer" as any, params: { id: String(document.id) } } as any)
            }
            disabled={!document || isDownloading || isVerifying || isDeleting}
          >
            <Ionicons name="eye-outline" size={20} color={colors.primary} />
            <Text style={[styles.actionButtonText, { color: colors.primary }]}>
              View File
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionSecondary]}
            onPress={handleDownload}
            disabled={!document || isDownloading || isVerifying || isDeleting}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Ionicons name="download" size={20} color={colors.primary} />
                <Text
                  style={[styles.actionButtonText, { color: colors.primary }]}
                >
                  Download
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionSecondary]}
            onPress={handleExport}
            disabled={!document || isDownloading || isVerifying || isDeleting}
          >
            <Ionicons
              name="document-text-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={[styles.actionButtonText, { color: colors.primary }]}>
              Export
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionDanger]}
            onPress={handleDelete}
            disabled={!document?.id || isDownloading || isVerifying || isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <>
                <Ionicons name="trash" size={20} color={colors.error} />
                <Text
                  style={[styles.actionButtonText, { color: colors.error }]}
                >
                  Delete
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, color: colors.textSecondary },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  docCard: { marginBottom: 20 },
  docHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  docTitle: { fontSize: 22, fontWeight: "700", color: colors.text },
  docIssuer: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  metaGrid: { gap: 12 },
  metaItem: { alignItems: "center", paddingVertical: 12 },
  metaLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 8 },
  metaValue: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginTop: 4,
  },
  syncStatusRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 12,
  },
  syncStatusItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  syncStatusText: { fontSize: 12, color: colors.textSecondary },
  notesCard: { marginBottom: 20 },
  notesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  notesTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  notesText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  actions: { gap: 12 },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    minHeight: 48,
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionSecondary: { backgroundColor: colors.primaryLight },
  actionDanger: { backgroundColor: colors.errorLight },
  actionVerify: { backgroundColor: colors.success },
  actionButtonText: { fontWeight: "600", fontSize: 16 },
  processingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  processingText: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  riskCard: { marginBottom: 20 },
  riskLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
  },
  riskRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  riskScore: { fontSize: 16, fontWeight: "700", color: colors.text },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: 24,
  },
  errorText: { fontSize: 16, color: colors.textSecondary, textAlign: "center" },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: { color: colors.buttonPrimaryText, fontWeight: "600", fontSize: 16 },
  historyCard: { marginBottom: 20 },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  historyTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  historyList: { gap: 10 },
  historyItem: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  historyDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  historyContent: { flex: 1 },
  historyAction: { fontSize: 14, fontWeight: "500", color: colors.text },
  historyTime: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  historyEmpty: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: "italic",
  },
});
