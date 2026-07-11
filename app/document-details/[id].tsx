import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context"; // Added import
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Paths, File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Card, StatusBadge } from "../../components/ui";
import { MOCK_DOCUMENTS, COLORS } from "@/constants";
import { formatShortDate, getDaysUntilExpiry } from "../../utils";

export default function DocumentDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const document = MOCK_DOCUMENTS.find((d) => d.id === id);

  const [isDownloading, setIsDownloading] = useState(false);

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

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const fileUrl =
        "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

      const cleanTitle = document.title
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
      const filename = `${cleanTitle}_${document.id}.pdf`;

      const targetFile = new File(Paths.document, filename);

      await File.downloadFileAsync(fileUrl, targetFile);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(targetFile.uri, {
          mimeType: "application/pdf",
          dialogTitle: `Download ${document.title}`,
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Success", `File downloaded locally to documents layout.`);
      }
    } catch (error) {
      console.error("Download Error: ", error);
      Alert.alert(
        "Download Failed",
        "Something went wrong while retrieving your file.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Document Details</Text>
          <View style={{ width: 28 }} />
        </View>

        <Card style={styles.docCard}>
          <View style={styles.docHeader}>
            <View>
              <Text style={styles.docTitle}>{document.title}</Text>
              <Text style={styles.docIssuer}>{document.issuer}</Text>
            </View>
            <StatusBadge status={document.status} />
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

        {document.notes && (
          <Card style={styles.notesCard}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{document.notes}</Text>
          </Card>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionPrimary]}
            onPress={() => router.push(`/edit-document/${document.id}` as any)}
            disabled={isDownloading}
          >
            <Ionicons name="create" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Edit Document</Text>
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
            onPress={() => {
              Alert.alert(
                "Delete Document",
                "Are you sure you want to delete this document?",
                [
                  { text: "Cancel" },
                  {
                    text: "Delete",
                    onPress: () => router.back(),
                    style: "destructive",
                  },
                ],
              );
            }}
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
  // ... rest of your styles remain the same
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
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
  },
  docIssuer: {
    fontSize: 14,
    color: COLORS.textSecondary,
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
    color: COLORS.textSecondary,
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
  actionButtonText: {
    fontWeight: "600",
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    color: COLORS.text,
  },
});
