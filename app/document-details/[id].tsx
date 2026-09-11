import React, { useState, useEffect } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Paths, File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as SecureStore from "expo-secure-store";

import { API_BASE_URL, api } from "../../services/api";
import { Card, StatusBadge, DocumentPreview } from "../../components/ui";
import { COLORS } from "@/constants";
import { formatShortDate, getDaysUntilExpiry } from "../../utils";
import {
  getDocumentById,
  deleteDocument,
  updateDocument,
} from "../../services/localDatabase";

interface DocumentData {
  id: string;
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes?: string;
  status: any;
  fileUrl?: string;
  fileType?: string;
  processingStatus?: string;
  riskScore?: number;
  riskLevel?: string;
}

export default function DocumentDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [document, setDocument] = useState<DocumentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    fetchDocumentDetails();
  }, [id]);

  const fetchDocumentDetails = async () => {
    try {
      const doc = await getDocumentById(parseInt(id, 10));
      if (!doc) {
        throw new Error("Document not found");
      }
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
    } catch (error) {
      Alert.alert("Error", "Could not retrieve document details.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      "Delete Document",
      "Are you sure you want to delete this document from your vault?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
             onPress: async () => {
              try {
                await deleteDocument(parseInt(id, 10));
                router.replace("/(tabs)/documents" as any);
              } catch (err) {
                Alert.alert("Error", "Could not delete document.");
              }
            },
        },
      ],
    );
  };

  const handleDownload = async () => {
    if (!document) return;

    // Ensure we have a valid file URL from the database/backend record
    const fileUrl = document.fileUrl;

    if (!fileUrl) {
      Alert.alert("Error", "No file attachment available for this document.");
      return;
    }

    setIsDownloading(true);
    try {
      const cleanTitle = document.title
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
      const filename = `${cleanTitle}_${document.id}.pdf`;

      const targetFile = new File(Paths.document, filename);

      if (!targetFile.parentDirectory.exists) {
        targetFile.parentDirectory.create();
      }

      const downloadRes = await fetch(fileUrl);
      const blob = await downloadRes.blob();

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        await targetFile.write(base64Data);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(targetFile.uri, {
            mimeType: "application/pdf",
            dialogTitle: `Download ${document.title}`,
            UTI: "com.adobe.pdf",
          });
        } else {
          Alert.alert("Success", "File downloaded locally to vault.");
        }
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Download error:", error);
      Alert.alert(
        "Download Failed",
        "Something went wrong while retrieving your file.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleVerify = async () => {
    if (!document) return;

    try {
      await updateDocument(parseInt(id, 10), {
        status: "verified",
        needsSync: true,
      });

      setDocument({ ...document, status: "verified" });

      const token = await SecureStore.getItemAsync("userToken");
      if (token) {
        try {
          await api.documents.verifyDocument(parseInt(id, 10));
        } catch (syncErr) {
          console.warn("Could not sync verification to cloud:", syncErr);
        }
      }

      Alert.alert("Verified", "Document has been marked as verified.");
    } catch (err) {
      Alert.alert(
        "Verification Failed",
        "Could not verify document locally.",
      );
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!document) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Document not found</Text>
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
          <View style={{ width: 28 }} />
        </View>

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
              <Ionicons name="file-tray" size={24} color={COLORS.primary} />
              <Text style={styles.metaLabel}>Document Number</Text>
              <Text style={styles.metaValue}>{document.documentNumber}</Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name="calendar" size={24} color={COLORS.primary} />
              <Text style={styles.metaLabel}>Issue Date</Text>
              <Text style={styles.metaValue}>
                {formatShortDate(document.issueDate)}
              </Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons name="time" size={24} color={COLORS.primary} />
              <Text style={styles.metaLabel}>Expiry Date</Text>
              <Text style={styles.metaValue}>
                {formatShortDate(document.expiryDate)}
              </Text>
            </Card>
            <Card style={styles.metaItem}>
              <Ionicons
                name={daysUntilExpiry < 0 ? "alert-circle" : "checkmark-circle"}
                size={24}
                color={daysUntilExpiry < 0 ? COLORS.danger : COLORS.success}
              />
              <Text style={styles.metaLabel}>Days Until Expiry</Text>
              <Text
                style={[
                  styles.metaValue,
                  {
                    color: daysUntilExpiry < 0 ? COLORS.danger : COLORS.success,
                  },
                ]}
              >
                {daysUntilExpiry < 0
                  ? `Expired ${Math.abs(daysUntilExpiry)} days ago`
                  : `${daysUntilExpiry} days`}
              </Text>
            </Card>
          </View>
        </Card>

        {document.notes ? (
          <Card style={styles.notesCard}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{document.notes}</Text>
          </Card>
        ) : null}

        <DocumentPreview
          fileUrl={document.fileUrl}
          fileType={document.fileType}
          onPress={() => handleDownload()}
        />

        {document.processingStatus === "processing" && (
          <Card style={styles.processingCard}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.processingText}>
              Processing document with AI...
            </Text>
          </Card>
        )}

        {document.processingStatus === "failed" && (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
            <Text style={styles.errorText}>
              Processing failed. You can still view the document.
            </Text>
          </Card>
        )}

        {document.riskScore !== undefined && document.riskLevel && (
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

        <View style={styles.actions}>
          {document.status !== "verified" && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionVerify]}
              onPress={handleVerify}
              disabled={isDownloading}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={[styles.actionButtonText, { color: "#fff" }]}>
                Verify Document
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionButton, styles.actionPrimary]}
            onPress={() => router.push(`/edit-document/${document.id}` as any)}
            disabled={isDownloading}
          >
            <Ionicons name="create" size={20} color="#fff" />
            <Text style={[styles.actionButtonText, { color: "#fff" }]}>
              Edit Document
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.actionSecondary]}
            onPress={handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <Ionicons name="download" size={20} color={COLORS.primary} />
                <Text
                  style={[styles.actionButtonText, { color: COLORS.primary }]}
                >
                  Download
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.actionDanger]}
            disabled={isDownloading}
            onPress={handleDelete}
          >
            <Ionicons name="trash" size={20} color={COLORS.danger} />
            <Text style={[styles.actionButtonText, { color: COLORS.danger }]}>
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  docCard: {
    marginBottom: 20,
  },
  docHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  docTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
  },
  docIssuer: {
    fontSize: 14,
    color: COLORS.textSecondary || "#777",
    marginTop: 4,
  },
  metaGrid: {
    gap: 12,
  },
  metaItem: {
    alignItems: "center",
    paddingVertical: 12,
  },
  metaLabel: {
    fontSize: 12,
    color: COLORS.textSecondary || "#777",
    marginTop: 8,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginTop: 4,
  },
  notesCard: {
    marginBottom: 20,
  },
  notesTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  notesText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  actions: {
    gap: 12,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    minHeight: 48,
  },
  actionPrimary: {
    backgroundColor: COLORS.primary,
  },
  actionSecondary: {
    backgroundColor: `${COLORS.primary}15`,
  },
  actionDanger: {
    backgroundColor: `${COLORS.danger}15`,
  },
  actionVerify: {
    backgroundColor: COLORS.success,
  },
  actionButtonText: {
    fontWeight: "600",
    fontSize: 16,
  },
  processingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  processingText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "600",
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  riskCard: {
    marginBottom: 20,
  },
  riskLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  riskRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  riskScore: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 16,
  },
});
