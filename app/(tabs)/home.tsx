import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { MOCK_DOCUMENTS, MOCK_REMINDERS, COLORS } from "@/constants";
import { calculateDashboardSummary, formatShortDate } from "../../utils";
import { DocumentScannerComponent } from "../../components/ui/DocumentScanner";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";

export default function HomeScreen() {
  const router = useRouter();
  const [scannerOpen, setScannerOpen] = useState(false);

  const handleDataReload = async () => {
    console.log("Refreshing data...");
    // Add your fetch logic
  };

  const summary = calculateDashboardSummary();
  const recentDocs = MOCK_DOCUMENTS.slice(0, 3);
  const urgentReminders = MOCK_REMINDERS.filter(
    (r) => r.severity === "urgent",
  ).slice(0, 2);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning, John";
    if (hour < 18) return "Good afternoon, John";
    return "Good evening, John";
  };

  const handleDocumentPress = (id: string) => {
    router.push(`/document-details/${id}`);
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
      label: "Critical",
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
        >
          <View style={styles.header}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.title}>Your Dashboard</Text>
          </View>

          {/* Hero Card */}
          <Card style={styles.heroCard}>
            <View style={styles.scoreContainer}>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreLabel}>Safety Score</Text>
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
                <Text style={styles.statValue}>{MOCK_REMINDERS.length}</Text>
                <Text style={styles.statLabel}>Reminders</Text>
              </View>
            </View>
          </Card>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionPrimary]}
              onPress={() => router.push("/add-document")}
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

          {/* Stats Cards */}
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

          {/* Recent Documents */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Documents</Text>
              <TouchableOpacity
                onPress={() => router.push("/(tabs)/documents")}
              >
                <Text style={styles.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>
            {recentDocs.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.docItem}
                onPress={() => handleDocumentPress(doc.id)}
              >
                <View style={styles.docContent}>
                  <View style={styles.docInfo}>
                    <Text style={styles.docTitle}>{doc.title}</Text>
                    <Text style={styles.docIssuer}>{doc.issuer}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          doc.status === "valid"
                            ? `${COLORS.success}20`
                            : doc.status === "expiring"
                              ? `${COLORS.warning}20`
                              : `${COLORS.danger}20`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        {
                          color:
                            doc.status === "valid"
                              ? COLORS.success
                              : doc.status === "expiring"
                                ? COLORS.warning
                                : COLORS.danger,
                        },
                      ]}
                    >
                      {doc.status === "valid"
                        ? "Valid"
                        : doc.status === "expiring"
                          ? "Expiring Soon"
                          : "Expired"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.docMeta}>ID: {doc.documentNumber}</Text>
                <View style={styles.docFooter}>
                  <Ionicons
                    name="calendar"
                    size={16}
                    color={COLORS.textSecondary}
                  />
                  <Text style={styles.docDate}>
                    Expires {formatShortDate(doc.expiryDate)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Urgent Reminders */}
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
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  viewAll: { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
  docItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  docContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  docInfo: { flex: 1, marginRight: 12 },
  docTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  docIssuer: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: "600" },
  docMeta: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  docFooter: { flexDirection: "row", alignItems: "center", gap: 6 },
  docDate: { fontSize: 12, color: COLORS.textSecondary },
  reminderItem: { marginBottom: 12 },
  reminderContent: { flexDirection: "row", alignItems: "center" },
  reminderIcon: { marginRight: 12 },
  reminderInfo: { flex: 1 },
  reminderTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  reminderDesc: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  reminderDate: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
});
