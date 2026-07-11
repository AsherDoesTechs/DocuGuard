import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { MOCK_REMINDERS, COLORS } from "@/constants";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";

type FilterType = "all" | "unread" | "urgent";

export default function RemindersScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const filtered = MOCK_REMINDERS.filter((r) => {
    if (filter === "unread") return !r.read;
    if (filter === "urgent") return r.severity === "urgent";
    return true;
  });
  const unreadCount = MOCK_REMINDERS.filter((r) => !r.read).length;

  const handleDataReload = async () => {
    console.log("Refreshing data...");
    // Add your fetch logic
  };

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
                  onValueChange={setNotificationsEnabled}
                  trackColor={{ false: "#ccc", true: COLORS.primary }}
                />
                <TouchableOpacity
                  onPress={() => setNotificationsEnabled(!notificationsEnabled)}
                >
                  <Ionicons
                    name={
                      notificationsEnabled
                        ? "notifications"
                        : "notifications-off"
                    }
                    size={24}
                    color={
                      notificationsEnabled
                        ? COLORS.primary
                        : COLORS.textSecondary
                    }
                  />
                </TouchableOpacity>
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
                      <Text style={styles.reminderTitle}>{reminder.title}</Text>
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
    gap: 12, // Adds space between Switch and Icon
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
});
