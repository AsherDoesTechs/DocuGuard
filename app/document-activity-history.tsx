import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";
import { api } from "@/services/api";
import { formatShortDate } from "@/utils";

interface AuditLogItem {
  id: string | number;
  document_id: string | number;
  action: "UPLOAD" | "MODIFY" | "ACCESS" | "DELETE" | string;
  details?: unknown;
  created_at: string;
}

function normalizeAuditLogs(payload: any): AuditLogItem[] {
  const raw = Array.isArray(payload?.logs)
    ? payload.logs
    : Array.isArray(payload)
      ? payload
      : [];

  return raw
    .filter((item: any) => item && (item.created_at || item.timestamp))
    .map((item: any) => ({
      id: item.id ?? `${item.document_id ?? "doc"}-${item.created_at ?? Date.now()}`,
      document_id:
        item.document_id ??
        item.documentId ??
        item.resource_id ??
        item.resourceId ??
        "Unknown",
      action: item.action ?? item.event_type ?? item.eventType ?? "ACTIVITY",
      details: item.details,
      created_at: item.created_at ?? item.timestamp,
    }));
}

function getActionLabel(action: string): string {
  switch (action) {
    case "UPLOAD":
      return "Uploaded";
    case "MODIFY":
      return "Updated";
    case "ACCESS":
      return "Viewed";
    case "DELETE":
      return "Deleted";
    default:
      return action.replace(/_/g, " ");
  }
}

function formatFieldName(field: string): string {
  const map: Record<string, string> = {
    title: "title",
    category: "category",
    issuer: "issuer",
    documentNumber: "document number",
    issueDate: "issue date",
    expiryDate: "expiry date",
    notes: "notes",
    enableAlerts: "alerts",
    fileUrl: "file",
    fileName: "file",
  };
  return map[field] || field.replace(/([A-Z])/g, " $1").toLowerCase().trim();
}

function formatDetails(details: unknown, action?: string): string | null {
  let value: unknown = details;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (value == null) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const message =
      (typeof obj.message === "string" && obj.message.trim()) ||
      (typeof obj.summary === "string" && obj.summary.trim());
    if (message) return message;

    const title =
      typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : null;
    const fileName =
      typeof obj.fileName === "string" && obj.fileName.trim()
        ? obj.fileName.trim()
        : null;

    if (action === "ACCESS" && title) return `Viewed "${title}"`;
    if (action === "UPLOAD" && (fileName || title)) {
      return `Uploaded "${fileName || title}"`;
    }
    if (action === "DELETE" && title) return `Deleted "${title}"`;
    if (action === "MODIFY") {
      const fields = Array.isArray(obj.updatedFields)
        ? obj.updatedFields.filter((f): f is string => typeof f === "string")
        : [];
      if (fields.length > 0) {
        const names = fields.slice(0, 3).map(formatFieldName);
        const suffix = fields.length > 3 ? ` and ${fields.length - 3} more` : "";
        return `Updated ${names.join(", ")}${suffix}${title ? ` for "${title}"` : ""}`;
      }
      if (title) return `Updated "${title}"`;
    }

    if (title) return `Document: "${title}"`;
    return null;
  }

  if (typeof value === "string") return value.trim() || null;
  return null;
}

function formatRelativeTime(dateValue: string, nowMs: number): string {
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return "Unknown time";

  const diffSec = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return formatShortDate(dateValue);
}

function formatExactTime(dateValue: string): string {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DocumentActivityHistoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "UPLOAD" | "MODIFY" | "ACCESS" | "DELETE">("all");

  const fetchLogs = useCallback(async (showLoading = false) => {
    try {
      setError(null);
      if (showLoading) setLoading(true);
      const token = await api.getStoredToken();
      if (!token) {
        setLogs([]);
        return;
      }

      const res = await api.client.get("/audit-logs", {
        headers: { Authorization: `Bearer ${token}` },
      });

      setLogs(normalizeAuditLogs(res.data));
    } catch (err) {
      console.warn("Failed to fetch audit logs:", err);
      setError("Unable to load activity history right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(true);
    const interval = setInterval(() => {
      setNow(Date.now());
      void fetchLogs();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useFocusEffect(
    useCallback(() => {
      void fetchLogs();
    }, [fetchLogs]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    void fetchLogs();
  };

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((item) => {
      if (actionFilter !== "all" && item.action !== actionFilter) return false;
      if (!q) return true;
      const details = formatDetails(item.details, item.action) || "";
      const haystack = [
        String(item.document_id),
        item.action,
        getActionLabel(item.action),
        details,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, search, actionFilter]);

  function getActionIcon(action: string): keyof typeof Ionicons.glyphMap {
    switch (action) {
      case "UPLOAD":
        return "cloud-upload-outline";
      case "MODIFY":
        return "create-outline";
      case "ACCESS":
        return "eye-outline";
      case "DELETE":
        return "trash-outline";
      default:
        return "document-text-outline";
    }
  }

function getActionColor(action: string, colors: any): string {
  switch (action) {
    case "UPLOAD":
      return colors.primary;
    case "MODIFY":
      return colors.warning;
    case "ACCESS":
      return colors.success;
    case "DELETE":
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Document Activity History</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading activity history...</Text>
        </View>
      ) : (
        <>
          <View style={styles.filtersContainer}>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search by document, action, or details"
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {search.length > 0 ? (
                <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {([
                { value: "all", label: "All" },
                { value: "UPLOAD", label: "Uploaded" },
                { value: "MODIFY", label: "Updated" },
                { value: "ACCESS", label: "Viewed" },
                { value: "DELETE", label: "Deleted" },
              ] as const).map((f) => {
                const active = actionFilter === f.value;
                return (
                  <TouchableOpacity
                    key={f.value}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setActionFilter(f.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {error ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
                <Text style={styles.emptyText}>{error}</Text>
              </View>
            ) : filteredLogs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons
                  name={logs.length === 0 ? "time-outline" : "search-outline"}
                  size={48}
                  color={colors.textSecondary}
                />
                <Text style={styles.emptyText}>
                  {logs.length === 0 ? "No activity recorded yet." : "No matching activity found."}
                </Text>
                {logs.length > 0 ? (
                  <TouchableOpacity
                    style={styles.clearFiltersButton}
                    onPress={() => { setSearch(""); setActionFilter("all"); }}
                  >
                    <Text style={styles.clearFiltersText}>Clear filters</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              filteredLogs.map((item) => {
                const details = formatDetails(item.details, item.action);
                const actionColor = getActionColor(item.action, colors);
                return (
                  <View key={String(item.id)} style={styles.logCard}>
                    <View style={[styles.iconContainer, { backgroundColor: `${actionColor}20` }]}>
                      <Ionicons name={getActionIcon(item.action)} size={20} color={actionColor} />
                    </View>
                    <View style={styles.logDetails}>
                      <View style={styles.logTopRow}>
                        <Text style={styles.logActionText}>{getActionLabel(item.action)}</Text>
                        <View style={styles.timeContainer}>
                          <Text style={styles.logTimeText}>{formatRelativeTime(item.created_at, now)}</Text>
                          <Text style={styles.logExactTimeText}>{formatExactTime(item.created_at)}</Text>
                        </View>
                      </View>
                      <Text style={styles.logSubText}>Document: {String(item.document_id)}</Text>
                      {details ? <Text style={styles.logMetaText}>{details}</Text> : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    centerContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 12,
    },
    loadingText: { fontSize: 14, color: colors.textSecondary },
    content: { padding: 16, paddingBottom: 40, gap: 12 },
    emptyContainer: {
      paddingVertical: 60,
      alignItems: "center",
      gap: 12,
    },
    emptyText: { fontSize: 15, color: colors.textSecondary, textAlign: "center" },
    logCard: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12,
      alignItems: "flex-start",
    },
    iconContainer: {
      width: 38,
      height: 38,
      borderRadius: 19,
      justifyContent: "center",
      alignItems: "center",
    },
    logDetails: { flex: 1 },
    logTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 4,
      gap: 8,
    },
    logActionText: { fontSize: 14, fontWeight: "700", color: colors.text, flex: 1 },
    timeContainer: { alignItems: "flex-end" },
    logTimeText: { fontSize: 12, fontWeight: "600", color: colors.primary },
    logExactTimeText: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
    logSubText: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
    logMetaText: {
      fontSize: 11,
      color: colors.textSecondary,
      backgroundColor: colors.surfaceSecondary,
      padding: 6,
      borderRadius: 6,
      marginTop: 4,
    },
    filtersContainer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
      gap: 10,
    },
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      minHeight: 42,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      paddingVertical: 8,
    },
    chipsRow: {
      flexDirection: "row",
      gap: 8,
      paddingRight: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    chipText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    chipTextActive: {
      color: colors.primary,
    },
    clearFiltersButton: {
      marginTop: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.primaryLight,
    },
    clearFiltersText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.primary,
    },
  });
