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
import { Card } from "../../components/ui";
import { COLORS } from "@/constants";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import * as SecureStore from "expo-secure-store";
import { getAllReminders, LocalReminder } from "../../services/localDatabase";
import { checkAndScheduleAlerts } from "../../services/notificationScheduler";

type FilterType = "all" | "unread" | "expired" | "expiring";

interface Reminder {
  id: number;
  title: string;
  description: string;
  dueDate: string;
  severity: "Expired" | "Expiring Soon" | "Valid";
  read: boolean;
}

export default function RemindersScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const mountedRef = useRef(true);

  const fetchReminders = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const localReminders = await getAllReminders();
      const mappedReminders: Reminder[] = localReminders.map((r) => ({
        id: r.id || 0,
        title: r.title,
        description: r.description || "",
        dueDate: r.dueDate,
        severity: (r.severity || "Valid") as "Expired" | "Expiring Soon" | "Valid",
        read: r.read,
      }));
      if (mountedRef.current) {
        setReminders(mappedReminders);
        setLastFetch(Date.now());
      }
    } catch (err: any) {
      console.error("Failed to load reminders:", err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchReminders();

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        fetchReminders();
        checkAndScheduleAlerts().catch(console.warn);
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [fetchReminders]);

  const handleToggleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);
    await SecureStore.setItemAsync("notificationsEnabled", String(value));
    if (value) {
      await checkAndScheduleAlerts();
    }
  };

  const handleDataReload = async () => {
    await fetchReminders();
    await checkAndScheduleAlerts();
  };

  const filtered = reminders.filter((r) => {
    if (filter === "unread") return !r.read;
    if (filter === "expired") return r.severity === "Expired";
    if (filter === "expiring") return r.severity === "Expiring Soon";
    return true;
  });

  const unreadCount = reminders.filter((r) => !r.read).length;

  const getSeverityIcon = (s: string) =>
    s === "Expired" ? "alert-circle" : s === "Expiring Soon" ? "warning" : "checkmark-circle";
  const getSeverityColor = (s: string) =>
    s === "Expired" ? COLORS.danger : s === "Expiring Soon" ? COLORS.warning : COLORS.success;
  const getSeverityLabel = (s: string) =>
    s === "Expired" ? "Expired" : s === "Expiring Soon" ? "Expiring Soon" : "Valid";

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
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                />
                <Ionicons
                  name={notificationsEnabled ? "notifications" : "notifications-off"}
                  size={24}
                  color={notificationsEnabled ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
            </View>
            <View style={styles.lastUpdated}>
              <Ionicons name="refresh" size={12} color={COLORS.textSecondary} />
              <Text style={styles.lastUpdatedText}>Last updated: {formatLastUpdated(lastFetch)}</Text>
            </View>
          </View>

          <View style={styles.filterTabs}>
            {(["all", "unread", "expired", "expiring"] as FilterType[]).map((tab) => (
              <TouchableOpacity key={tab} onPress={() => setFilter(tab)} style={[styles.filterTab, filter === tab && styles.filterTabActive]}>
                <Text style={[styles.filterTabText, filter === tab && styles.filterTabTextActive]}>
                  {tab === "all" ? "All" : tab === "unread" ? `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}` : tab === "expired" ? "Expired" : "Expiring Soon"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading reminders...</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="notifications-off" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>No reminders found.</Text>
              <Text style={styles.emptySubtext}>Pull to refresh or check back later</Text>
            </View>
          ) : (
            <View style={styles.remindersList}>
              {filtered.map((reminder) => (
                <Card key={reminder.id} style={styles.reminderCard}>
                  <View style={[styles.reminderBorder, { borderLeftColor: getSeverityColor(reminder.severity) }]}>
                    <View style={styles.reminderContent}>
                      <Ionicons name={getSeverityIcon(reminder.severity) as any} size={24} color={getSeverityColor(reminder.severity)} style={styles.reminderIcon} />
                      <View style={styles.reminderInfo}>
                        <Text style={styles.reminderTitle}>{reminder.title}</Text>
                        <Text style={styles.reminderDesc}>{reminder.description}</Text>
                        <View style={styles.reminderMeta}>
                          <Text style={styles.reminderDate}>Due: {formatShortDate(reminder.dueDate)}</Text>
                          <View style={styles.severityBadge}>
                            <Ionicons name={getSeverityIcon(reminder.severity) as any} size={12} color={getSeverityColor(reminder.severity)} />
                            <Text style={[styles.severityText, { color: getSeverityColor(reminder.severity) }]}>{getSeverityLabel(reminder.severity)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </ScrollView>
      </RefreshableContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 24, paddingBottom: 100 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  notificationControls: { flexDirection: "row", alignItems: "center", gap: 12 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  lastUpdated: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  lastUpdatedText: { fontSize: 12, color: COLORS.textSecondary },
  filterTabs: { flexDirection: "row", gap: 8, marginBottom: 20 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  filterTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterTabText: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  filterTabTextActive: { color: "#fff" },
  remindersList: { gap: 12 },
  reminderCard: { padding: 0, overflow: "hidden" },
  reminderBorder: { borderLeftWidth: 4, padding: 16 },
  reminderContent: { flexDirection: "row", alignItems: "flex-start" },
  reminderIcon: { marginRight: 12, marginTop: 2 },
  reminderInfo: { flex: 1 },
  reminderTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  reminderDesc: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  reminderMeta: { marginTop: 8, gap: 8 },
  reminderDate: { fontSize: 12, color: COLORS.textSecondary },
  severityBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: "#f3f4f6" },
  severityText: { fontSize: 11, fontWeight: "600" },
  loadingContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 12 },
  loadingText: { fontSize: 14, color: COLORS.textSecondary },
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyText: { textAlign: "center", color: COLORS.textSecondary, fontSize: 16 },
  emptySubtext: { textAlign: "center", color: COLORS.textSecondary, fontSize: 13 },
});
