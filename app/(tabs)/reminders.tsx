import { api } from "../../services/api";
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { COLORS } from "@/constants";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import * as SecureStore from "expo-secure-store";
import { getAllReminders, LocalReminder } from "../../services/localDatabase";

type FilterType = "all" | "unread" | "urgent";

interface Reminder {
  id: number;
  title: string;
  description: string;
  dueDate: string;
  severity: "info" | "warning" | "urgent";
  read: boolean;
}

export default function RemindersScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReminders = async () => {
    try {
      const localReminders = await getAllReminders();
      setReminders(
        localReminders.map((r) => ({
          id: r.id || 0,
          title: r.title,
          description: r.description || "",
          dueDate: r.dueDate,
          severity: (r.severity || "info") as "info" | "warning" | "urgent",
          read: r.read,
        })),
      );
    } catch (err: any) {
      console.error("Failed to load reminders:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  const handleToggleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);
    await SecureStore.setItemAsync("notificationsEnabled", String(value));
  };

  const handleDataReload = async () => {
    await fetchReminders();
  };

  const filtered = reminders.filter((r) => {
    if (filter === "unread") return !r.read;
    if (filter === "urgent") return r.severity === "urgent";
    return true;
  });

  const unreadCount = reminders.filter((r) => !r.read).length;

  const getSeverityIcon = (s: string) =>
    s === "urgent"
      ? "alert-circle"
      : s === "warning"
        ? "warning"
        : "information-circle";

  const getSeverityColor = (s: string) =>
    s === "urgent"
      ? COLORS.danger
      : s === "warning"
        ? COLORS.warning
        : COLORS.primary;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>Reminders</Text>
                <Text style={styles.subtitle}>{unreadCount} unread</Text>
              </View>

              {/* Notification Controls */}
              <View style={styles.notificationControls}>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={handleToggleNotifications}
                  trackColor={{ false: "#ccc", true: COLORS.primary }}
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
          </View>

          <View style={styles.filterTabs}>
            {(["all", "unread", "urgent"] as FilterType[]).map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => setFilter(tab)}
                style={[
                  styles.filterTab,
                  filter === tab && styles.filterTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    filter === tab && styles.filterTabTextActive,
                  ]}
                >
                  {tab === "all"
                    ? "All"
                    : tab === "unread"
                      ? `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`
                      : "Urgent"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <ActivityIndicator
              size="large"
              color={COLORS.primary}
              style={{ marginTop: 40 }}
            />
          ) : filtered.length === 0 ? (
            <Text style={styles.emptyText}>No reminders found.</Text>
          ) : (
            <View style={styles.remindersList}>
              {filtered.map((reminder) => (
                <Card key={reminder.id} style={styles.reminderCard}>
                  <View
                    style={[
                      styles.reminderBorder,
                      { borderLeftColor: getSeverityColor(reminder.severity) },
                    ]}
                  >
                    <View style={styles.reminderContent}>
                      <Ionicons
                        name={getSeverityIcon(reminder.severity) as any}
                        size={24}
                        color={getSeverityColor(reminder.severity)}
                        style={styles.reminderIcon}
                      />
                      <View style={styles.reminderInfo}>
                        <Text style={styles.reminderTitle}>
                          {reminder.title}
                        </Text>
                        <Text style={styles.reminderDesc}>
                          {reminder.description}
                        </Text>
                        <Text style={styles.reminderDate}>
                          Due: {formatShortDate(reminder.dueDate)}
                        </Text>
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
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  filterTabs: { flexDirection: "row", gap: 8, marginBottom: 20 },
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
  reminderDate: { fontSize: 12, color: COLORS.textSecondary, marginTop: 8 },
  emptyText: {
    textAlign: "center",
    color: COLORS.textSecondary,
    marginTop: 40,
  },
});
