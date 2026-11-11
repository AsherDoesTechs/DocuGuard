import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  DeviceEventEmitter,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { COLORS as BASE_COLORS, Spacing, BORDER_RADIUS } from "@/constants";
import { useTheme } from "@/context/ThemeContext";
import { HomeSkeleton } from "@/components/ui/Skeleton";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import {
  getAllDocuments,
  getAllReminders,
  getUserProfile,
  getExpiringDocuments,
  getExpiredDocuments,
  saveUserProfile,
  LocalDocument,
} from "../../services/localDatabase";
import { syncDocumentRemindersToDb } from "../../services/notificationScheduler";
import {
  feedbackService,
  useFeedbackService,
} from "@/services/feedbackService";
import { api } from "@/services/api";

interface DashboardSummary {
  safetyScore: number;
  validDocuments: number;
  expiringDocuments: number;
  expiredDocuments: number;
  totalReminders: number;
}

interface Reminder {
  id: number;
  documentId?: number | string;
  title: string;
  description: string;
  dueDate: string;
  severity: "info" | "warning" | "urgent";
  read: boolean;
}

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  useFeedbackService();

  // Apply the active global theme to the existing app colors.
  const COLORS = useMemo(
    () =>
      ({
        ...BASE_COLORS,
        background: colors.background,
        surface: colors.surface,
        primary: colors.primary,
        primaryDark: colors.primaryDark,
        primaryLight: colors.primaryLight,
        text: colors.text,
        textSecondary: colors.textSecondary,
        textMuted: colors.textMuted,
        success: colors.success,
        warning: colors.warning,
        warningLight: colors.warningLight,
        danger: colors.error,
        progressBackground: colors.progressBackground,
        border: colors.border,
        secondary: colors.primaryDark,
      }) as typeof BASE_COLORS,
    [colors],
  );

  const styles = useMemo(() => createStyles(COLORS), [COLORS]);

  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<DashboardSummary>({
    safetyScore: 0,
    validDocuments: 0,
    expiringDocuments: 0,
    expiredDocuments: 0,
    totalReminders: 0,
  });

  const [recentDocs, setRecentDocs] = useState<LocalDocument[]>([]);
  const [recentPreviewUris, setRecentPreviewUris] = useState<
    Record<string, string | null>
  >({});
  const [expiringDocs, setExpiringDocs] = useState<LocalDocument[]>([]);
  const [urgentReminders, setUrgentReminders] = useState<Reminder[]>([]);
  const [userName, setUserName] = useState("User");

  const getRecentDocKey = useCallback(
    (doc: LocalDocument, index: number) =>
      String(doc.id ?? doc.cloudId ?? doc.documentNumber ?? `recent-${index}`),
    [],
  );

  const isImageDocument = useCallback(
    (doc: LocalDocument, uri?: string | null) => {
      const fileType = String(
        (doc as any).fileType || (doc as any).file_type || "",
      ).toLowerCase();
      if (fileType.includes("image")) return true;
      const candidate = String(
        uri || (doc as any).fileUrl || (doc as any).file_url || "",
      );
      return /\.(jpg|jpeg|png|webp|heic|heif)(\?|$)/i.test(candidate);
    },
    [],
  );

  const resolveRecentPreviewUri = useCallback(
    async (doc: LocalDocument): Promise<string | null> => {
      const rawImage =
        (doc as any).thumbnailUri ||
        (doc as any).thumbnailPath ||
        (doc as any).imageUri ||
        (doc as any).imagePath ||
        (doc as any).fileUrl ||
        (doc as any).file_url ||
        (doc as any).filePath ||
        (doc as any).uri;

      if (typeof rawImage === "string" && rawImage.trim()) {
        const trimmed = rawImage.trim();
        if (
          trimmed.startsWith("file://") ||
          trimmed.startsWith("content://") ||
          trimmed.startsWith("data:")
        ) {
          return trimmed;
        }
        if (/^https?:\/\//i.test(trimmed)) {
          return trimmed;
        }
        return `file://${trimmed}`;
      }

      if (!isImageDocument(doc, null)) return null;

      const remoteId = doc.cloudId ?? doc.id;
      if (!remoteId) return null;

      try {
        const res = await api.client.get(`/documents/${remoteId}/file-url`);
        const url = res?.data?.fileUrl || res?.data?.file_url;
        return typeof url === "string" && url.trim() ? url.trim() : null;
      } catch {
        return null;
      }
    },
    [isImageDocument],
  );

  const fetchDashboardData = useCallback(async () => {
    try {
      await syncDocumentRemindersToDb();

      const [localProfile, localDocs, localReminders] = await Promise.all([
        getUserProfile(),
        getAllDocuments(),
        getAllReminders(),
      ]);

      if (localProfile?.name?.trim()) {
        setUserName(localProfile.name.trim());
      }

      // 1. Exclude deleted/draft documents
      const activeDocs = localDocs.filter(
        (doc: any) =>
          doc.status !== "deleted" && doc.processingStatus !== "failed",
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(today.getDate() + 30);
      thirtyDaysFromNow.setHours(23, 59, 59, 999);

      let expiredCount = 0;
      let expiringCount = 0;
      let validCount = 0;

      // 2. Tally states accurately by checking every active document's expiryDate
      activeDocs.forEach((doc: any) => {
        if (!doc.expiryDate) {
          // Documents without an expiration date are considered Valid
          validCount++;
          return;
        }

        const expDate = new Date(doc.expiryDate);
        if (isNaN(expDate.getTime())) {
          validCount++;
          return;
        }

        expDate.setHours(0, 0, 0, 0);

        if (expDate < today) {
          expiredCount++;
        } else if (expDate >= today && expDate <= thirtyDaysFromNow) {
          expiringCount++;
        } else {
          validCount++;
        }
      });

      const totalActiveDocs = activeDocs.length;
      const score =
        totalActiveDocs === 0
          ? 100
          : Math.round((validCount / totalActiveDocs) * 100);

      const reminderDocumentIds = new Set<string>();
      const dynamicReminderCount = activeDocs.reduce(
        (count: number, doc: any) => {
          if (!doc.expiryDate) return count;
          const expDate = new Date(doc.expiryDate);
          if (isNaN(expDate.getTime())) return count;
          expDate.setHours(0, 0, 0, 0);
          const daysUntil = Math.round(
            (expDate.getTime() - today.getTime()) / 86400000,
          );
          if (daysUntil < 0 || daysUntil <= 30) {
            if (doc.id != null) reminderDocumentIds.add(String(doc.id));
            return count + 1;
          }
          return count;
        },
        0,
      );

      const customReminderCount = localReminders.reduce(
        (count: number, r: any) => {
          const docId = r.documentId ?? r.document_id;
          if (!docId && r.id != null && r.dueDate) {
            return count + 1;
          }
          return count;
        },
        0,
      );

      // 3. Update summary state
      setSummary({
        safetyScore: score,
        validDocuments: validCount,
        expiringDocuments: expiringCount,
        expiredDocuments: expiredCount,
        totalReminders: dynamicReminderCount + customReminderCount,
      });

      if (!localProfile?.name?.trim()) {
        try {
          const res = await api.profile.getProfile();
          const remoteName =
            typeof res?.name === "string" ? res.name.trim() : "";
          const remoteEmail =
            typeof res?.email === "string"
              ? res.email
              : localProfile?.email || "";
          if (remoteName) {
            setUserName(remoteName);
            await saveUserProfile({
              ...(localProfile || {}),
              name: remoteName,
              email: remoteEmail,
              documentCount: totalActiveDocs,
              expiringCount,
              expiredCount,
              notificationsEnabled: localProfile?.notificationsEnabled ?? true,
              notifyEmail: localProfile?.notifyEmail ?? true,
              notifyExpiry: localProfile?.notifyExpiry ?? true,
              twoFactor: localProfile?.twoFactor ?? false,
              preferencesDirty: localProfile?.preferencesDirty,
            } as any);
          }
        } catch {
          // keep fallback when offline or profile unavailable
        }
      }

      // 4. Update Recent Docs list
      const sortedRecent = [...activeDocs]
        .sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        )
        .slice(0, 3);

      setRecentDocs(sortedRecent);

      // ðŸ”” Directly evaluate active documents to guarantee action items appear for expired or expiring docs
      const dynamicUrgentReminders: Reminder[] = [];

      activeDocs.forEach((doc: any) => {
        if (!doc.expiryDate) return;
        const expDate = new Date(doc.expiryDate);
        if (isNaN(expDate.getTime())) return;
        expDate.setHours(0, 0, 0, 0);

        const daysUntil = Math.round(
          (expDate.getTime() - today.getTime()) / 86400000,
        );

        if (daysUntil < 0) {
          dynamicUrgentReminders.push({
            id: Number(doc.id) || Math.random(),
            documentId: doc.id,
            title: `Expired: ${doc.title || "Document"}`,
            description: `Issued by ${doc.issuer || "Unknown"}. Expired ${Math.abs(daysUntil)} days ago.`,
            dueDate: doc.expiryDate,
            severity: "urgent",
            read: false,
          });
        } else if (daysUntil <= 30) {
          dynamicUrgentReminders.push({
            id: Number(doc.id) || Math.random(),
            documentId: doc.id,
            title: `Expiring Soon: ${doc.title || "Document"}`,
            description: `Issued by ${doc.issuer || "Unknown"}. Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
            dueDate: doc.expiryDate,
            severity: "warning",
            read: false,
          });
        }
      });

      // Also merge any custom text reminders from the database if they are unread/urgent
      localReminders.forEach((r: any) => {
        const severity = String(r.severity || "").toLowerCase();
        if (severity === "urgent" || severity === "expired" || !r.read) {
          dynamicUrgentReminders.push({
            id: r.id || Math.random(),
            documentId: r.documentId || r.document_id,
            title: r.title,
            description: r.description || "",
            dueDate: r.dueDate,
            severity:
              severity === "urgent" || severity === "expired"
                ? "urgent"
                : "warning",
            read: !!r.read,
          });
        }
      });

      setUrgentReminders(dynamicUrgentReminders.slice(0, 3));
    } catch (err: any) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Automatically refresh dashboard widgets and hero scores on focus transition
  useFocusEffect(
    useCallback(() => {
      void fetchDashboardData();
    }, [fetchDashboardData]),
  );

  // Real-time listener for document updates across the app
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "documentVaultChanged",
      () => {
        void fetchDashboardData();
      },
    );
    return () => {
      subscription.remove();
    };
  }, [fetchDashboardData]);

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
        action: `${summary.expiredDocuments} document${
          summary.expiredDocuments !== 1 ? "s" : ""
        } expired.`,
      };
    }

    if (summary.expiringDocuments > 0) {
      return {
        color: COLORS.warning,
        label: "Upcoming Expirations",
        action: `${summary.expiringDocuments} document${
          summary.expiringDocuments !== 1 ? "s" : ""
        } expiring soon.`,
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
          {loading ? (
            <HomeSkeleton />
          ) : (
            <>
              {/* Greeting and dashboard title */}
              <View style={styles.header}>
                <Text style={styles.greeting}>{getGreeting()}</Text>
                <Text style={styles.title}>Your Dashboard</Text>
              </View>

              {/* Vault Safety Score */}
              <Card style={styles.heroCard}>
                <View style={styles.scoreContainer}>
                  <View style={styles.scoreRow}>
                    <Text style={styles.scoreLabel}>Vault Safety Score</Text>

                    <Text style={styles.scoreValue}>
                      {summary.safetyScore}%
                    </Text>

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

                    <Text
                      style={[styles.riskDescription, { color: status.color }]}
                    >
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
                    <Text style={styles.statValue}>
                      {summary.validDocuments}
                    </Text>
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
                    <Ionicons
                      name="alert-circle"
                      size={20}
                      color={COLORS.danger}
                    />
                    <Text style={styles.statValue}>
                      {summary.expiredDocuments}
                    </Text>
                    <Text style={styles.statLabel}>Expired</Text>
                  </View>

                  <View style={styles.statItem}>
                    <Ionicons
                      name="notifications"
                      size={20}
                      color={COLORS.primary}
                    />
                    <Text style={styles.statValue}>
                      {summary.totalReminders}
                    </Text>
                    <Text style={styles.statLabel}>Reminders</Text>
                  </View>
                </View>
              </Card>

              {/* Action Required */}
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View>
                    <Text style={styles.sectionTitle}>Action Required</Text>
                    <Text style={styles.sectionSubtitle}>Urgent reminders</Text>
                  </View>

                  <TouchableOpacity
                    accessibilityRole="button"
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
                  urgentReminders.map((reminder: any) => (
                    <TouchableOpacity
                      key={reminder.id}
                      accessibilityRole="button"
                      onPress={() => {
                        if (reminder.documentId) {
                          router.push(
                            `/document-details/${reminder.documentId}` as any,
                          );
                        } else {
                          router.push("/(tabs)/reminders" as any);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Card style={styles.reminderItem}>
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

                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={COLORS.textSecondary}
                          />
                        </View>
                      </Card>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {/* Recent Documents */}
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent Documents</Text>

                  <TouchableOpacity
                    accessibilityRole="button"
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
                      Add your first document to start tracking expiration
                      dates, reminders, and document status.
                    </Text>

                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.emptyButton}
                      onPress={() => router.push("/add-document" as any)}
                    >
                      <Text style={styles.emptyButtonText}>
                        Add Your First Document
                      </Text>
                    </TouchableOpacity>
                  </Card>
                ) : (
                  recentDocs.map((doc, index) => {
                    const recentKey = getRecentDocKey(doc, index);
                    const rawImage =
                      (doc as any).thumbnailUri ||
                      (doc as any).thumbnailPath ||
                      (doc as any).imageUri ||
                      (doc as any).imagePath ||
                      (doc as any).fileUrl ||
                      (doc as any).file_url ||
                      (doc as any).filePath ||
                      (doc as any).uri;

                    const normalizedLocalImage = rawImage
                      ? rawImage.startsWith("file://") ||
                        rawImage.startsWith("content://") ||
                        rawImage.startsWith("data:")
                        ? rawImage
                        : /^https?:\/\//i.test(rawImage)
                          ? rawImage
                          : `file://${rawImage}`
                      : null;

                    const resolvedPreviewUri =
                      recentPreviewUris[recentKey] ?? normalizedLocalImage;

                    const fileType = String(
                      (doc as any).fileType || (doc as any).file_type || "",
                    ).toLowerCase();
                    const isImagePreview =
                      !!resolvedPreviewUri &&
                      (fileType.includes("image") ||
                        /\.(jpg|jpeg|png|webp|heic|heif)(\?|$)/i.test(
                          resolvedPreviewUri,
                        ));

                    const documentType =
                      (doc as any).documentType ||
                      (doc as any).type ||
                      (doc as any).category ||
                      "Document";

                    const expiryDate = doc.expiryDate
                      ? formatShortDate(doc.expiryDate)
                      : "No expiration date";

                    const isExpired =
                      !!doc.expiryDate &&
                      new Date(doc.expiryDate).getTime() <
                        new Date().setHours(0, 0, 0, 0);

                    const isExpiringSoon =
                      !!doc.expiryDate &&
                      !isExpired &&
                      new Date(doc.expiryDate).getTime() <=
                        Date.now() + 30 * 24 * 60 * 60 * 1000;

                    const status = isExpired
                      ? "Expired"
                      : isExpiringSoon
                        ? "Expiring Soon"
                        : "Valid";

                    const statusColor = isExpired
                      ? COLORS.danger
                      : isExpiringSoon
                        ? COLORS.warning
                        : COLORS.success;

                    return (
                      <TouchableOpacity
                        key={doc.id || doc.documentNumber}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${doc.title || "document"} details`}
                        onPress={() =>
                          router.push(`/document-details/${doc.id}` as any)
                        }
                        activeOpacity={0.85}
                      >
                        <Card style={styles.recentDocumentCard}>
                          <View style={styles.recentDocumentRow}>
                            <View style={styles.recentPreviewFrame}>
                              {isImagePreview ? (
                                <Image
                                  source={{ uri: resolvedPreviewUri as string }}
                                  style={styles.recentPreviewImage}
                                  resizeMode="cover"
                                  onError={() =>
                                    setRecentPreviewUris((prev) => ({
                                      ...prev,
                                      [recentKey]: null,
                                    }))
                                  }
                                />
                              ) : (
                                <View style={styles.recentPreviewFallback}>
                                  <Ionicons
                                    name={
                                      fileType.includes("pdf") ||
                                      /\.pdf(\?|$)/i.test(
                                        resolvedPreviewUri || "",
                                      )
                                        ? "document-text-outline"
                                        : "image-outline"
                                    }
                                    size={30}
                                    color={COLORS.primary}
                                  />
                                  <Text style={styles.previewFallbackText}>
                                    {resolvedPreviewUri ? "File" : "Preview"}
                                  </Text>
                                </View>
                              )}
                            </View>

                            <View style={styles.recentDocumentInfo}>
                              <View
                                style={[
                                  styles.recentStatusBadge,
                                  { backgroundColor: `${statusColor}18` },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.recentStatusDot,
                                    { backgroundColor: statusColor },
                                  ]}
                                />
                                <Text
                                  style={[
                                    styles.recentStatusText,
                                    { color: statusColor },
                                  ]}
                                >
                                  {status}
                                </Text>
                              </View>

                              <Text
                                style={styles.recentDocumentTitle}
                                numberOfLines={2}
                              >
                                {doc.title || "Untitled Document"}
                              </Text>

                              <Text
                                style={styles.recentDocumentType}
                                numberOfLines={1}
                              >
                                {documentType}
                              </Text>

                              <Text
                                style={styles.recentDocumentNumber}
                                numberOfLines={1}
                              >
                                No. {doc.documentNumber || "Not provided"}
                              </Text>

                              <View style={styles.recentExpiryRow}>
                                <Ionicons
                                  name="calendar-outline"
                                  size={14}
                                  color={statusColor}
                                />
                                <Text
                                  style={[
                                    styles.recentExpiryText,
                                    { color: statusColor },
                                  ]}
                                  numberOfLines={2}
                                >
                                  {isExpired ? "Expired: " : "Expires: "}
                                  {expiryDate}
                                </Text>
                              </View>
                            </View>

                            <Ionicons
                              name="chevron-forward"
                              size={19}
                              color={COLORS.textSecondary}
                            />
                          </View>
                        </Card>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>

              {/* Sync Status Footer */}
              <View style={styles.syncFooter}>
                <Ionicons
                  name={
                    summary.expiringDocuments + summary.expiredDocuments > 0
                      ? "warning-outline"
                      : "cloud-done-outline"
                  }
                  size={16}
                  color={
                    summary.expiringDocuments + summary.expiredDocuments > 0
                      ? COLORS.warning
                      : COLORS.success
                  }
                />

                <Text style={styles.syncFooterText}>
                  {summary.expiredDocuments > 0
                    ? `${summary.expiredDocuments} document${
                        summary.expiredDocuments !== 1 ? "s" : ""
                      } expired`
                    : summary.expiringDocuments > 0
                      ? `${summary.expiringDocuments} document${
                          summary.expiringDocuments !== 1 ? "s" : ""
                        } expiring soon`
                      : "All documents up to date"}
                </Text>
              </View>
            </>
          )}
        </View>
      </RefreshableContainer>
    </SafeAreaView>
  );
}

const createStyles = (COLORS: typeof BASE_COLORS) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: COLORS.background,
    },

    container: {
      flex: 1,
      backgroundColor: COLORS.background,
    },

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

    content: {
      padding: Spacing.md,
      paddingBottom: 80,
      backgroundColor: COLORS.background,
    },

    header: {
      marginBottom: 24,
    },

    greeting: {
      fontSize: 16,
      color: COLORS.textSecondary,
      marginBottom: 4,
    },

    title: {
      fontSize: 28,
      fontWeight: "700",
      color: COLORS.text,
    },

    heroCard: {
      marginBottom: 20,
      backgroundColor: COLORS.primaryLight,
    },

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

    riskDescription: {
      fontSize: 12,
      fontWeight: "600",
      marginTop: 6,
    },

    progressBarTrack: {
      height: 8,
      backgroundColor: COLORS.progressBackground,
      borderRadius: 4,
      marginTop: 8,
      overflow: "hidden",
    },

    progressBarFill: {
      height: "100%",
      borderRadius: 4,
    },

    scoreLabel: {
      fontSize: 14,
      color: COLORS.textSecondary,
      marginBottom: 4,
    },

    scoreValue: {
      fontSize: 36,
      fontWeight: "700",
      color: COLORS.primary,
    },

    statsGrid: {
      flexDirection: "row",
      justifyContent: "space-between",
      flexWrap: "wrap",
    },

    statItem: {
      width: "23%",
      alignItems: "center",
    },

    statValue: {
      fontSize: 18,
      fontWeight: "700",
      color: COLORS.text,
    },

    statLabel: {
      fontSize: 12,
      color: COLORS.textSecondary,
      marginTop: 4,
    },

    section: {
      marginBottom: 24,
    },

    sectionHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },

    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: COLORS.text,
    },

    sectionSubtitle: {
      fontSize: 13,
      color: COLORS.textSecondary,
      marginBottom: 4,
    },

    seeAllText: {
      fontSize: 14,
      fontWeight: "600",
      color: COLORS.primary,
    },

    recentDocumentCard: {
      marginBottom: 12,
      padding: 12,
      backgroundColor: COLORS.surface,
      borderRadius: BORDER_RADIUS.md,
      borderWidth: 1,
      borderColor: COLORS.border,
    },

    recentDocumentRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    recentPreviewFrame: {
      width: 100,
      height: 124,
      borderRadius: BORDER_RADIUS.sm,
      overflow: "hidden",
      backgroundColor: COLORS.primaryLight,
    },

    recentPreviewImage: {
      width: "100%",
      height: "100%",
    },

    recentPreviewFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: 4,
    },

    previewFallbackText: {
      fontSize: 10,
      color: COLORS.primary,
      fontWeight: "600",
    },

    recentDocumentInfo: {
      flex: 1,
      minWidth: 0,
      gap: 5,
    },

    recentStatusBadge: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 20,
    },

    recentStatusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },

    recentStatusText: {
      fontSize: 10,
      fontWeight: "700",
    },

    recentDocumentTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: COLORS.text,
    },

    recentDocumentType: {
      fontSize: 12,
      color: COLORS.textSecondary,
    },

    recentDocumentNumber: {
      fontSize: 12,
      color: COLORS.text,
      fontWeight: "500",
    },

    recentExpiryRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 5,
      marginTop: 3,
    },

    recentExpiryText: {
      flex: 1,
      fontSize: 11,
      fontWeight: "600",
    },

    emptyCard: {
      alignItems: "center",
      padding: 24,
      gap: Spacing.sm,
      backgroundColor: COLORS.surface,
    },

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

    emptyButtonText: {
      color: COLORS.buttonPrimaryText,
      fontWeight: "600",
      fontSize: 14,
    },

    docCard: {
      marginBottom: 10,
      padding: 12,
      backgroundColor: COLORS.surface,
    },

    docRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    docImage: {
      width: 50,
      height: 50,
      borderRadius: BORDER_RADIUS.sm,
      marginRight: 12,
    },

    docImagePlaceholder: {
      backgroundColor: COLORS.primaryLight,
      justifyContent: "center",
      alignItems: "center",
    },

    docInfo: {
      flex: 1,
      justifyContent: "center",
    },

    docTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: COLORS.text,
      marginBottom: 2,
    },

    docSubtitle: {
      fontSize: 13,
      color: COLORS.textSecondary,
      marginBottom: 2,
    },

    docDate: {
      fontSize: 11,
      color: COLORS.textMuted,
    },

    reminderItem: {
      marginBottom: 12,
      backgroundColor: COLORS.surface,
    },

    reminderContent: {
      flexDirection: "row",
      alignItems: "center",
    },

    reminderIcon: {
      marginRight: 12,
    },

    reminderInfo: {
      flex: 1,
    },

    reminderTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: COLORS.text,
    },

    reminderDesc: {
      fontSize: 13,
      color: COLORS.textSecondary,
      marginTop: 2,
    },

    reminderDate: {
      fontSize: 12,
      color: COLORS.textSecondary,
      marginTop: 4,
    },

    emptyRemindersCard: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
      gap: 12,
      backgroundColor: COLORS.surface,
    },

    emptyRemindersText: {
      color: COLORS.textSecondary,
      fontSize: 14,
    },

    syncFooter: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      marginTop: 8,
      marginBottom: 16,
    },

    syncFooterText: {
      fontSize: 12,
      color: COLORS.textSecondary,
    },
  });
