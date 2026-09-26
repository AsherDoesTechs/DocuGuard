import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, StatusBadge } from "@/components/ui";
import { COLORS } from "@/constants";
import { Toast } from "@/components/ui/Toast";
import { formatShortDate, getDaysUntilExpiry } from "@/utils";
import {
  getDocumentById,
  deleteDocument,
  updateDocument,
  getDocumentHistory,
} from "@/services/localDatabase";
import * as SecureStore from "expo-secure-store";
import { api } from "@/services/api";
import * as Clipboard from "expo-clipboard";
import Loading from "@/components/ui/Loading";

interface DocumentData {
  id: string;
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes?: string;
  status: string;
  fileUrl?: string;
  fileType?: string;
  processingStatus?: string;
  riskScore?: number;
  riskLevel?: string;
}

export default function DocumentDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const mountedRef = useRef(true);

  const fetchDocumentDetails = useCallback(async () => {
    if (!id || !mountedRef.current) return;
    try {
      const docId = parseInt(id as string, 10);
      if (isNaN(docId)) throw new Error("Invalid document ID");
      const doc = await getDocumentById(docId);
      if (!doc) throw new Error("Document not found");
      if (mountedRef.current) {
        setDocument({
          id: String(doc.id),
          title: doc.title,
          category: doc.category,
          issuer: doc.issuer,
          documentNumber: doc.documentNumber || "",
          issueDate: doc.issueDate || "",
          expiryDate: doc.expiryDate || "",
          notes: doc.notes,
          status: doc.status,
          fileUrl: doc.fileUrl,
          fileType: doc.fileType,
          processingStatus: doc.processingStatus,
          riskScore: doc.riskScore,
          riskLevel: doc.riskLevel,
        });
      }
    } catch (error: any) {
      if (mountedRef.current) {
        Alert.alert("Error", error.message || "Could not retrieve document details.");
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
    return () => { mountedRef.current = false; };
  }, [fetchDocumentDetails, fetchHistory]);

  const handleDelete = async () => {
    if (!document) return;
    Alert.alert("Delete Document", "Are you sure you want to delete this document from your vault?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
          await deleteDocument(parseInt(document.id, 10));
          router.back();
          } catch (err) {
            Alert.alert("Error", "Could not delete document.");
          }
        },
      },
    ]);
  };

  const handleDownload = async () => {
    if (!document) return;
    if (!document.fileUrl) {
      Alert.alert("Error", "No file attachment available for this document.");
      return;
    }
    setIsDownloading(true);
    try {
      const cleanTitle = document.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const filename = `${cleanTitle}_${document.id}.pdf`;
      Alert.alert("Download", `Downloading ${filename}...`);
    } catch (error: any) {
      console.error("Download error:", error);
      Alert.alert("Download Failed", "Something went wrong while retrieving your file.");
    } finally {
      if (mountedRef.current) setIsDownloading(false);
    }
  };

  const handleVerify = async () => {
    if (!document) return;
    setIsVerifying(true);
    try {
      await updateDocument(parseInt(document.id, 10), { status: "verified", needsSync: true });
      setDocument({ ...document, status: "verified" });
      const token = await SecureStore.getItemAsync("userToken");
      if (token) {
        try {
          await api.documents.verifyDocument(parseInt(document.id, 10));
        } catch (syncErr) { console.warn("Could not sync verification:", syncErr); }
      }
      Alert.alert("Verified", "Document has been marked as verified.");
    } catch (err: any) {
      Alert.alert("Verification Failed", "Could not verify document locally.");
    } finally {
      if (mountedRef.current) setIsVerifying(false);
    }
  };

   const copyToClipboard = async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopySuccess(label);
    } catch (err) { console.error("Clipboard error:", err); }
  };

  const dismissToast = () => setCopySuccess(null);

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

  if (isLoading) return <Loading />;

  if (!document) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="document-text" size={48} color={COLORS.textSecondary} />
          <Text style={styles.errorText}>Document not found</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDocumentDetails}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const daysUntilExpiry = getDaysUntilExpiry(document.expiryDate);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Document Details</Text>
          <TouchableOpacity onPress={() => copyToClipboard(document.documentNumber, "Document Number")} hitSlop={10}>
            <Ionicons name="copy" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {copySuccess && (
          <Toast
            visible
            message={`${copySuccess} copied!`}
            type="success"
            duration={2000}
            onDismiss={dismissToast}
          />
        )}

        <Card style={styles.docCard}>
          <View style={styles.docHeader}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.docTitle}>{document.title}</Text>
              <Text style={styles.docIssuer}>{document.issuer}</Text>
            </View>
            <StatusBadge status={document.status || "ACTIVE"} />
          </View>
          <View style={styles.metaGrid}>
            <Card style={styles.metaItem}>
              <TouchableOpacity onPress={() => copyToClipboard(document.documentNumber, "Document Number")} activeOpacity={0.7}>
                <Ionicons name="file-tray" size={24} color={COLORS.primary} />
                <Text style={styles.metaLabel}>Document Number</Text>
                <Text style={styles.metaValue}>{document.documentNumber}</Text>
              </TouchableOpacity>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name="calendar" size={24} color={COLORS.primary} />
              <Text style={styles.metaLabel}>Issue Date</Text>
              <Text style={styles.metaValue}>{formatShortDate(document.issueDate)}</Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name="time" size={24} color={COLORS.primary} />
              <Text style={styles.metaLabel}>Expiry Date</Text>
              <Text style={styles.metaValue}>{formatShortDate(document.expiryDate)}</Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name={daysUntilExpiry < 0 ? "alert-circle" : "checkmark-circle"} size={24} color={daysUntilExpiry < 0 ? COLORS.danger : COLORS.success} />
              <Text style={styles.metaLabel}>Days Until Expiry</Text>
              <Text style={[styles.metaValue, { color: daysUntilExpiry < 0 ? COLORS.danger : COLORS.success }]}>
                {daysUntilExpiry < 0 ? `Expired ${Math.abs(daysUntilExpiry)} days ago` : `${daysUntilExpiry} days`}
              </Text>
            </Card>
          </View>
        </Card>

        {document.notes ? (
          <Card style={styles.notesCard}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle}>Notes</Text>
              <TouchableOpacity onPress={() => copyToClipboard(document.notes!, "Notes")} hitSlop={10}>
                <Ionicons name="copy" size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.notesText}>{document.notes}</Text>
          </Card>
        ) : null}

        {document.processingStatus === "processing" && (
          <Card style={styles.processingCard}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.processingText}>Processing document with AI...</Text>
          </Card>
        )}

        {document.processingStatus === "failed" && (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
            <Text style={styles.errorText}>Processing failed. You can still view the document.</Text>
          </Card>
        )}

         {document.riskScore !== undefined && document.riskLevel && (
           <Card style={styles.riskCard}>
             <Text style={styles.riskLabel}>AI Risk Assessment</Text>
             <View style={styles.riskRow}>
               <Text style={styles.riskScore}>Score: {document.riskScore}/100</Text>
               <StatusBadge status={document.riskLevel === "Low" ? "success" : document.riskLevel === "Medium" ? "warning" : "danger"} text={document.riskLevel} />
             </View>
           </Card>
         )}

         <Card style={styles.historyCard}>
           <View style={styles.historyHeader}>
             <Text style={styles.historyTitle}>Document Activity</Text>
             <Ionicons name="time-outline" size={20} color={COLORS.textSecondary} />
           </View>
           {loadingHistory ? (
             <ActivityIndicator size="small" color={COLORS.primary} />
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
                       color={COLORS.primary}
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
          {document.status !== "verified" && (
            <TouchableOpacity style={[styles.actionButton, styles.actionVerify]} onPress={handleVerify} disabled={isVerifying}>
              {isVerifying ? <ActivityIndicator size="small" color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={[styles.actionButtonText, { color: "#fff" }]}>Verify Document</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.actionButton, styles.actionPrimary]} onPress={() => router.push(`/edit-document/${document.id}` as any)} disabled={isDownloading}>
            <Ionicons name="create" size={20} color="#fff" />
            <Text style={[styles.actionButtonText, { color: "#fff" }]}>Edit Document</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.actionSecondary]} onPress={handleDownload} disabled={isDownloading}>
            {isDownloading ? <ActivityIndicator size="small" color={COLORS.primary} /> : (
              <>
                <Ionicons name="download" size={20} color={COLORS.primary} />
                <Text style={[styles.actionButtonText, { color: COLORS.primary }]}>Download</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.actionDanger]} onPress={handleDelete} disabled={isDownloading}>
            <Ionicons name="trash" size={20} color={COLORS.danger} />
            <Text style={[styles.actionButtonText, { color: COLORS.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: COLORS.textSecondary },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  docCard: { marginBottom: 20 },
  docHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  docTitle: { fontSize: 22, fontWeight: "700", color: COLORS.text },
  docIssuer: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  metaGrid: { gap: 12 },
  metaItem: { alignItems: "center", paddingVertical: 12 },
  metaLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 8 },
  metaValue: { fontSize: 16, fontWeight: "600", color: COLORS.text, marginTop: 4 },
  notesCard: { marginBottom: 20 },
  notesHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  notesTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  notesText: { fontSize: 14, color: COLORS.text, lineHeight: 20 },
  actions: { gap: 12 },
  actionButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, gap: 8, minHeight: 48 },
  actionPrimary: { backgroundColor: COLORS.primary },
  actionSecondary: { backgroundColor: `${COLORS.primary}15` },
  actionDanger: { backgroundColor: `${COLORS.danger}15` },
  actionVerify: { backgroundColor: COLORS.success },
  actionButtonText: { fontWeight: "600", fontSize: 16 },
  processingCard: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  processingText: { fontSize: 14, color: COLORS.primary, fontWeight: "600" },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  riskCard: { marginBottom: 20 },
  riskLabel: { fontSize: 14, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 8 },
  riskRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  riskScore: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 24 },
  errorText: { fontSize: 16, color: COLORS.textSecondary, textAlign: "center" },
  retryButton: { backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  historyCard: { marginBottom: 20 },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  historyTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  historyList: { gap: 10 },
  historyItem: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  historyDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}20`,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  historyContent: { flex: 1 },
  historyAction: { fontSize: 14, fontWeight: "500", color: COLORS.text },
  historyTime: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  historyEmpty: { fontSize: 13, color: COLORS.textSecondary, fontStyle: "italic" },
});
