import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  DeviceEventEmitter,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp, Layout } from "react-native-reanimated";
import { Card } from "../../components/ui";

import { formatShortDate, parseLocalDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import { RemindersSkeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/context/ThemeContext";
import * as Notifications from "expo-notifications";

import {
  getAllReminders,
  getAllDocuments,
  markReminderAsRead,
  markAllRemindersAsRead,
  LocalReminder,
  updateDocument,
  upsertExpiredDocumentReminder,
} from "../../services/localDatabase";

import {
  checkAndScheduleAlerts,
  syncDocumentRemindersToDb,
} from "../../services/notificationScheduler";
import {
  isNotificationsEnabled,
  setNotificationsEnabled as persistNotificationsEnabled,
} from "../../services/notificationPreferences";
import {
  feedbackService,
  useFeedbackService,
} from "@/services/feedbackService";

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

type FilterType = "all" | "unread" | "expired" | "expiring";
type ReminderSeverity = "Expired" | "Expiring Soon" | "Valid";

interface Reminder {
  id: number;
  documentId?: number | string;
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
  useFeedbackService();
  const router = useRouter();

  const { colors, isDark } = useTheme();

  const themeColors = useMemo(
    () => ({
      ...colors,
      danger: colors.error,
    }),
    [colors],
  );

  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] =
    useState<boolean>(true);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [updatingNotifications, setUpdatingNotifications] = useState(false);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);
  const fetchInProgressRef = useRef(false);

  // Updated Document modal state
  const [updateDocModal, setUpdateDocModal] = useState<{
    visible: boolean;
    reminder: Reminder | null;
    newExpiryDate: string;
  }>({ visible: false, reminder: null, newExpiryDate: "" });

  const getDaysUntil = useCallback(
    (dateStr: string) => {
      const due = parseLocalDate(dateStr);
      if (!due || Number.isNaN(due.getTime())) {
        return Number.NaN;
      }
      due.setHours(0, 0, 0, 0);
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return Math.round((due.getTime() - today.getTime()) / 86400000);
    },
    [now],
  );

  const calculateSeverity = useCallback(
    (dueDate: string): ReminderSeverity => {
      const days = getDaysUntil(dueDate);

      if (!Number.isFinite(days)) return "Valid";
      if (days < 0) return "Expired";
      if (days <= 30) return "Expiring Soon";

      return "Valid";
    },
    [getDaysUntil],
  );

  const fetchReminders = useCallback(async () => {
    if (!mountedRef.current || fetchInProgressRef.current) {
      return false;
    }

    fetchInProgressRef.current = true;

    try {
      setError(null);

      // 1. Fetch all documents and local reminders concurrently
      const [localDocs, localReminders] = await Promise.all([
        getAllDocuments(),
        getAllReminders(),
      ]);

      // 2. Map existing reminders safely using `any` cast
      const reminderMap = new Map<string, any>();
      localReminders.forEach((r: any) => {
        const docId = r.documentId ?? r.document_id;
        if (docId) {
          reminderMap.set(String(docId), r);
        }
      });

      const dynamicReminders: Reminder[] = [];
      let nextId = 1000;

      // 3. Dynamically evaluate all documents to build real-time reminders
      for (const doc of localDocs) {
        if (!doc.expiryDate || doc.status === "deleted") continue;

        const severity = calculateSeverity(doc.expiryDate);

        // Include any document that is Expired or Expiring Soon (within 30 days)
        if (severity === "Expired" || severity === "Expiring Soon") {
          const existing = reminderMap.get(String(doc.id));

          // Ensure reminder row exists in database for both Expired and Expiring Soon
          if (doc.id != null) {
            await upsertExpiredDocumentReminder(doc.title, doc.expiryDate, doc.id);
          }

          dynamicReminders.push({
            id: doc.id ? Number(doc.id) : nextId++,
            documentId: doc.id,
            title:
              severity === "Expired"
                ? `Document Expired: ${doc.title}`
                : `Document Expiring: ${doc.title}`,
            description: `Your document "${doc.title}" issued by ${doc.issuer || "Unknown"} is due on ${doc.expiryDate}.`,
            dueDate: doc.expiryDate,
            severity: severity,
            read: existing ? !!existing.read : false,
          });
        }
      }

      // Also append any non-document custom reminders if they exist
      localReminders.forEach((r: any) => {
        const docId = r.documentId ?? r.document_id;
        if (!docId && r.id != null && r.dueDate) {
          dynamicReminders.push({
            id: r.id,
            documentId: undefined,
            title: r.title,
            description: r.description || "",
            dueDate: r.dueDate,
            severity: calculateSeverity(r.dueDate),
            read: !!r.read,
          });
        }
      });

      if (mountedRef.current) {
        setReminders(dynamicReminders);
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
      fetchInProgressRef.current = false;

      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [calculateSeverity]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "documentVaultChanged",
      () => {
        void fetchReminders();
      },
    );
    return () => {
      subscription.remove();
    };
  }, [fetchReminders]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (mountedRef.current) {
        setNow(Date.now());
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadNotificationPreference = useCallback(async () => {
    try {
      const enabled = await isNotificationsEnabled();

      if (mountedRef.current) {
        setNotificationsEnabled(enabled);
      }
    } catch (err) {
      console.error("Failed to load notification preference:", err);
    }
  }, []);

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

  const scheduleAlertsIfEnabled = useCallback(async () => {
    try {
      if (!(await isNotificationsEnabled())) {
        return;
      }

      const permissions = await Notifications.getPermissionsAsync();

      const granted =
        permissions.granted ||
        permissions.ios?.status ===
          Notifications.IosAuthorizationStatus.PROVISIONAL;

      if (!granted) {
        return;
      }

      await checkAndScheduleAlerts();
    } catch (err) {
      console.error("Failed to schedule alerts:", err);
    }
  }, []);

  const refreshReminders = useCallback(async () => {
    await fetchReminders();
    await scheduleAlertsIfEnabled();
  }, [fetchReminders, scheduleAlertsIfEnabled]);

  useFocusEffect(
    useCallback(() => {
      void refreshReminders();
    }, [refreshReminders]),
  );

  useEffect(() => {
    mountedRef.current = true;

    const initialize = async () => {
      await loadNotificationPreference();
      await checkNotificationPermission();
      await refreshReminders();
    };

    void initialize();

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        void refreshReminders();
        void checkNotificationPermission();
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
    refreshReminders,
    loadNotificationPreference,
    checkNotificationPermission,
  ]);

  useEffect(() => {
    if (reminders.length === 0) return;
    void scheduleAlertsIfEnabled();
  }, [reminders, scheduleAlertsIfEnabled]);

  const handleToggleNotifications = async (value: boolean) => {
    if (updatingNotifications || value === notificationsEnabled) {
      return;
    }

    const previous = notificationsEnabled;
    setNotificationsEnabled(value);
    setUpdatingNotifications(true);

    try {
      if (value) {
        const permission = await Notifications.requestPermissionsAsync();
        const granted =
          permission.granted ||
          permission.ios?.status ===
            Notifications.IosAuthorizationStatus.PROVISIONAL;

        if (mountedRef.current) {
          setPermissionGranted(granted);
        }

        if (!granted) {
          if (mountedRef.current) {
            setNotificationsEnabled(previous);
          }
          await persistNotificationsEnabled(previous).catch(() => {});
          await feedbackService.alert({
            title: "Notifications Disabled",
            message:
              "Please enable notifications in your device settings to receive reminder alerts.",
            type: "warning",
          });
          return;
        }

        await persistNotificationsEnabled(true);
        void checkAndScheduleAlerts().catch((err) => {
          console.error("Failed to schedule alerts after enabling:", err);
        });
      } else {
        await persistNotificationsEnabled(false);
        void Notifications.cancelAllScheduledNotificationsAsync().catch((err) => {
          console.error("Failed to cancel scheduled notifications:", err);
        });
      }
    } catch (err) {
      console.error("Failed to update notification preference:", err);
      if (mountedRef.current) {
        setNotificationsEnabled(previous);
        setError("Could not update notification settings.");
      }
      await persistNotificationsEnabled(previous).catch(() => {});
    } finally {
      if (mountedRef.current) {
        setUpdatingNotifications(false);
      }
    }
  };

  const handleDataReload = async () => {
    await checkNotificationPermission();
    await refreshReminders();
  };

  const handleMarkAsRead = async (id: number) => {
    try {
      await markReminderAsRead(id);

      if (mountedRef.current) {
        setReminders((previous) =>
          previous.map((reminder) =>
            reminder.id === id ? { ...reminder, read: true } : reminder,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to mark reminder as read:", err);

      await feedbackService.alert({
        title: "Error",
        message: "Could not update this reminder.",
        type: "error",
      });
    }
  };

  const handleMarkAllAsRead = async () => {
    if (markingAllRead) {
      return;
    }

    setMarkingAllRead(true);

    try {
      // First, get all documents to ensure reminder rows exist for expiring/expired docs
      const localDocs = await getAllDocuments();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      thirtyDaysFromNow.setHours(23, 59, 59, 999);

      for (const doc of localDocs) {
        if (!doc.expiryDate || doc.status === "deleted") continue;
        const expDate = new Date(doc.expiryDate);
        if (isNaN(expDate.getTime())) continue;
        expDate.setHours(0, 0, 0, 0);
        if (expDate < today || (expDate >= today && expDate <= thirtyDaysFromNow)) {
          // This document is expired or expiring soon - ensure reminder row exists
          if (doc.id != null) {
            await upsertExpiredDocumentReminder(
              doc.title,
              doc.expiryDate,
              doc.id,
            );
          }
        }
      }

      // Now mark all reminders as read
      await markAllRemindersAsRead();

      if (mountedRef.current) {
        setReminders((previous) =>
          previous.map((reminder) => ({
            ...reminder,
            read: true,
          })),
        );
      }
    } catch (err) {
      console.error("Failed to mark all reminders as read:", err);

      await feedbackService.alert({
        title: "Error",
        message: "Could not mark reminders as read.",
        type: "error",
      });
    } finally {
      if (mountedRef.current) {
        setMarkingAllRead(false);
      }
    }
  };

  const handleOpenUpdateDocument = useCallback((reminder: Reminder) => {
    if (!reminder.documentId) return;
    // Pre-fill with current expiry date or tomorrow
    const currentDate = reminder.dueDate;
    setUpdateDocModal({
      visible: true,
      reminder,
      newExpiryDate: currentDate,
    });
  }, []);

  const handleConfirmUpdateDocument = useCallback(async () => {
    const { reminder, newExpiryDate } = updateDocModal;
    if (!reminder?.documentId || !newExpiryDate) {
      setUpdateDocModal((prev) => ({ ...prev, visible: false }));
      return;
    }

    try {
      // Update the document's expiry date
      await updateDocument(reminder.documentId as number, {
        expiryDate: newExpiryDate,
      });

      // Also update the local reminder
      if (mountedRef.current) {
        setReminders((prev) =>
          prev.map((r) =>
            r.id === reminder.id
              ? { ...r, dueDate: newExpiryDate, severity: calculateSeverity(newExpiryDate) }
              : r,
          ),
        );
      }

      // Upsert the reminder with new expiry date to keep it in sync
      await upsertExpiredDocumentReminder(
        reminder.title.replace("Document Expired: ", "").replace("Document Expiring: ", ""),
        newExpiryDate,
        reminder.documentId as number,
      );

      await feedbackService.success("Document renewal date updated successfully.");
    } catch (err) {
      console.error("Failed to update document expiry:", err);
      await feedbackService.alert({
        title: "Error",
        message: "Could not update the document renewal date.",
        type: "error",
      });
    } finally {
      setUpdateDocModal((prev) => ({ ...prev, visible: false }));
    }
  }, [updateDocModal, calculateSeverity]);

  const handleCancelUpdateDocument = useCallback(() => {
    setUpdateDocModal((prev) => ({ ...prev, visible: false }));
  }, []);

  const unreadCount = useMemo(
    () => reminders.filter((reminder) => !reminder.read).length,
    [reminders],
  );

  const expiredCount = useMemo(
    () =>
      reminders.filter((reminder) => reminder.severity === "Expired").length,
    [reminders],
  );

  const expiringCount = useMemo(
    () =>
      reminders.filter((reminder) => reminder.severity === "Expiring Soon")
        .length,
    [reminders],
  );

  const filtered = useMemo(
    () =>
      reminders.filter((reminder) => {
        if (filter === "unread") return !reminder.read;
        if (filter === "expired") return reminder.severity === "Expired";
        if (filter === "expiring") {
          return reminder.severity === "Expiring Soon";
        }

        return true;
      }),
    [filter, reminders, now],
  );

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
        return themeColors.danger;
      case "Expiring Soon":
        return themeColors.warning;
      default:
        return themeColors.success;
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

  const getDueStatus = useCallback(
    (date: string) => {
      const days = getDaysUntil(date);

      if (days < 0) {
        const overdueDays = Math.abs(days);

        return overdueDays === 1
          ? "Expired 1 day ago"
          : `Expired ${overdueDays} days ago`;
      }

      if (days === 0) return "Due today";
      if (days === 1) return "1 day remaining";

      return `${days} days remaining`;
    },
    [getDaysUntil],
  );

  const formatLastUpdated = (timestamp: number) => {
    if (!timestamp) return "Never";

    const diff = Date.now() - timestamp;

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

    return `${Math.floor(diff / 3600000)}h ago`;
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: themeColors.background }]}
    >
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextContainer}>
              <Text style={styles.title}>Reminders</Text>
              <Text style={styles.subtitle}>{unreadCount} unread</Text>
            </View>

            <View style={styles.notificationControls}>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                disabled={updatingNotifications}
                trackColor={{
                  false: themeColors.border,
                  true: themeColors.primary,
                }}
                thumbColor={colors.switchThumb}
                accessibilityRole="switch"
                accessibilityLabel="Reminder notifications"
                accessibilityHint="Turns reminder notifications on or off"
              />

              <Ionicons
                name={
                  notificationsEnabled ? "notifications" : "notifications-off"
                }
                size={22}
                color={
                  notificationsEnabled
                    ? themeColors.primary
                    : themeColors.textSecondary
                }
              />
            </View>
          </View>

          {!permissionGranted && notificationsEnabled && (
            <View style={styles.permissionWarning}>
              <Ionicons
                name="information-circle-outline"
                size={17}
                color={themeColors.warning}
              />
              <Text style={styles.permissionWarningText}>
                Notifications are enabled in-app but disabled in your device
                settings.
              </Text>
            </View>
          )}

          <View style={styles.lastUpdated}>
            <Ionicons
              name="refresh"
              size={13}
              color={themeColors.textSecondary}
            />
            <Text style={styles.lastUpdatedText}>
              Last updated: {formatLastUpdated(lastFetch)}
            </Text>
          </View>

          <View style={styles.summaryRow} accessibilityLabel="Reminder summary">
            {[
              {
                label: "Total",
                value: reminders.length,
                color: themeColors.text,
              },
              {
                label: "Unread",
                value: unreadCount,
                color: themeColors.primary,
              },
              {
                label: "Expired",
                value: expiredCount,
                color: themeColors.danger,
              },
              {
                label: "Expiring",
                value: expiringCount,
                color: themeColors.warning,
              },
            ].map((item) => (
              <View key={item.label} style={styles.summaryCard}>
                <Text style={[styles.summaryValue, { color: item.color }]}>
                  {item.value}
                </Text>
                <Text style={styles.summaryLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconContainer}>
              <Ionicons
                name="cloud-offline-outline"
                size={34}
                color={themeColors.danger}
              />
            </View>

            <Text style={styles.errorText}>Unable to load reminders</Text>
            <Text style={styles.errorSubtext}>Please try again.</Text>

            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => void fetchReminders()}
              accessibilityRole="button"
              accessibilityLabel="Try loading reminders again"
              activeOpacity={0.8}
            >
              <Ionicons
                name="refresh"
                size={18}
                color={themeColors.buttonPrimaryText}
              />
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
                onPress={() => void handleMarkAllAsRead()}
                disabled={markingAllRead}
                accessibilityRole="button"
                accessibilityLabel="Mark all reminders as read"
                accessibilityState={{ disabled: markingAllRead }}
                activeOpacity={0.7}
              >
                {markingAllRead ? (
                  <ActivityIndicator size="small" color={themeColors.primary} />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-done"
                      size={17}
                      color={themeColors.primary}
                    />
                    <Text style={styles.markAllText}>Mark all as read</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Filters */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              contentContainerStyle={styles.filterScrollContent}
            >
              <View style={styles.filterTabs}>
                {FILTERS.map((tab) => {
                  const isActive = filter === tab.key;

                  return (
                    <TouchableOpacity
                      key={tab.key}
                      onPress={() => setFilter(tab.key)}
                      style={[
                        styles.filterTab,
                        isActive && styles.filterTabActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={`Filter by ${tab.label}, ${tab.key === "all" ? reminders.length : tab.key === "unread" ? unreadCount : tab.key === "expired" ? expiredCount : expiringCount} reminders`}
                      accessibilityHint="Shows only reminders matching this filter"
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.filterTabText,
                          isActive && styles.filterTabTextActive,
                        ]}
                      >
                        {tab.key === "unread"
                          ? `Unread (${unreadCount})`
                          : tab.key === "expired"
                            ? `Expired (${expiredCount})`
                            : tab.key === "expiring"
                              ? `Expiring Soon (${expiringCount})`
                              : tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Loading / Empty / List */}
            {loading ? (
              <RemindersSkeleton />
            ) : filtered.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconContainer}>
                  <Ionicons
                    name={
                      filter === "unread"
                        ? "checkmark-done-circle-outline"
                        : "notifications-off-outline"
                    }
                    size={34}
                    color={themeColors.textSecondary}
                  />
                </View>

                <Text style={styles.emptyText}>
                  {filter === "unread"
                    ? "You're all caught up"
                    : "No reminders found"}
                </Text>

                <Text style={styles.emptySubtext}>
                  {filter === "unread"
                    ? "There are no unread reminders right now."
                    : "Pull to refresh or check back later."}
                </Text>
              </View>
            ) : (
              <View style={styles.remindersList}>
                {filtered.map((reminder, index) => {
                  const severityColor = getSeverityColor(reminder.severity);
                  const severityIcon = getSeverityIcon(reminder.severity);

                  return (
                    <AnimatedTouchableOpacity
                      key={reminder.id}
                      entering={FadeInDown.delay(Math.min(index, 8) * 35).duration(260)}
                      layout={Layout.springify().damping(18).stiffness(140)}
                      activeOpacity={0.8}
                      onPress={() => {
                        if (reminder.documentId) {
                          router.push(
                            `/document-details/${String(reminder.documentId)}` as any,
                          );
                        } else {
                          feedbackService.info(
                            "No document attached to this reminder.",
                          );
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`View details for ${reminder.title}`}
                    >
                      <Card
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
                            <View
                              style={[
                                styles.reminderIconContainer,
                                {
                                  backgroundColor: themeColors.surfaceSecondary,
                                },
                              ]}
                            >
                              <Ionicons
                                name={severityIcon as any}
                                size={22}
                                color={severityColor}
                              />
                            </View>

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
                                <View style={styles.dateRow}>
                                  <Ionicons
                                    name="calendar-outline"
                                    size={13}
                                    color={themeColors.textSecondary}
                                  />
                                  <Text style={styles.reminderDate}>
                                    Due: {formatShortDate(reminder.dueDate)}
                                  </Text>
                                </View>

                                <Text
                                  style={[
                                    styles.daysText,
                                    { color: severityColor },
                                  ]}
                                >
                                  {getDueStatus(reminder.dueDate)}
                                </Text>

                                <View
                                  style={[
                                    styles.severityBadge,
                                    {
                                      backgroundColor:
                                        themeColors.surfaceSecondary,
                                    },
                                  ]}
                                >
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

                              {/* Google-style Action Buttons Bar */}
                              <View style={styles.cardActionsRow}>
                                {!reminder.read && (
                                  <TouchableOpacity
                                    style={styles.actionButton}
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      void handleMarkAsRead(reminder.id);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Mark ${reminder.title} as read`}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons
                                      name="checkmark-circle-outline"
                                      size={15}
                                      color={themeColors.primary}
                                    />
                                    <Text style={styles.actionButtonText}>
                                      Mark Read
                                    </Text>
                                  </TouchableOpacity>
                                )}

                                {reminder.documentId && (
                                  <TouchableOpacity
                                    style={styles.actionButton}
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      router.push(
                                        `/document-details/${String(reminder.documentId)}` as any,
                                      );
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`View document for ${reminder.title}`}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons
                                      name="document-text-outline"
                                      size={15}
                                      color={themeColors.textSecondary}
                                    />
                                    <Text
                                      style={[
                                        styles.actionButtonText,
                                        { color: themeColors.textSecondary },
                                      ]}
                                    >
                                      View Doc
                                    </Text>
                                  </TouchableOpacity>
                                )}

                                {reminder.documentId && reminder.severity !== "Valid" && (
                                  <TouchableOpacity
                                    style={[
                                      styles.actionButton,
                                      { borderColor: themeColors.primary },
                                    ]}
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      handleOpenUpdateDocument(reminder);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Update renewal date for ${reminder.title}`}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons
                                      name="refresh-circle-outline"
                                      size={15}
                                      color={themeColors.primary}
                                    />
                                    <Text
                                      style={[
                                        styles.actionButtonText,
                                        { color: themeColors.primary, fontWeight: "700" },
                                      ]}
                                    >
                                      Updated Document
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          </View>
                        </View>
                      </Card>
                    </AnimatedTouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </RefreshableContainer>

      {/* Updated Document Modal */}
      {updateDocModal.visible && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={handleCancelUpdateDocument}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={handleCancelUpdateDocument}
            />
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Update Document Renewal</Text>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={handleCancelUpdateDocument}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={22} color={themeColors.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalMessage}>
                Enter the new renewal date for{"\n"}
                <Text style={styles.modalDocumentTitle}>
                  {updateDocModal.reminder?.title || "this document"}
                </Text>
              </Text>

              <View style={styles.datePickerContainer}>
                <TouchableOpacity
                  style={[
                    styles.datePickerButton,
                    { borderColor: themeColors.primary },
                  ]}
                  onPress={() => {
                    // For now just use the current date - could add a proper date picker later
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const formatted = tomorrow.toISOString().split("T")[0];
                    setUpdateDocModal((prev) => ({ ...prev, newExpiryDate: formatted }));
                  }}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={20}
                    color={themeColors.primary}
                  />
                  <Text style={styles.datePickerText}>
                    {updateDocModal.newExpiryDate
                      ? formatShortDate(updateDocModal.newExpiryDate)
                      : "Select date"}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={themeColors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={handleCancelUpdateDocument}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalConfirmButton}
                  onPress={handleConfirmUpdateDocument}
                >
                  <Text style={styles.modalConfirmButtonText}>Update</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const createStyles = (COLORS: any) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
    },
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
      gap: 12,
    },
    headerTextContainer: {
      flex: 1,
    },
    notificationControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    header: {
      marginBottom: 24,
    },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: COLORS.text,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 14,
      color: COLORS.textSecondary,
      marginTop: 4,
    },
    permissionWarning: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 7,
      marginTop: 10,
      padding: 10,
      borderRadius: 10,
      backgroundColor: COLORS.surfaceSecondary,
    },
    permissionWarningText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      color: COLORS.warning,
    },
    lastUpdated: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 12,
    },
    lastUpdatedText: {
      fontSize: 12,
      color: COLORS.textSecondary,
    },
    summaryRow: {
      flexDirection: "row",
      gap: 7,
      marginTop: 14,
    },
    summaryCard: {
      flex: 1,
      minWidth: 0,
      minHeight: 54,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 7,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surface,
    },
    summaryValue: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "700",
      color: COLORS.text,
    },
    summaryLabel: {
      marginTop: 2,
      fontSize: 10,
      fontWeight: "600",
      color: COLORS.textSecondary,
      textAlign: "center",
    },
    markAllButton: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-end",
      gap: 6,
      marginBottom: 14,
      minHeight: 32,
      paddingHorizontal: 4,
    },
    markAllText: {
      color: COLORS.primary,
      fontSize: 13,
      fontWeight: "600",
    },
    filterScroll: {
      marginBottom: 16,
    },
    filterScrollContent: {
      paddingRight: 4,
    },
    filterTabs: {
      flexDirection: "row",
      gap: 7,
      alignItems: "center",
    },
    filterTab: {
      minHeight: 34,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surface,
      justifyContent: "center",
      alignItems: "center",
    },
    filterTabActive: {
      backgroundColor: COLORS.primary,
      borderColor: COLORS.primary,
    },
    filterTabText: {
      fontSize: 12,
      fontWeight: "600",
      color: COLORS.textSecondary,
    },
    filterTabTextActive: {
      color: COLORS.buttonPrimaryText,
    },
    remindersList: {
      gap: 12,
    },
    reminderCard: {
      padding: 0,
      overflow: "hidden",
      backgroundColor: COLORS.surface,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    unreadReminderCard: {
      borderWidth: 1,
      borderColor: COLORS.primary,
      backgroundColor: COLORS.surface,
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
      zIndex: 1,
    },
    reminderContent: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    reminderIconContainer: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    reminderInfo: {
      flex: 1,
      paddingRight: 8,
    },
    reminderTitle: {
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "700",
      color: COLORS.text,
      paddingRight: 8,
    },
    reminderDesc: {
      fontSize: 13,
      lineHeight: 19,
      color: COLORS.textSecondary,
      marginTop: 5,
    },
    reminderMeta: {
      marginTop: 12,
      gap: 9,
      alignItems: "flex-start",
    },
    dateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    reminderDate: {
      fontSize: 12,
      color: COLORS.textSecondary,
    },
    daysText: {
      fontSize: 12,
      fontWeight: "700",
    },
    severityBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 8,
    },
    severityText: {
      fontSize: 11,
      fontWeight: "700",
    },
    cardActionsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 14,
    },
    actionButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surfaceSecondary,
    },
    actionButtonText: {
      color: COLORS.primary,
      fontSize: 12,
      fontWeight: "600",
    },
    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: 52,
      gap: 12,
    },
    emptyIconContainer: {
      width: 68,
      height: 68,
      borderRadius: 22,
      backgroundColor: COLORS.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    },
    emptyText: {
      textAlign: "center",
      color: COLORS.text,
      fontSize: 16,
      fontWeight: "600",
    },
    emptySubtext: {
      textAlign: "center",
      color: COLORS.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    errorContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: 48,
      gap: 12,
    },
    errorIconContainer: {
      width: 68,
      height: 68,
      borderRadius: 22,
      backgroundColor: COLORS.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    },
    errorText: {
      textAlign: "center",
      color: COLORS.text,
      fontSize: 17,
      fontWeight: "700",
    },
    errorSubtext: {
      textAlign: "center",
      color: COLORS.textSecondary,
      fontSize: 13,
    },
    retryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 8,
      paddingHorizontal: 18,
      paddingVertical: 11,
      borderRadius: 10,
      backgroundColor: COLORS.primary,
    },
    retryButtonText: {
      color: COLORS.buttonPrimaryText,
      fontSize: 14,
      fontWeight: "600",
    },
    // Updated Document Modal Styles
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    modalBackdrop: {
      flex: 1,
      width: "100%",
    },
    modalContent: {
      backgroundColor: COLORS.surface,
      borderRadius: 20,
      padding: 24,
      width: "100%",
      maxWidth: 340,
      shadowColor: COLORS.shadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 20,
      elevation: 10,
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: COLORS.text,
    },
    modalCloseButton: {
      padding: 4,
    },
    modalMessage: {
      fontSize: 14,
      color: COLORS.textSecondary,
      lineHeight: 21,
      textAlign: "center",
      marginBottom: 20,
    },
    modalDocumentTitle: {
      fontWeight: "600",
      color: COLORS.text,
    },
    datePickerContainer: {
      marginBottom: 24,
    },
    datePickerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 2,
      backgroundColor: COLORS.surfaceSecondary,
    },
    datePickerText: {
      fontSize: 15,
      color: COLORS.text,
      flex: 1,
      textAlign: "center",
    },
    modalButtonRow: {
      flexDirection: "row",
      gap: 12,
      marginTop: 8,
    },
    modalCancelButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: COLORS.surfaceSecondary,
      borderWidth: 1,
      borderColor: COLORS.border,
      alignItems: "center",
    },
    modalCancelButtonText: {
      fontSize: 15,
      fontWeight: "600",
      color: COLORS.text,
    },
    modalConfirmButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: COLORS.primary,
      alignItems: "center",
    },
    modalConfirmButtonText: {
      fontSize: 15,
      fontWeight: "700",
      color: COLORS.buttonPrimaryText,
    },
  });
