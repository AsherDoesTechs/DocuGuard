import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card } from "@/components/ui";
import { useTheme } from "@/context/ThemeContext";
import * as SecureStore from "expo-secure-store";

import { syncToCloud } from "../../services/syncService";
import {
  getUnsyncedDocuments,
  getUnsyncedReminders,
} from "../../services/localDatabase";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";
import { LocalDocument, LocalReminder } from "@/types/offline";

type SyncPalette = ReturnType<typeof useTheme>["colors"];

type PendingItemProps = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  colors: SyncPalette;
};

function PendingItem({ title, icon, iconColor, colors }: PendingItemProps) {
  const itemStyles = createStyles(colors);

  return (
    <View
      style={[itemStyles.pendingItem, { borderBottomColor: colors.border }]}
    >
      <View
        style={[
          itemStyles.pendingIconContainer,
          { backgroundColor: `${iconColor}14` },
        ]}
      >
        <Ionicons name={icon} size={19} color={iconColor} />
      </View>

      <Text
        style={[itemStyles.pendingItemName, { color: colors.text }]}
        numberOfLines={2}
      >
        {title?.trim() || "Untitled"}
      </Text>

      <Ionicons
        name="cloud-upload-outline"
        size={17}
        color={colors.textMuted}
      />
    </View>
  );
}

export default function SyncScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  useFeedbackService();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<LocalDocument[]>([]);
  const [pendingReminders, setPendingReminders] = useState<LocalReminder[]>([]);

  const stylesForTheme = useMemo(() => createStyles(colors), [colors]);

  const totalPending = pendingDocs.length + pendingReminders.length;

  const fetchPending = useCallback(async () => {
    try {
      const [docs, reminders] = await Promise.all([
        getUnsyncedDocuments(),
        getUnsyncedReminders(),
      ]);

      setPendingDocs(docs);
      setPendingReminders(reminders);
    } catch (err) {
      console.error("Failed to load pending sync items:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLastSync = useCallback(async () => {
    try {
      const stored = await SecureStore.getItemAsync("lastSyncTime");
      setLastSync(stored);
    } catch (err) {
      console.error("Failed to load last sync time:", err);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
    void loadLastSync();
  }, [fetchPending, loadLastSync]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);

    try {
      await Promise.all([fetchPending(), loadLastSync()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchPending, loadLastSync]);

  const handleSync = useCallback(async () => {
    if (syncing || totalPending === 0) return;

    try {
      const token = await SecureStore.getItemAsync("userToken");

      if (!token) {
        await feedbackService.confirm({
          title: "Authentication Required",
          message: "Please sign in to sync your data with the cloud.",
          confirmText: "Sign In",
          cancelText: "Cancel",
          destructive: false,
          onConfirm: () => router.replace("/(auth)/login" as any),
          onCancel: () => {},
        });

        return;
      }

      setSyncing(true);

      try {
        const result = await syncToCloud();

        await fetchPending();

        if (result.success && (!result.errors || result.errors.length === 0)) {
          const time = new Date().toISOString();

          await SecureStore.setItemAsync("lastSyncTime", time);
          setLastSync(time);

          await feedbackService.success(
            `Successfully synced ${result.documentsSynced} document(s) and ${result.remindersSynced} reminder(s).`,
          );
        } else if (result.errors && result.errors.length > 0) {
          await feedbackService.alert({
            title: "Sync Completed with Errors",
            message:
              `Synced ${result.documentsSynced} document(s) and ` +
              `${result.remindersSynced} reminder(s), but some items failed:\n\n` +
              result.errors.join("\n"),
            type: "warning",
          });
        } else {
          await feedbackService.alert({
            title: "Sync Failed",
            message: result.message || "Could not sync your data to the cloud.",
            type: "error",
          });
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Could not sync your data to the cloud.";

        await feedbackService.alert({
          title: "Sync Failed",
          message,
          type: "error",
        });
      } finally {
        setSyncing(false);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";

      await feedbackService.alert({
        title: "Unable to Start Sync",
        message,
        type: "error",
      });
    }
  }, [fetchPending, router, syncing, totalPending]);

  const formattedLastSync = useMemo(() => {
    if (!lastSync) return "Never synced";

    const date = new Date(lastSync);

    if (Number.isNaN(date.getTime())) return "Date unavailable";

    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [lastSync]);

  const syncStatus = syncing
    ? {
        label: "Syncing your data",
        description: "Please keep the app open while your data syncs.",
        icon: "sync-outline" as const,
        color: colors.primary,
      }
    : totalPending === 0
      ? {
          label: "Everything is up to date",
          description: "There are no pending local changes to upload.",
          icon: "checkmark-circle-outline" as const,
          color: colors.success,
        }
      : {
          label: "Changes waiting to sync",
          description: "Your latest local changes are ready to upload.",
          icon: "cloud-upload-outline" as const,
          color: colors.warning,
        };

  if (loading) {
    return (
      <SafeAreaView style={[stylesForTheme.safeArea, stylesForTheme.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text
          style={[stylesForTheme.loadingText, { color: colors.textSecondary }]}
        >
          Loading sync information...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={stylesForTheme.safeArea}>
      <ScrollView
        contentContainerStyle={stylesForTheme.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {/* Header */}
        <View style={stylesForTheme.header}>
          <View style={stylesForTheme.headerText}>
            <Text style={stylesForTheme.eyebrow}>DATA MANAGEMENT</Text>
            <Text style={stylesForTheme.title}>Cloud Sync</Text>
            <Text style={stylesForTheme.subtitle}>
              Keep your documents and reminders up to date.
            </Text>
          </View>

          <View
            style={[
              stylesForTheme.headerIcon,
              { backgroundColor: colors.primaryLight },
            ]}
          >
            <Ionicons
              name="cloud-done-outline"
              size={28}
              color={colors.primary}
            />
          </View>
        </View>

        {/* Sync status */}
        <Card style={stylesForTheme.statusCard}>
          <View style={stylesForTheme.statusTopRow}>
            <View
              style={[
                stylesForTheme.statusIcon,
                { backgroundColor: `${syncStatus.color}16` },
              ]}
            >
              {syncing ? (
                <ActivityIndicator size="small" color={syncStatus.color} />
              ) : (
                <Ionicons
                  name={syncStatus.icon}
                  size={25}
                  color={syncStatus.color}
                />
              )}
            </View>

            <View style={stylesForTheme.statusTextContainer}>
              <Text style={stylesForTheme.statusTitle}>{syncStatus.label}</Text>
              <Text style={stylesForTheme.statusDescription}>
                {syncStatus.description}
              </Text>
            </View>
          </View>

          <View
            style={[stylesForTheme.divider, { backgroundColor: colors.border }]}
          />

          <View style={stylesForTheme.lastSyncRow}>
            <View style={stylesForTheme.lastSyncLabel}>
              <Ionicons
                name="time-outline"
                size={17}
                color={colors.textSecondary}
              />
              <Text style={stylesForTheme.lastSyncLabelText}>
                Last successful sync
              </Text>
            </View>

            <Text style={stylesForTheme.lastSyncValue}>
              {formattedLastSync}
            </Text>
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
            disabled={syncing || totalPending === 0}
            style={stylesForTheme.syncButton}
            feedbackType="success"
          />

          {totalPending === 0 && !syncing && (
            <Text style={stylesForTheme.syncedHint}>
              Pull down to refresh your local sync status.
            </Text>
          )}
        </Card>

        {/* Pending summary */}
        <View style={stylesForTheme.sectionHeader}>
          <View style={stylesForTheme.sectionHeadingText}>
            <Text style={stylesForTheme.sectionTitle}>Pending Changes</Text>
            <Text style={stylesForTheme.sectionSubtitle}>
              Items saved locally and waiting to sync
            </Text>
          </View>

          <View
            style={[
              stylesForTheme.countBadge,
              {
                backgroundColor:
                  totalPending > 0
                    ? `${colors.warning}18`
                    : `${colors.success}18`,
              },
            ]}
          >
            <Text
              style={[
                stylesForTheme.countBadgeText,
                {
                  color: totalPending > 0 ? colors.warning : colors.success,
                },
              ]}
            >
              {totalPending}
            </Text>
          </View>
        </View>

        {totalPending > 0 ? (
          <View style={stylesForTheme.pendingCard}>
            {/* Documents */}
            {pendingDocs.length > 0 && (
              <View style={stylesForTheme.pendingGroup}>
                <View style={stylesForTheme.groupHeader}>
                  <View style={stylesForTheme.groupTitleRow}>
                    <Ionicons
                      name="document-text-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <Text style={stylesForTheme.groupTitle}>Documents</Text>
                  </View>

                  <Text style={stylesForTheme.groupCount}>
                    {pendingDocs.length}
                  </Text>
                </View>

                {pendingDocs.map((doc) => (
                  <PendingItem
                    key={doc.id}
                    title={doc.title || "Untitled document"}
                    icon="document-outline"
                    iconColor={colors.primary}
                    colors={colors}
                  />
                ))}
              </View>
            )}

            {/* Reminders */}
            {pendingReminders.length > 0 && (
              <View
                style={[
                  stylesForTheme.pendingGroup,
                  pendingDocs.length > 0 && stylesForTheme.secondPendingGroup,
                ]}
              >
                <View style={stylesForTheme.groupHeader}>
                  <View style={stylesForTheme.groupTitleRow}>
                    <Ionicons
                      name="notifications-outline"
                      size={18}
                      color={colors.warning}
                    />
                    <Text style={stylesForTheme.groupTitle}>Reminders</Text>
                  </View>

                  <Text style={stylesForTheme.groupCount}>
                    {pendingReminders.length}
                  </Text>
                </View>

                {pendingReminders.map((reminder) => (
                  <PendingItem
                    key={reminder.id}
                    title={reminder.title || "Untitled reminder"}
                    icon="notifications-outline"
                    iconColor={colors.warning}
                    colors={colors}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={stylesForTheme.emptyCard}>
            <View
              style={[
                stylesForTheme.emptyIcon,
                { backgroundColor: `${colors.success}14` },
              ]}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={30}
                color={colors.success}
              />
            </View>

            <Text style={stylesForTheme.emptyTitle}>You're all caught up</Text>
            <Text style={stylesForTheme.emptyDescription}>
              There are no pending documents or reminders. Any new local changes
              will appear here when they need to sync.
            </Text>
          </View>
        )}

        {/* Offline information */}
        <View style={stylesForTheme.infoCard}>
          <View
            style={[
              stylesForTheme.infoIcon,
              { backgroundColor: colors.primaryLight },
            ]}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={22}
              color={colors.primary}
            />
          </View>

          <View style={stylesForTheme.infoContent}>
            <Text style={stylesForTheme.infoTitle}>
              Your data, your control
            </Text>
            <Text style={stylesForTheme.infoText}>
              DocuGuard saves documents and reminders locally first. Pending
              changes are uploaded when you choose to sync and your account and
              network are available.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: SyncPalette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      justifyContent: "center",
      alignItems: "center",
    },
    loadingText: {
      marginTop: 12,
      fontSize: 14,
    },
    content: {
      padding: 16,
      paddingBottom: 110,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 24,
      gap: 12,
    },
    headerText: {
      flex: 1,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.4,
      color: colors.primary,
      marginBottom: 6,
    },
    title: {
      fontSize: 29,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: -0.6,
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginTop: 5,
      maxWidth: 260,
    },
    headerIcon: {
      width: 58,
      height: 58,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    statusCard: {
      padding: 18,
      marginBottom: 28,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
    },
    statusTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
    },
    statusIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    statusTextContainer: {
      flex: 1,
    },
    statusTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    statusDescription: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
      marginTop: 4,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginVertical: 18,
    },
    lastSyncRow: {
      gap: 7,
      marginBottom: 18,
    },
    lastSyncLabel: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
    },
    lastSyncLabelText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    lastSyncValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      marginLeft: 24,
    },
    syncButton: {
      marginTop: 0,
    },
    syncedHint: {
      fontSize: 11,
      lineHeight: 16,
      color: colors.textMuted,
      textAlign: "center",
      marginTop: 10,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 13,
      gap: 12,
    },
    sectionHeadingText: {
      flex: 1,
    },
    sectionTitle: {
      fontSize: 19,
      fontWeight: "700",
      color: colors.text,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 4,
      lineHeight: 17,
    },
    countBadge: {
      minWidth: 34,
      height: 34,
      paddingHorizontal: 9,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    countBadgeText: {
      fontSize: 14,
      fontWeight: "800",
    },
    pendingCard: {
      paddingHorizontal: 14,
      paddingVertical: 4,
      backgroundColor: colors.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
    },
    pendingGroup: {
      paddingVertical: 12,
    },
    secondPendingGroup: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 7,
    },
    groupTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    groupTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    groupCount: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    pendingItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    pendingIconContainer: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    pendingItemName: {
      flex: 1,
      fontSize: 13,
      fontWeight: "500",
      lineHeight: 18,
    },
    emptyCard: {
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 28,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: 20,
    },
    emptyIcon: {
      width: 58,
      height: 58,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
    },
    emptyDescription: {
      fontSize: 12,
      lineHeight: 19,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: 7,
    },
    infoCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSecondary,
    },
    infoIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    infoContent: {
      flex: 1,
    },
    infoTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 5,
    },
    infoText: {
      fontSize: 12,
      lineHeight: 19,
      color: colors.textSecondary,
    },
  });
}
