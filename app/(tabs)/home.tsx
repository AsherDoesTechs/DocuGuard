import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { COLORS } from "@/constants";
import { formatShortDate } from "../../utils";
import { DocumentScannerComponent } from "../../components/ui/DocumentScanner";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import {
  getAllDocuments,
  getAllReminders,
  getUserProfile,
  getExpiringDocuments,
  getExpiredDocuments,
  LocalDocument,
  LocalReminder,
  LocalUserProfile,
} from "../../services/localDatabase";

interface DashboardSummary {
  safetyScore: number;
  validDocuments: number;
  expiringDocuments: number;
  expiredDocuments: number;
  totalReminders: number;
}

interface Reminder {
  id: number;
  title: string;
  description: string;
  dueDate: string;
  severity: "info" | "warning" | "urgent";
  read: boolean;
}

export default function HomeScreen() {
  const router = useRouter();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary>({
    safetyScore: 100,
    validDocuments: 0,
    expiringDocuments: 0,
    expiredDocuments: 0,
    totalReminders: 0,
  });
  const [urgentReminders, setUrgentReminders] = useState<Reminder[]>([]);
  const [userName, setUserName] = useState("User");

  const fetchDashboardData = async () => {
    try {
      const [localProfile, localDocs, expiringDocs, expiredDocs, localReminders] =
        await Promise.all([
          getUserProfile(),
          getAllDocuments(),
          getExpiringDocuments(30),
          getExpiredDocuments(),
          getAllReminders(),
        ]);

      if (localProfile) {
        setUserName(localProfile.name);
      }

      const docCount = localDocs.length;
      const expiringCount = expiringDocs.length;
      const expiredCount = expiredDocs.length;
      const validCount = Math.max(0, docCount - expiringCount - expiredCount);

      const score = docCount > 0 ? Math.round((validCount / docCount) * 100) : 100;

      setSummary({
        safetyScore: score,
        validDocuments: validCount,
        expiringDocuments: expiringCount,
        expiredDocuments: expiredCount,
        totalReminders: localReminders.length,
      });

      const urgent = localReminders
        .filter((r) => r.severity === "urgent")
        .slice(0, 2);
      setUrgentReminders(
        urgent.map((r) => ({
          id: r.id || 0,
          title: r.title,
          description: r.description || "",
          dueDate: r.dueDate,
          severity: (r.severity || "info") as "info" | "warning" | "urgent",
          read: r.read,
        })),
      );
    } catch (err: any) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleDataReload = async () => {
    await fetchDashboardData();
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return `Good morning, ${userName}`;
    if (hour < 18) return `Good afternoon, ${userName}`;
    return `Good evening, ${userName}`;
  };

  const getRiskStatus = (score: number) => {
    if (score >= 80) {
      return {
        color: COLORS.success,
        label: "Excellent",
        action: "All documents are up-to-date.",
      };
    }
    if (score >= 50) {
      return {
        color: COLORS.warning,
        label: "Action Needed",
        action: "Renew expiring documents soon.",
      };
    }
    return {
      color: COLORS.danger,
      label: "Critical Risk",
      action: "Immediate renewal required!",
    };
  };

  const status = getRiskStatus(summary.safetyScore);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.title}>Your Dashboard</Text>
          </View>

          {/* Hero Analytics Card */}
          <Card style={styles.heroCard}>
            <View style={styles.scoreContainer}>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreLabel}>Vault Safety Score</Text>
                <Text style={styles.scoreValue}>{summary.safetyScore}%</Text>

                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${summary.safetyScore}%`,
                        backgroundColor: status.color,
                      },
                    ]}
                  />
                </View>

                {/* Dynamic Risk Description */}
                <Text style={[styles.riskDescription, { color: status.color }]}>
                  {status.label}: {status.action}
                </Text>
              </View>

              <Ionicons
                name="shield-checkmark"
                size={48}
                color={status.color}
                style={{ marginLeft: 15 }}
              />
            </View>

            <View style={styles.statsGrid}>
              {/* Valid */}
              <View style={styles.statItem}>
                <Ionicons
                  name="document-text"
                  size={20}
                  color={COLORS.success}
                />
                <Text style={styles.statValue}>{summary.validDocuments}</Text>
                <Text style={styles.statLabel}>Valid</Text>
              </View>

              {/* Expiring */}
              <View style={styles.statItem}>
                <Ionicons name="time" size={20} color={COLORS.warning} />
                <Text style={styles.statValue}>
                  {summary.expiringDocuments}
                </Text>
                <Text style={styles.statLabel}>Expiring</Text>
              </View>

              {/* Expired */}
              <View style={styles.statItem}>
                <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
                <Text style={styles.statValue}>{summary.expiredDocuments}</Text>
                <Text style={styles.statLabel}>Expired</Text>
              </View>

              {/* Reminders */}
              <View style={styles.statItem}>
                <Ionicons
                  name="notifications"
                  size={20}
                  color={COLORS.primary}
                />
                <Text style={styles.statValue}>{summary.totalReminders}</Text>
                <Text style={styles.statLabel}>Reminders</Text>
              </View>
            </View>
          </Card>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionPrimary]}
              onPress={() => router.push("/add-document" as any)}
            >
              <Ionicons name="add" size={24} color="#fff" />
              <Text style={styles.actionButtonText}>Add Document</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.actionSecondary]}
              onPress={() => setScannerOpen(true)}
            >
              <Ionicons name="camera" size={24} color={COLORS.primary} />
              <Text
                style={[styles.actionButtonText, { color: COLORS.primary }]}
              >
                Scan
              </Text>
            </TouchableOpacity>
          </View>

          {/* Detailed Metric Cards */}
          <View style={styles.statsCards}>
            <Card style={styles.statCard}>
              <View style={styles.statCardContent}>
                <View>
                  <Text style={styles.statCardLabel}>Valid Docs</Text>
                  <Text style={styles.statCardValue}>
                    {summary.validDocuments}
                  </Text>
                </View>
                <Ionicons
                  name="checkmark-circle"
                  size={32}
                  color={COLORS.success}
                />
              </View>
            </Card>
            <Card style={styles.statCard}>
              <View style={styles.statCardContent}>
                <View>
                  <Text style={styles.statCardLabel}>Action Needed</Text>
                  <Text style={styles.statCardValue}>
                    {summary.expiringDocuments + summary.expiredDocuments}
                  </Text>
                </View>
                <Ionicons
                  name="alert-circle"
                  size={32}
                  color={COLORS.warning}
                />
              </View>
            </Card>
          </View>

          {/* Urgent Reminders Section */}
          {urgentReminders.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Action Required</Text>
              <Text style={styles.sectionSubtitle}>Urgent reminders</Text>
              {urgentReminders.map((reminder) => (
                <Card key={reminder.id} style={styles.reminderItem}>
                  <View style={styles.reminderContent}>
                    <View style={styles.reminderIcon}>
                      <Ionicons
                        name="alert-circle"
                        size={24}
                        color={
                          reminder.severity === "urgent"
                            ? COLORS.danger
                            : COLORS.warning
                        }
                      />
                    </View>
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
                </Card>
              ))}
            </View>
          )}
        </ScrollView>
      </RefreshableContainer>

      <DocumentScannerComponent
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={(data: {
          uri: string;
          width: number;
          height: number;
        }) => {
          console.log("Captured image:", data.uri);
          setScannerOpen(false);
          router.push({
            pathname: "/add-document" as any,
            params: { scannedImageUri: data.uri },
          });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: 24 },
  greeting: { fontSize: 16, color: COLORS.textSecondary, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  heroCard: { marginBottom: 20, backgroundColor: "#f0f4ff" },
  scoreContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  riskDescription: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: "#E5E7EB",
    borderRadius: 4,
    marginTop: 8,
    marginRight: 10,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  scoreLabel: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 4 },
  scoreValue: { fontSize: 36, fontWeight: "700", color: COLORS.primary },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  statItem: { width: "23%", alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  quickActions: { flexDirection: "row", gap: 12, marginBottom: 20 },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  actionPrimary: { backgroundColor: COLORS.primary },
  actionSecondary: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionButtonText: { fontWeight: "600", color: "#fff", fontSize: 14 },
  statsCards: { flexDirection: "row", gap: 12, marginBottom: 24 },
  statCard: { flex: 1 },
  statCardContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statCardLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 },
  statCardValue: { fontSize: 24, fontWeight: "700", color: COLORS.text },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  reminderItem: { marginBottom: 12 },
  reminderContent: { flexDirection: "row", alignItems: "center" },
  reminderIcon: { marginRight: 12 },
  reminderInfo: { flex: 1 },
  reminderTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  reminderDesc: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  reminderDate: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
});
