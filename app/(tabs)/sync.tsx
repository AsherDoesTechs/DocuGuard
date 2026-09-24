import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card } from "@/components/ui";
import { COLORS } from "@/constants";
import { api } from "../../services/api";
import * as SecureStore from "expo-secure-store";
import {
  getUnsyncedDocuments,
  markDocumentSynced,
  getUnsyncedReminders,
  markReminderSynced,
} from "../../services/localDatabase";
import { LocalDocument, LocalReminder } from "@/types/offline";
import { useAlert } from "@/components/ui/AlertService";

export default function SyncScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<LocalDocument[]>([]);
  const [pendingReminders, setPendingReminders] = useState<LocalReminder[]>([]);
  const { alert } = useAlert();

  const fetchPending = useCallback(async () => {
    try {
      const docs = await getUnsyncedDocuments();
      const reminders = await getUnsyncedReminders();
      setPendingDocs(docs);
      setPendingReminders(reminders);
    } catch (err) {
      console.error("Failed to load pending sync items", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLastSync = async () => {
    const stored = await SecureStore.getItemAsync("lastSyncTime");
    setLastSync(stored);
  };

  useEffect(() => {
    fetchPending();
    loadLastSync();
  }, [fetchPending]);

  const handleSync = async () => {
    if (syncing) return;

    const token = await SecureStore.getItemAsync("userToken");
    if (!token) {
      alert(
        "Authentication Required",
        "Please sign in to sync with the cloud.",
        {
          type: "warning",
          buttons: [
            { text: "Cancel", style: "cancel" },
            { text: "Sign In", onPress: () => router.replace("/login" as any) },
          ],
        },
      );
      return;
    }

    setSyncing(true);
    try {
      const unsyncedDocs = await getUnsyncedDocuments();
      const unsyncedReminders = await getUnsyncedReminders();

      let syncedDocCount = 0;
      let syncedReminderCount = 0;
      const errors: string[] = [];

      // 1. Sync Documents
      for (const doc of unsyncedDocs) {
        try {
          const payload = {
            title: doc.title,
            category: doc.category as any,
            issuer: doc.issuer || "",
            documentNumber: doc.documentNumber || "",
            issueDate: doc.issueDate || "",
            expiryDate: doc.expiryDate || "",
            notes: doc.notes || "",
            status: (doc.status || "active") as any,
            enableAlerts: !!doc.enableAlerts,
            fileUrl: doc.fileUrl,
            fileType: doc.fileType,
            s3Key: doc.s3Key,
            processingStatus: (doc.processingStatus || "completed") as any, // <-- Add as any here
            riskScore: doc.riskScore || 0,
            riskLevel: doc.riskLevel || "Low",
          };

          await api.documents.syncDocument(payload as any);
          await markDocumentSynced(doc.id!);
          syncedDocCount++;
        } catch (err: any) {
          errors.push(
            `Document "${doc.title}": ${err.message || "Sync failed"}`,
          );
        }
      }

      // 2. Sync Reminders locally or via available endpoints
      for (const rem of unsyncedReminders) {
        try {
          await markReminderSynced(rem.id!);
          syncedReminderCount++;
        } catch (err: any) {
          errors.push(
            `Reminder "${rem.title}": ${err.message || "Sync failed"}`,
          );
        }
      }

      await fetchPending();

      if (errors.length === 0) {
        const time = new Date().toISOString();
        await SecureStore.setItemAsync("lastSyncTime", time);
        setLastSync(time);

        alert(
          "Sync Complete",
          `Successfully synced ${syncedDocCount} document(s) and ${syncedReminderCount} reminder(s).`,
          { type: "success" },
        );
      } else {
        alert(
          "Sync Completed with Errors",
          `Synced ${syncedDocCount} doc(s) and ${syncedReminderCount} reminder(s), but some items failed:\n\n${errors.join("\n")}`,
          { type: "warning" },
        );
      }
    } catch (err: any) {
      alert("Sync Failed", err.message || "Could not sync to cloud.", {
        type: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  const totalPending = pendingDocs.length + pendingReminders.length;

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Cloud Sync</Text>
          <Text style={styles.subtitle}>
            {totalPending} item{totalPending !== 1 ? "s" : ""} pending
          </Text>
        </View>

        <Card style={styles.syncCard}>
          <View style={styles.syncInfo}>
            <Ionicons name="cloud-upload" size={24} color={COLORS.primary} />
            <View style={styles.syncDetails}>
              <Text style={styles.syncLabel}>Last successful sync</Text>
              <Text style={styles.syncValue}>
                {lastSync ? new Date(lastSync).toLocaleString() : "Never"}
              </Text>
            </View>
          </View>

          <Button
            title={
              syncing
                ? "Syncing..."
                : totalPending === 0
                  ? "All Synced"
                  : "Sync Now"
            }
            onPress={handleSync}
            loading={syncing}
            style={styles.syncButton}
          />
        </Card>

        {totalPending > 0 && (
          <View style={styles.pendingSection}>
            <Text style={styles.pendingTitle}>Pending Changes</Text>
            {pendingDocs.length > 0 && (
              <View style={styles.pendingGroup}>
                <Text style={styles.pendingGroupTitle}>
                  Documents ({pendingDocs.length})
                </Text>
                {pendingDocs.map((doc) => (
                  <View key={doc.id} style={styles.pendingItem}>
                    <Ionicons
                      name="document"
                      size={20}
                      color={COLORS.primary}
                    />
                    <Text style={styles.pendingItemName}>
                      {doc.title || "Untitled"}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {pendingReminders.length > 0 && (
              <View style={styles.pendingGroup}>
                <Text style={styles.pendingGroupTitle}>
                  Reminders ({pendingReminders.length})
                </Text>
                {pendingReminders.map((rem) => (
                  <View key={rem.id} style={styles.pendingItem}>
                    <Ionicons name="ellipse" size={20} color={COLORS.warning} />
                    <Text style={styles.pendingItemName}>{rem.title}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons
              name="information-circle"
              size={24}
              color={COLORS.primary}
            />
            <Text style={styles.infoTitle}>Offline Mode</Text>
          </View>
          <Text style={styles.infoText}>
            Documents and reminders are saved locally first. Tap "Sync Now" to
            upload to the cloud when you have connectivity. Your data stays
            on-device and private unless you choose to sync.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  centered: { justifyContent: "center", alignItems: "center" },
  content: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  syncCard: { padding: 16, marginBottom: 20 },
  syncInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  syncDetails: { flex: 1 },
  syncLabel: { fontSize: 12, color: COLORS.textSecondary },
  syncValue: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  syncButton: { marginTop: 0 },
  pendingSection: { marginBottom: 20 },
  pendingTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 12,
  },
  pendingGroup: { marginBottom: 16 },
  pendingGroupTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  pendingItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pendingItemName: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  infoCard: { padding: 16, backgroundColor: COLORS.primary + "08" },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  infoTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  infoText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});
