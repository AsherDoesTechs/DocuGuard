import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";

import { useTheme } from "@/context/ThemeContext";
import { pullDocumentsFromCloud } from "@/services/syncService";
import { useFeedbackService } from "@/services/feedbackService";

type ImportResult = {
  type: "success" | "error" | "info";
  title: string;
  message: string;
};

export default function ImportScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  useFeedbackService();

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = useCallback(async () => {
    if (importing) return;

    setImporting(true);
    setResult(null);

    try {
      const token = await SecureStore.getItemAsync("userToken");

      if (!token) {
        setResult({
          type: "info",
          title: "Sign in required",
          message:
            "Please sign in to your DocuGuard account before importing cloud documents.",
        });
        return;
      }

      const processed = await pullDocumentsFromCloud();

      setResult({
        type: "success",
        title: "Cloud import completed",
        message:
          processed === 0
            ? "No cloud records were processed. Your existing local documents have not been intentionally cleared."
            : `${processed} cloud record${processed === 1 ? " was" : "s were"} processed. Existing records may have been reconciled rather than newly added.`,
      });
    } catch (error) {
      console.error("Cloud document import failed:", error);

      setResult({
        type: "error",
        title: "Import unsuccessful",
        message:
          "DocuGuard couldn't retrieve cloud documents. Check your internet connection and try again. Your local documents remain available.",
      });
    } finally {
      setImporting(false);
    }
  }, [importing]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/documents" as any);
    }
  }, [router]);

  const resultColor =
    result?.type === "success"
      ? colors.success
      : result?.type === "error"
        ? colors.error
        : colors.info;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={handleBack}
          style={styles.backButton}
          activeOpacity={0.75}
        >
          <Ionicons name="arrow-back" size={23} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Import from Cloud
          </Text>
          <Text
            style={[styles.headerSubtitle, { color: colors.textSecondary }]}
          >
            Retrieve your saved documents
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.hero,
            {
              backgroundColor: colors.primaryLight,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.heroIcon, { backgroundColor: colors.surface }]}>
            <Ionicons
              name="cloud-download-outline"
              size={38}
              color={colors.primary}
            />
          </View>

          <Text style={[styles.heroTitle, { color: colors.text }]}>
            Your documents, wherever you need them
          </Text>

          <Text
            style={[styles.heroDescription, { color: colors.textSecondary }]}
          >
            Retrieve documents associated with your signed-in account and
            reconcile them with your local DocuGuard library.
          </Text>
        </View>

        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.infoRow}>
            <Ionicons
              name="person-circle-outline"
              size={23}
              color={colors.primary}
            />
            <View style={styles.infoText}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                Your account only
              </Text>
              <Text
                style={[
                  styles.infoDescription,
                  { color: colors.textSecondary },
                ]}
              >
                The authenticated API retrieves documents for your account.
              </Text>
            </View>
          </View>

          <View
            style={[styles.separator, { backgroundColor: colors.border }]}
          />

          <View style={styles.infoRow}>
            <Ionicons
              name="shield-checkmark-outline"
              size={23}
              color={colors.success}
            />
            <View style={styles.infoText}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                Local data protection
              </Text>
              <Text
                style={[
                  styles.infoDescription,
                  { color: colors.textSecondary },
                ]}
              >
                Existing reconciliation safeguards help protect pending local
                changes during cloud synchronization.
              </Text>
            </View>
          </View>

          <View
            style={[styles.separator, { backgroundColor: colors.border }]}
          />

          <View style={styles.infoRow}>
            <Ionicons name="sync-outline" size={23} color={colors.primary} />
            <View style={styles.infoText}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                Import and Sync are different
              </Text>
              <Text
                style={[
                  styles.infoDescription,
                  { color: colors.textSecondary },
                ]}
              >
                Import retrieves cloud records. The Sync screen handles pending
                local changes that need to be uploaded.
              </Text>
            </View>
          </View>
        </View>

        {result && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.resultCard,
              {
                backgroundColor: colors.surface,
                borderColor: resultColor,
              },
            ]}
          >
            <Ionicons
              name={
                result.type === "success"
                  ? "checkmark-circle"
                  : result.type === "error"
                    ? "alert-circle"
                    : "information-circle"
              }
              size={25}
              color={resultColor}
            />

            <View style={styles.resultText}>
              <Text style={[styles.resultTitle, { color: colors.text }]}>
                {result.title}
              </Text>
              <Text
                style={[styles.resultMessage, { color: colors.textSecondary }]}
              >
                {result.message}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Import documents from cloud"
          accessibilityState={{ disabled: importing, busy: importing }}
          disabled={importing}
          onPress={handleImport}
          activeOpacity={0.8}
          style={[
            styles.importButton,
            {
              backgroundColor: colors.buttonPrimary,
              opacity: importing ? 0.7 : 1,
            },
          ]}
        >
          {importing ? (
            <ActivityIndicator color={colors.buttonPrimaryText} />
          ) : (
            <Ionicons
              name="cloud-download-outline"
              size={21}
              color={colors.buttonPrimaryText}
            />
          )}

          <Text
            style={[
              styles.importButtonText,
              { color: colors.buttonPrimaryText },
            ]}
          >
            {importing ? "Importing cloud records..." : "Start Cloud Import"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          onPress={handleBack}
          disabled={importing}
          activeOpacity={0.75}
          style={[styles.cancelButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.cancelButtonText, { color: colors.text }]}>
            Return to Documents
          </Text>
        </TouchableOpacity>

        <Text style={[styles.footerNote, { color: colors.textMuted }]}>
          A successful import does not necessarily mean new documents were
          added. Cloud records may already exist in your local library.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 3,
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    gap: 18,
  },
  hero: {
    alignItems: "center",
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
  },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 28,
  },
  heroDescription: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 10,
  },
  infoCard: {
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  infoDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
  },
  resultText: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 5,
  },
  resultMessage: {
    fontSize: 13,
    lineHeight: 19,
  },
  importButton: {
    minHeight: 54,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    gap: 10,
  },
  importButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  cancelButton: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  footerNote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 6,
  },
});
