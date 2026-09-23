import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
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
} from "../../services/localDatabase";
import { LocalDocument, LocalReminder } from "@/types/offline";
import { useAlert } from "@/components/ui/AlertService";

export default function SyncScreen() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<LocalDocument[]>([]);
  const [pendingReminders, setPendingReminders] = useState<LocalReminder[]>([]);
  const { alert } = useAlert();

  const fetchPending = async () => {
    const docs = await getUnsyncedDocuments();
    const reminders = await getUnsyncedReminders();
    setPendingDocs(docs);
    setPendingReminders(reminders);
  };

  const loadLastSync = async () => {
    const stored = await SecureStore.getItemAsync("lastSyncTime");
    setLastSync(stored);
  };

  useEffect(() => {
    fetchPending();
    loadLastSync();
  }, []);

  const handleSync = async () => {
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
        }
      );
      return;
    }

    setSyncing(true);
    try {
      const unsyncedDocs = await getUnsyncedDocuments();
      const unsyncedReminders = await getUnsyncedReminders();
      let syncedCount = 0;
      const errors: string[] = [];

      for (const doc of unsyncedDocs) {
        try {
          const payload: any = {
            title: doc.title,
            category: doc.category,
            issuer: doc.issuer,
            documentNumber: doc.documentNumber,
            issueDate: doc.issueDate,
            expiryDate: doc.expiryDate,
            notes: doc.notes,
            status: doc.status,
            enableAlerts: doc.enableAlerts,
            fileUrl: doc.fileUrl,
            fileType: doc.fileType,
            s3Key: doc.s3Key,
            processingStatus: doc.processingStatus,
            riskScore: doc.riskScore,
            riskLevel: doc.riskLevel,
          };

          await api.documents.syncDocument(payload);

          await markDocumentSynced(doc.id!);
          syncedCount++;
        } catch (err: any) {
          errors.push(
            `Document "${doc.title}": ${err.message || "Sync failed"}`,
          );
        }
      }

      const time = new Date().toISOString();
      await SecureStore.setItemAsync("lastSyncTime", time);
      setLastSync(time);
      await fetchPending();

      if (errors.length > 0) {
        alert(
          "Sync Complete",
          `Synced ${syncedCount} of ${unsyncedDocs.length + unsyncedReminders.length} items. Some errors occurred:\n\n${errors.join("\n")}`,
          { type: "warning" }
        );
      } else {
        alert(
          "Sync Complete",
          `Successfully synced ${syncedCount} document(s) and ${unsyncedReminders.length} reminder(s).`,
          { type: "success" }
        );
      }
    } catch (err: any) {
      alert("Sync Failed", err.message || "Could not sync to cloud.", { type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  const totalPending = pendingDocs.length + pendingReminders.length;

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
            <Ionicons
              name="cloud-upload"
              size={24}
              color={COLORS.primary}
            />
            <View style={styles.syncDetails}>
              <Text style={styles.syncLabel}>Last sync</Text>
              <Text style={styles.syncValue}>
                {lastSync
                  ? new Date(lastSync).toLocaleString()
                  : "Never"}
              </Text>
            </View>
          </View>

          <Button
            title={syncing ? "Syncing..." : "Sync Now"}
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
                    <Ionicons
                      name="ellipse"
                      size={20}
                      color={COLORS.warning}
                    />
                    <Text style={styles.pendingItemName}>
                      {rem.title}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="information-circle" size={24} color={COLORS.primary} />
            <Text style={styles.infoTitle}>Offline Mode</Text>
          </View>
          <Text style={styles.infoText}>
            Documents are saved locally first. Tap "Sync Now" to upload to
            the cloud when you have connectivity. Your data stays on-device
            and private unless you choose to sync.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
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