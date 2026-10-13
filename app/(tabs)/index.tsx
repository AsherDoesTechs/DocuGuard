import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { COLORS, Spacing, BORDER_RADIUS } from "@/constants";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import {
  getAllDocuments,
  getAllReminders,
  getUserProfile,
  getExpiringDocuments,
  getExpiredDocuments,
  getStatistics,
  LocalDocument,
} from "../../services/localDatabase";
import type { DocumentStatistics } from "../../services/localDatabase";
import { feedbackService, useFeedbackService } from "../../services/feedbackService";

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
  useFeedbackService();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary>({
    safetyScore: 0,
    validDocuments: 0,
    expiringDocuments: 0,
    expiredDocuments: 0,
    totalReminders: 0,
  });
  const [recentDocs, setRecentDocs] = useState<LocalDocument[]>([]);
  const [expiringDocs, setExpiringDocs] = useState<LocalDocument[]>([]);
  const [urgentReminders, setUrgentReminders] = useState<Reminder[]>([]);
  const [statistics, setStatistics] = useState<DocumentStatistics | null>(null);
  const [userName, setUserName] = useState("User");

  const fetchDashboardData = async () => {
    try {
      const [
        localProfile,
        localDocs,
        expiringList,
        expiredDocs,
        localReminders,
        stats,
      ] = await Promise.all([
        getUserProfile(),
        getAllDocuments(),
        getExpiringDocuments(30),
        getExpiredDocuments(),
        getAllReminders(),
        getStatistics(),
      ]);

      if (localProfile) {
        setUserName(localProfile.name);
      }

      // Sort recent documents explicitly by creation time or ID (newest first)
      const sortedRecent = [...localDocs]
        .sort((a, b) => {
          const aTime = new Date((a as any).createdAt || 0).getTime();
          const bTime = new Date((b as any).createdAt || 0).getTime();
          if (aTime !== bTime) return bTime - aTime;
          return (b.id || 0) - (a.id || 0);
        })
        .slice(0, 5);

      setRecentDocs(sortedRecent);
      setExpiringDocs(expiringList.slice(0, 3));
      setStatistics(stats);

      const docCount = localDocs.length;
      const expiringCount = expiringList.length;
      const expiredCount = expiredDocs.length;
      const validCount = Math.max(0, docCount - expiringCount - expiredCount);

      const score =
        docCount === 0 ? 0 : Math.round((validCount / docCount) * 100);

      setSummary({
        safetyScore: score,
        validDocuments: validCount,
        expiringDocuments: expiringCount,
        expiredDocuments: expiredCount,
        totalReminders: localReminders.length,
      });

      const urgent = localReminders
        .filter((r) => r.severity === "urgent" && r.id != null)
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
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleDataReload = async () => {
    try {
      await fetchDashboardData();
      feedbackService.success("Dashboard updated");
    } catch {
      feedbackService.error("Could not refresh dashboard");
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return `Good morning, ${userName}`;
    if (hour < 18) return `Good afternoon, ${userName}`;
    return `Good evening, ${userName}`;
  };

  const getRiskStatus = (score: number) => {
    if (summary.expiredDocuments > 0) {
      return {
        color: COLORS.danger,
        label: "Attention Required",
        action: `${summary.expiredDocuments} document${summary.expiredDocuments !== 1 ? "s" : ""} expired.`,
      };
    }
    if (summary.expiringDocuments > 0) {
      return {
        color: COLORS.warning,
        label: "Upcoming Expirations",
        action: `${summary.expiringDocuments} document${summary.expiringDocuments !== 1 ? "s" : ""} expiring soon.`,
      };
    }
    if (summary.validDocuments > 0 && score >= 80) {
      return {
        color: COLORS.success,
        label: "Up to Date",
        action: "No documents currently need attention.",
      };
    }
    return {
      color: COLORS.primary,
      label: "Vault Empty",
      action: "Add your first document to start tracking.",
    };
  };

  const status = getRiskStatus(summary.safetyScore);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        <View style={styles.container}>
          {loading && (
            <View style={styles.loadingBanner}>
              <Ionicons name="refresh-outline" size={16} color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading your vault...</Text>
            </View>
          )}
          <View style={styles.header}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.title}>Your Dashboard</Text>
          </View>

          {/* Hero Analytics Card */}
          <Card style={styles.heroCard}>
            <View style={styles.scoreContainer}>
              <View style={styles.scoreRow}>
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

                <Text style={[styles.riskDescription, { color: status.color }]}>
                  {status.label}: {status.action}
                </Text>
              </View>

              <Ionicons
                name="shield-checkmark"
                size={48}
                color={status.color}
              />
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Ionicons
                  name="document-text"
                  size={20}
                  color={COLORS.success}
                />
                <Text style={styles.statValue}>{summary.validDocuments}</Text>
                <Text style={styles.statLabel}>Valid</Text>
              </View>

              <View style={styles.statItem}>
                <Ionicons name="time" size={20} color={COLORS.warning} />
                <Text style={styles.statValue}>
                  {summary.expiringDocuments}
                </Text>
                <Text style={styles.statLabel}>Expiring</Text>
              </View>

              <View style={styles.statItem}>
                <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
                <Text style={styles.statValue}>{summary.expiredDocuments}</Text>
                <Text style={styles.statLabel}>Expired</Text>
              </View>

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

          {/* Quick Actions Grid */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActionsGrid}>
              <TouchableOpacity
                style={styles.quickAction}
                onPress={() => router.push("/add-document" as any)}
              >
                <View
                  style={[
                    styles.quickActionIcon,
                    { backgroundColor: COLORS.primaryLight },
                  ]}
                >
                  <Ionicons
                    name="scan-outline"
                    size={22}
                    color={COLORS.primary}
                  />
                </View>
                <Text style={styles.quickActionText}>Scan Document</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickAction}
                onPress={() => router.push("/add-document" as any)}
              >
                <View
                  style={[
                    styles.quickActionIcon,
                    { backgroundColor: COLORS.successLight },
                  ]}
                >
                  <Ionicons
                    name="cloud-upload-outline"
                    size={22}
                    color={COLORS.success}
                  />
                </View>
                <Text style={styles.quickActionText}>Upload File</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickAction}
                onPress={() => router.push("/(tabs)/documents" as any)}
              >
                <View
                  style={[
                    styles.quickActionIcon,
                    { backgroundColor: COLORS.warningLight },
                  ]}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={22}
                    color={COLORS.warning}
                  />
                </View>
                <Text style={styles.quickActionText}>Documents</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickAction}
                onPress={() => router.push("/(tabs)/reminders" as any)}
              >
                <View
                  style={[
                    styles.quickActionIcon,
                    { backgroundColor: COLORS.dangerLight },
                  ]}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={22}
                    color={COLORS.danger}
                  />
                </View>
                <Text style={styles.quickActionText}>Reminders</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Expiring Soon Section */}
          {expiringDocs.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>Expiring Soon</Text>
                  <Text style={styles.sectionSubtitle}>
                    Requires upcoming renewal
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push("/(tabs)/documents" as any)}
                >
                  <Text style={styles.seeAllText}>View All</Text>
                </TouchableOpacity>
              </View>

              {expiringDocs.map((doc) => (
                <TouchableOpacity
                  key={doc.id || doc.documentNumber}
                  onPress={() =>
                    router.push(`/document-details/${doc.id}` as any)
                  }
                >
                  <Card style={styles.docCard}>
                    <View style={styles.docRow}>
                      <View
                        style={[
                          styles.docImage,
                          styles.docImagePlaceholder,
                          { backgroundColor: COLORS.warningLight },
                        ]}
                      >
                        <Ionicons
                          name="time-outline"
                          size={24}
                          color={COLORS.warning}
                        />
                      </View>
                      <View style={styles.docInfo}>
                        <Text style={styles.docTitle} numberOfLines={1}>
                          {doc.title || "Untitled Document"}
                        </Text>
                        <Text style={styles.docSubtitle} numberOfLines={1}>
                          Issuer: {doc.issuer || "Unknown"}
                        </Text>
                        <Text
                          style={[styles.docDate, { color: COLORS.warning }]}
                        >
                          Expires:{" "}
                          {doc.expiryDate
                            ? formatShortDate(doc.expiryDate)
                            : "N/A"}
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={COLORS.textSecondary}
                      />
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Recent Documents Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Recent Documents</Text>
              <TouchableOpacity
                onPress={() => router.push("/(tabs)/documents" as any)}
              >
                <Text style={styles.seeAllText}>View All</Text>
              </TouchableOpacity>
            </View>

            {recentDocs.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Ionicons
                  name="folder-open-outline"
                  size={36}
                  color={COLORS.textSecondary}
                />
                <Text style={styles.emptyTitle}>
                  Your document vault is empty
                </Text>
                <Text style={styles.emptyText}>
                  Add your first document to start tracking expiration dates,
                  reminders, and document status.
                </Text>
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => router.push("/add-document" as any)}
                >
                  <Text style={styles.emptyButtonText}>
                    Add Your First Document
                  </Text>
                </TouchableOpacity>
              </Card>
            ) : (
              recentDocs.map((doc) => {
                const docImage =
                  (doc as any).imagePath ||
                  (doc as any).filePath ||
                  (doc as any).imageUri;

                return (
                  <TouchableOpacity
                    key={doc.id || doc.documentNumber}
                    onPress={() =>
                      router.push(`/document-details/${doc.id}` as any)
                    }
                  >
                    <Card style={styles.docCard}>
                      <View style={styles.docRow}>
                        {docImage ? (
                          <Image
                            source={{ uri: docImage }}
                            style={styles.docImage}
                          />
                        ) : (
                          <View
                            style={[
                              styles.docImage,
                              styles.docImagePlaceholder,
                            ]}
                          >
                            <Ionicons
                              name="document-text"
                              size={24}
                              color={COLORS.primary}
                            />
                          </View>
                        )}

                        <View style={styles.docInfo}>
                          <Text style={styles.docTitle} numberOfLines={1}>
                            {doc.title || "Untitled Document"}
                          </Text>
                          <Text style={styles.docSubtitle} numberOfLines={1}>
                            Issuer: {doc.issuer || "Unknown"}
                          </Text>
                          <Text style={styles.docDate}>
                            Expires:{" "}
                            {doc.expiryDate
                              ? formatShortDate(doc.expiryDate)
                              : "N/A"}
                          </Text>
                        </View>

                        <Ionicons
                          name="chevron-forward"
                          size={20}
                          color={COLORS.textSecondary}
                        />
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* Urgent Reminders Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={styles.sectionTitle}>Action Required</Text>
                <Text style={styles.sectionSubtitle}>Urgent reminders</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push("/(tabs)/reminders" as any)}
              >
                <Text style={styles.seeAllText}>View All</Text>
              </TouchableOpacity>
            </View>

            {urgentReminders.length === 0 ? (
              <Card style={styles.emptyRemindersCard}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={24}
                  color={COLORS.success}
                />
                <Text style={styles.emptyRemindersText}>
                  No urgent actions pending.
                </Text>
              </Card>
            ) : (
              urgentReminders.map((reminder) => (
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
              ))
            )}
          </View>

          {/* Statistics Section */}
          {statistics && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Statistics</Text>
              <View style={styles.statsCards}>
                <Card style={styles.statCard}>
                  <View style={styles.statCardRow}>
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                    <Text style={styles.statCardLabel}>Valid</Text>
                  </View>
                  <Text style={styles.statCardValue}>{statistics.validDocuments}</Text>
                </Card>
                <Card style={styles.statCard}>
                  <View style={styles.statCardRow}>
                    <Ionicons name="time" size={20} color={COLORS.warning} />
                    <Text style={styles.statCardLabel}>Expiring</Text>
                  </View>
                  <Text style={styles.statCardValue}>{statistics.expiringDocuments}</Text>
                </Card>
                <Card style={styles.statCard}>
                  <View style={styles.statCardRow}>
                    <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
                    <Text style={styles.statCardLabel}>Expired</Text>
                  </View>
                  <Text style={styles.statCardValue}>{statistics.expiredDocuments}</Text>
                </Card>
              </View>

              {Object.keys(statistics.byCategory).length > 0 && (
                <View style={styles.categoryStats}>
                  <Text style={styles.categoryStatsTitle}>By Category</Text>
                  {Object.entries(statistics.byCategory).map(([cat, count]) => (
                    <View key={cat} style={styles.categoryStatRow}>
                      <Text style={styles.categoryStatName}>{cat}</Text>
                      <Text style={styles.categoryStatCount}>{count as number}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Sync Status Footer Indicator */}
          <View style={styles.syncFooter}>
            <Ionicons
              name={summary.expiringDocuments + summary.expiredDocuments > 0 ? "warning-outline" : "cloud-done-outline"}
              size={16}
              color={summary.expiringDocuments + summary.expiredDocuments > 0 ? COLORS.warning : COLORS.success}
            />
            <Text style={styles.syncFooterText}>
              {summary.expiredDocuments > 0
                ? `${summary.expiredDocuments} document${summary.expiredDocuments !== 1 ? "s" : ""} expired`
                : summary.expiringDocuments > 0
                  ? `${summary.expiringDocuments} document${summary.expiringDocuments !== 1 ? "s" : ""} expiring soon`
                  : "All documents up to date"}
            </Text>
          </View>
        </View>
      </RefreshableContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  loadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primaryLight,
  },
  loadingText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "600",
  },
  content: { padding: Spacing.md, paddingBottom: 80 },
  header: { marginBottom: 24 },
  greeting: { fontSize: 16, color: COLORS.textSecondary, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  heroCard: { marginBottom: 20, backgroundColor: COLORS.primaryLight },
  scoreContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  scoreRow: {
    flex: 1,
    gap: Spacing.sm,
  },
  riskDescription: { fontSize: 12, fontWeight: "600", marginTop: 6 },
  progressBarTrack: {
    height: 8,
    backgroundColor: COLORS.progressBackground,
    borderRadius: 4,
    marginTop: 8,
    overflow: "hidden",
  },
  progressBarFill: { height: "100%", borderRadius: 4 },
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
  section: { marginBottom: 24 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  seeAllText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
  quickActionsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  quickAction: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 16,
    borderRadius: BORDER_RADIUS.md,
    alignItems: "center",
    gap: Spacing.sm,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
  },
  emptyCard: { alignItems: "center", padding: 24, gap: Spacing.sm },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: "center",
  },
  emptyButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: BORDER_RADIUS.sm,
    marginTop: 8,
  },
  emptyButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  statsCards: { flexDirection: "row", gap: Spacing.md },
  statCard: { flex: 1, alignItems: "center", padding: Spacing.md },
  statCardRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  statCardLabel: { fontSize: 12, color: COLORS.textSecondary },
  statCardValue: { fontSize: 22, fontWeight: "700", color: COLORS.text },
  categoryStats: { marginTop: 12, gap: 6 },
  categoryStatsTitle: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 4 },
  categoryStatRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  categoryStatName: { fontSize: 13, color: COLORS.textSecondary },
  categoryStatCount: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  docCard: { marginBottom: 10, padding: 12 },
  docRow: { flexDirection: "row", alignItems: "center" },
  docImage: { width: 50, height: 50, borderRadius: BORDER_RADIUS.sm, marginRight: 12 },
  docImagePlaceholder: {
    backgroundColor: COLORS.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  docInfo: { flex: 1, justifyContent: "center" },
  docTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 2,
  },
  docSubtitle: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 2 },
  docDate: { fontSize: 11, color: COLORS.textMuted },
  reminderItem: { marginBottom: 12 },
  reminderContent: { flexDirection: "row", alignItems: "center" },
  reminderIcon: { marginRight: 12 },
  reminderInfo: { flex: 1 },
  reminderTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  reminderDesc: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  reminderDate: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  emptyRemindersCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  emptyRemindersText: { color: COLORS.textSecondary, fontSize: 14 },
  syncFooter: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 16,
  },
  syncFooterText: { fontSize: 12, color: COLORS.textSecondary },
});
