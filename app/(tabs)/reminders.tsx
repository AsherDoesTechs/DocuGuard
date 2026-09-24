import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Card } from "../../components/ui";
import { COLORS } from "@/constants";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import * as Notifications from "expo-notifications";

import {
  getAllReminders,
  markReminderAsRead,
  markAllRemindersAsRead,
  LocalReminder,
} from "../../services/localDatabase";

import { checkAndScheduleAlerts } from "../../services/notificationScheduler";

type FilterType = "all" | "unread" | "expired" | "expiring";

type ReminderSeverity = "Expired" | "Expiring Soon" | "Valid";

interface Reminder {
  id: number;
  title: string;
  description: string;
  dueDate: string;
  severity: ReminderSeverity;
  read: boolean;
}

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "expired", label: "Expired" },
  { key: "expiring", label: "Expiring Soon" },
];

export default function RemindersScreen() {
  const [notificationsEnabled, setNotificationsEnabled] =
    useState<boolean>(true);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  /*
   * Load saved notification preference from AsyncStorage.
   */
  const loadNotificationPreference = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("notificationsEnabled");
      if (stored !== null && mountedRef.current) {
        setNotificationsEnabled(stored === "true");
      }
    } catch (err) {
      console.error("Failed to load notification preference:", err);
    }
  }, []);

  /*
   * Check OS permission status separately without overwriting user preference.
   */
  const checkNotificationPermission = useCallback(async () => {
    try {
      const permissions = await Notifications.getPermissionsAsync();
      const granted =
        permissions.granted ||
        permissions.ios?.status ===
          Notifications.IosAuthorizationStatus.PROVISIONAL;

      if (mountedRef.current) {
        setPermissionGranted(granted);
      }
    } catch (err) {
      console.error("Failed to check notification permission:", err);
    }
  }, []);

  /*
   * Schedule alerts only if user wants them AND OS permissions allow.
   */
  const scheduleAlertsIfEnabled = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("notificationsEnabled");
      if (stored !== "true") return;

      const permissions = await Notifications.getPermissionsAsync();
      const granted =
        permissions.granted ||
        permissions.ios?.status ===
          Notifications.IosAuthorizationStatus.PROVISIONAL;

      if (!granted) return;

      await checkAndScheduleAlerts();
    } catch (err) {
      console.error("Failed to schedule alerts:", err);
    }
  }, []);

  /*
   * Calculate calendar-based days until/overdue safely.
   */
  const getDaysUntil = (date: string) => {
    const due = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.round(
      (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
  };

  /*
   * Calculate severity dynamically from date to keep UI consistent.
   */
  const calculateSeverity = (dueDate: string): ReminderSeverity => {
    const days = getDaysUntil(dueDate);
    if (days < 0) return "Expired";
    if (days <= 30) return "Expiring Soon";
    return "Valid";
  };

  /*
   * Load reminders from local database.
   */
  const fetchReminders = useCallback(async () => {
    if (!mountedRef.current) return false;

    try {
      setError(null);
      const localReminders: LocalReminder[] = await getAllReminders();

      const mappedReminders = localReminders
        .map((r) => {
          if (r.id == null) return null;
          return {
            id: r.id,
            title: r.title,
            description: r.description || "",
            dueDate: r.dueDate,
            severity: calculateSeverity(r.dueDate),
            read: !!r.read,
          };
        })
        .filter((r): r is Reminder => r !== null);

      if (mountedRef.current) {
        setReminders(mappedReminders);
        setLastFetch(Date.now());
      }
      return true;
    } catch (err) {
      console.error("Failed to load reminders:", err);
      if (mountedRef.current) {
        setError("Unable to load reminders.");
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  /*
   * Initial load + app foreground refresh subscription.
   */
  useEffect(() => {
    mountedRef.current = true;

    const initialize = async () => {
      await loadNotificationPreference();
      await checkNotificationPermission();
      await fetchReminders();
      await scheduleAlertsIfEnabled();
    };

    initialize();

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        fetchReminders();
        checkNotificationPermission();
        scheduleAlertsIfEnabled().catch(console.warn);
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [
    fetchReminders,
    loadNotificationPreference,
    checkNotificationPermission,
    scheduleAlertsIfEnabled,
  ]);

  /*
   * Toggle notification preference & manage cancellation.
   */
  const handleToggleNotifications = async (value: boolean) => {
    try {
      if (value) {
        const permission = await Notifications.requestPermissionsAsync();
        const granted =
          permission.granted ||
          permission.ios?.status ===
            Notifications.IosAuthorizationStatus.PROVISIONAL;

        setPermissionGranted(granted);

        if (!granted) {
          Alert.alert(
            "Notifications Disabled",
            "Please enable notifications in your device settings to receive reminder alerts.",
          );
          return;
        }
      } else {
        // Cancel scheduled notifications if user turns preference off
        await Notifications.cancelAllScheduledNotificationsAsync();
      }

      setNotificationsEnabled(value);
      await AsyncStorage.setItem("notificationsEnabled", String(value));

      if (value) {
        try {
          await checkAndScheduleAlerts();
        } catch (err) {
          console.error("Failed to schedule alerts:", err);
          Alert.alert(
            "Notification Setup Failed",
            "Notifications are enabled, but reminders could not be scheduled.",
          );
        }
      }
    } catch (err) {
      console.error("Failed to update notification preference:", err);
      Alert.alert("Error", "Could not update notification settings.");
    }
  };

  const handleDataReload = async () => {
    await checkNotificationPermission();
    await fetchReminders();
    await scheduleAlertsIfEnabled();
  };

  const handleMarkAsRead = async (id: number) => {
    try {
      await markReminderAsRead(id);
      if (mountedRef.current) {
        setReminders((prev) =>
          prev.map((reminder) =>
            reminder.id === id ? { ...reminder, read: true } : reminder,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to mark reminder as read:", err);
      Alert.alert("Error", "Could not update this reminder.");
    }
  };

  const handleMarkAllAsRead = async () => {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    try {
      await markAllRemindersAsRead();
      if (mountedRef.current) {
        setReminders((prev) =>
          prev.map((reminder) => ({ ...reminder, read: true })),
        );
      }
    } catch (err) {
      console.error("Failed to mark all reminders as read:", err);
      Alert.alert("Error", "Could not mark reminders as read.");
    } finally {
      if (mountedRef.current) {
        setMarkingAllRead(false);
      }
    }
  };

  const filtered = reminders.filter((r) => {
    if (filter === "unread") return !r.read;
    if (filter === "expired") return r.severity === "Expired";
    if (filter === "expiring") return r.severity === "Expiring Soon";
    return true;
  });

  const unreadCount = reminders.filter((r) => !r.read).length;

  const getSeverityIcon = (severity: ReminderSeverity) => {
    switch (severity) {
      case "Expired":
        return "alert-circle";
      case "Expiring Soon":
        return "warning";
      default:
        return "checkmark-circle";
    }
  };

  const getSeverityColor = (severity: ReminderSeverity) => {
    switch (severity) {
      case "Expired":
        return COLORS.danger;
      case "Expiring Soon":
        return COLORS.warning;
      default:
        return COLORS.success;
    }
  };

  const getSeverityLabel = (severity: ReminderSeverity) => {
    switch (severity) {
      case "Expired":
        return "Expired";
      case "Expiring Soon":
        return "Expiring Soon";
      default:
        return "Valid";
    }
  };

  const getDueStatus = (date: string) => {
    const days = getDaysUntil(date);
    if (days < 0) {
      const overdueDays = Math.abs(days);
      return overdueDays === 1
        ? "1 day overdue"
        : `${overdueDays} days overdue`;
    }
    if (days === 0) return "Due today";
    if (days === 1) return "1 day remaining";
    return `${days} days remaining`;
  };

  const formatLastUpdated = (timestamp: number) => {
    if (!timestamp) return "Never";
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Reminders</Text>
              <Text style={styles.subtitle}>{unreadCount} unread</Text>
            </View>

            <View style={styles.notificationControls}>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: "#ccc", true: COLORS.primary }}
                accessibilityRole="switch"
                accessibilityLabel="Reminder notifications"
                accessibilityHint="Turns reminder notifications on or off"
              />
              <Ionicons
                name={
                  notificationsEnabled ? "notifications" : "notifications-off"
                }
                size={24}
                color={
                  notificationsEnabled ? COLORS.primary : COLORS.textSecondary
                }
              />
            </View>
          </View>

          {!permissionGranted && notificationsEnabled && (
            <Text style={styles.permissionWarningText}>
              Note: Notifications are enabled in-app but disabled in device
              settings.
            </Text>
          )}

          <View style={styles.lastUpdated}>
            <Ionicons name="refresh" size={12} color={COLORS.textSecondary} />
            <Text style={styles.lastUpdatedText}>
              Last updated: {formatLastUpdated(lastFetch)}
            </Text>
          </View>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons
              name="cloud-offline-outline"
              size={48}
              color={COLORS.danger}
            />
            <Text style={styles.errorText}>Unable to load reminders</Text>
            <Text style={styles.errorSubtext}>Please try again.</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={fetchReminders}
              accessibilityRole="button"
              accessibilityLabel="Try loading reminders again"
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!error && (
          <>
            {/* Mark all as read */}
            {unreadCount > 0 && (
              <TouchableOpacity
                style={styles.markAllButton}
                onPress={handleMarkAllAsRead}
                disabled={markingAllRead}
                accessibilityRole="button"
                accessibilityLabel="Mark all reminders as read"
              >
                {markingAllRead ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-done"
                      size={16}
                      color={COLORS.primary}
                    />
                    <Text style={styles.markAllText}>Mark all as read</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Filters (Horizontally Scrollable for small screens) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
            >
              <View style={styles.filterTabs}>
                {FILTERS.map((tab) => (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => setFilter(tab.key)}
                    style={[
                      styles.filterTab,
                      filter === tab.key && styles.filterTabActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === tab.key }}
                    accessibilityLabel={`Filter by ${tab.label}`}
                  >
                    <Text
                      style={[
                        styles.filterTabText,
                        filter === tab.key && styles.filterTabTextActive,
                      ]}
                    >
                      {tab.key === "unread" && unreadCount > 0
                        ? `Unread (${unreadCount})`
                        : tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Loading */}
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Loading reminders...</Text>
              </View>
            ) : filtered.length === 0 ? (
              /* Empty */
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="notifications-off"
                  size={48}
                  color={COLORS.textSecondary}
                />
                <Text style={styles.emptyText}>No reminders found.</Text>
                <Text style={styles.emptySubtext}>
                  Pull to refresh or check back later
                </Text>
              </View>
            ) : (
              /* Reminder list */
              <View style={styles.remindersList}>
                {filtered.map((reminder) => {
                  const severityColor = getSeverityColor(reminder.severity);
                  const severityIcon = getSeverityIcon(reminder.severity);

                  return (
                    <Card
                      key={reminder.id}
                      style={[
                        styles.reminderCard,
                        !reminder.read && styles.unreadReminderCard,
                      ]}
                    >
                      <View
                        style={[
                          styles.reminderBorder,
                          { borderLeftColor: severityColor },
                        ]}
                      >
                        {!reminder.read && <View style={styles.unreadDot} />}
                        <View style={styles.reminderContent}>
                          <Ionicons
                            name={severityIcon as any}
                            size={24}
                            color={severityColor}
                            style={styles.reminderIcon}
                          />

                          <View style={styles.reminderInfo}>
                            <Text style={styles.reminderTitle}>
                              {reminder.title}
                            </Text>
                            {reminder.description ? (
                              <Text style={styles.reminderDesc}>
                                {reminder.description}
                              </Text>
                            ) : null}

                            <View style={styles.reminderMeta}>
                              <Text style={styles.reminderDate}>
                                Due: {formatShortDate(reminder.dueDate)}
                              </Text>
                              <Text
                                style={[
                                  styles.daysText,
                                  { color: severityColor },
                                ]}
                              >
                                {getDueStatus(reminder.dueDate)}
                              </Text>

                              <View style={styles.severityBadge}>
                                <Ionicons
                                  name={severityIcon as any}
                                  size={12}
                                  color={severityColor}
                                />
                                <Text
                                  style={[
                                    styles.severityText,
                                    { color: severityColor },
                                  ]}
                                >
                                  {getSeverityLabel(reminder.severity)}
                                </Text>
                              </View>
                            </View>

                            {!reminder.read && (
                              <TouchableOpacity
                                style={styles.markReadButton}
                                onPress={() => handleMarkAsRead(reminder.id)}
                                accessibilityRole="button"
                                accessibilityLabel={`Mark ${reminder.title} as read`}
                              >
                                <Ionicons
                                  name="checkmark"
                                  size={16}
                                  color={COLORS.primary}
                                />
                                <Text style={styles.markReadText}>
                                  Mark as read
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </>
        )}
      </RefreshableContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingTop: 24,
    paddingBottom: 100,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  notificationControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  permissionWarningText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 6,
  },
  lastUpdated: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  lastUpdatedText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  markAllButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    marginBottom: 12,
    minHeight: 24,
  },
  markAllText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  filterScroll: {
    marginBottom: 20,
  },
  filterTabs: {
    flexDirection: "row",
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
  },
  filterTabTextActive: {
    color: "#fff",
  },
  remindersList: {
    gap: 12,
  },
  reminderCard: {
    padding: 0,
    overflow: "hidden",
  },
  unreadReminderCard: {
    borderWidth: 1,
    borderColor: `${COLORS.primary}40`,
    backgroundColor: `${COLORS.primary}04`,
  },
  reminderBorder: {
    borderLeftWidth: 4,
    padding: 16,
    position: "relative",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    position: "absolute",
    top: 14,
    right: 14,
  },
  reminderContent: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  reminderIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  reminderInfo: {
    flex: 1,
    paddingRight: 8,
  },
  reminderTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
  },
  reminderDesc: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  reminderMeta: {
    marginTop: 8,
    gap: 8,
  },
  reminderDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  daysText: {
    fontSize: 12,
    fontWeight: "600",
  },
  severityBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  severityText: {
    fontSize: 11,
    fontWeight: "600",
  },
  markReadButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: `${COLORS.primary}10`,
  },
  markReadText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "600",
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    textAlign: "center",
    color: COLORS.textSecondary,
    fontSize: 16,
  },
  emptySubtext: {
    textAlign: "center",
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  errorContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
    gap: 12,
  },
  errorText: {
    textAlign: "center",
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "600",
  },
  errorSubtext: {
    textAlign: "center",
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
