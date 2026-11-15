import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
  getAdminDocuments,
  getAdminLogs,
  getAdminOverview,
  getAdminUsers,
  logoutAdmin,
  type AdminMetrics,
  type AuditLogEntry,
  type VaultDocument,
  type AdminUser,
} from "../services/adminApi";
import { clearAdminToken, getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { BarChart, BreakdownList, Card, ProgressBar, StatCard, Badge, IconButton } from "../components/ui";

type LoadState = "idle" | "loading" | "ready" | "error";

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setState("loading");
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) {
        router.replace("/");
        return;
      }
      const [overviewRes, usersRes, docsRes, logsRes] = await Promise.allSettled([
        getAdminOverview(token),
        getAdminUsers(token),
        getAdminDocuments(token),
        getAdminLogs(token),
      ]);

      let hadAnySuccess = false;
      if (overviewRes.status === "fulfilled") {
        hadAnySuccess = true;
        setMetrics((overviewRes.value as any).metrics ?? (overviewRes.value as any));
      }
      if (usersRes.status === "fulfilled") {
        hadAnySuccess = true;
        const d = usersRes.value as any;
        setUsers(Array.isArray(d) ? d : d?.users || []);
      }
      if (docsRes.status === "fulfilled") {
        hadAnySuccess = true;
        const d = docsRes.value as any;
        setDocs(Array.isArray(d) ? d : d?.documents || []);
      }
      if (logsRes.status === "fulfilled") {
        hadAnySuccess = true;
        const d = logsRes.value as any;
        setLogs(Array.isArray(d) ? d : d?.logs || []);
      }

      if (!hadAnySuccess) {
        const firstErr = [overviewRes, usersRes, docsRes, logsRes]
          .map((r) => (r.status === "rejected" ? r.reason : null))
          .find(Boolean);
        throw firstErr instanceof Error ? firstErr : new Error("Unable to load admin data.");
      }

      const failed = [overviewRes, usersRes, docsRes, logsRes].filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        const msg = failed[0].status === "rejected" && failed[0].reason instanceof Error
          ? failed[0].reason.message
          : "Some admin endpoints failed to load.";
        setErrorMessage(msg);
      }
      setState("ready");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to load admin overview.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSignOut = async () => {
    try {
      const token = await getAdminToken();
      if (token) await logoutAdmin(token);
      else await clearAdminToken();
      router.replace("/");
    } catch {
      Alert.alert("Sign-out failed", "Could not clear session. Try again.");
    }
  };

  const analytics = useMemo(() => {
    const totalUsers = metrics?.totalUsers ?? users.length;
    const totalDocs = metrics?.totalDocuments ?? docs.length;
    const activeUsers = users.filter((u) => String(u.status || "active") === "active").length;
    const suspendedUsers = Math.max(0, users.length - activeUsers);
    const ocrCompleted = docs.filter((d) => String(d.ocrStatus) === "completed").length;
    const ocrPending = docs.filter((d) => String(d.ocrStatus) === "pending").length;
    const ocrFailed = docs.filter((d) => !["completed", "pending"].includes(String(d.ocrStatus))).length;
    const ocrRate = docs.length ? Math.round((ocrCompleted / docs.length) * 100) : 0;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const recentLogs = logs.filter((l) => {
      const t = new Date(l.timestamp as any).getTime();
      return Number.isFinite(t) && now - t <= 7 * dayMs;
    });
    const critical24h = logs.filter((l) => {
      const t = new Date(l.timestamp as any).getTime();
      return String(l.severity) === "critical" && Number.isFinite(t) && now - t <= dayMs;
    }).length;
    const warning24h = logs.filter((l) => {
      const t = new Date(l.timestamp as any).getTime();
      return String(l.severity) === "warning" && Number.isFinite(t) && now - t <= dayMs;
    }).length;

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const last7 = Array.from({ length: 7 }, (_, idx) => {
      const i = 6 - idx;
      const d = new Date(now - i * dayMs);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const end = start + dayMs;
      const count = logs.filter((l) => {
        const t = new Date(l.timestamp as any).getTime();
        return Number.isFinite(t) && t >= start && t < end;
      }).length;
      return { label: dayNames[d.getDay()], value: count };
    });

    const avgDocsPerUser = totalUsers ? (totalDocs / totalUsers).toFixed(1) : "0.0";
    const projectedWeekly = recentLogs.length;
    const riskLevel: "Low" | "Moderate" | "High" =
      critical24h > 0 || ocrFailed > Math.max(2, docs.length * 0.2)
        ? "High"
        : warning24h > 3 || ocrPending > ocrCompleted
          ? "Moderate"
          : "Low";
    const riskTone = riskLevel === "High" ? "danger" : riskLevel === "Moderate" ? "warning" : "success";
    const insights: string[] = [];
    if (ocrPending > 0) insights.push(`${ocrPending} document${ocrPending > 1 ? "s" : ""} pending OCR — monitor queue.`);
    if (ocrFailed > 0) insights.push(`${ocrFailed} OCR failure${ocrFailed > 1 ? "s" : ""} — review failed uploads.`);
    if (suspendedUsers > 0) insights.push(`${suspendedUsers} suspended account${suspendedUsers > 1 ? "s" : ""}.`);
    if (critical24h > 0) insights.push(`${critical24h} critical event${critical24h > 1 ? "s" : ""} in last 24h.`);
    if (insights.length === 0) insights.push("No immediate risks detected from available data.");
    return { totalUsers, totalDocs, activeUsers, suspendedUsers, ocrCompleted, ocrPending, ocrFailed, ocrRate, recentLogs, critical24h, warning24h, last7, avgDocsPerUser, projectedWeekly, riskLevel, riskTone, insights };
  }, [metrics, users, docs, logs]);

  const quickActions = [
    { label: "Users", icon: "people-outline" as const, route: "/users", color: AdminColors.primary, bg: AdminColors.primarySoft },
    { label: "Docs", icon: "document-text-outline" as const, route: "/documents", color: AdminColors.chart4, bg: "#F3E8FF" },
    { label: "Logs", icon: "shield-checkmark-outline" as const, route: "/logs", color: AdminColors.warning, bg: AdminColors.warningSoft },
    { label: "Health", icon: "pulse-outline" as const, route: "/health", color: AdminColors.success, bg: AdminColors.successSoft },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>DocuGuard</Text>
            <Text style={styles.brandSub}>Admin Dashboard</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <IconButton icon="refresh-outline" onPress={() => void load(true)} label="Refresh" />
            <IconButton icon="log-out-outline" onPress={handleSignOut} label="Sign out" />
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={AdminColors.primary} />}
        >
          {state === "loading" ? (
            <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading analytics…</Text></View>
          ) : state === "error" ? (
            <Card>
              <Text style={styles.errorTitle}>Unable to load dashboard</Text>
              <Text style={styles.muted}>{errorMessage}</Text>
              <Text style={styles.errorHint}>Check server reachability, EXPO_PUBLIC_API_BASE_URL, and that server CORS_ALLOWED_ORIGINS includes this web origin (or unset in non-production). API calls require a valid admin session token.</Text>
              <Pressable style={styles.retryBtn} onPress={() => void load()}><Text style={styles.retryText}>Try again</Text></Pressable>
            </Card>
          ) : (
            <>
              {!!errorMessage && (
                <Card>
                  <Text style={styles.partialTitle}>Some data unavailable</Text>
                  <Text style={styles.muted}>{errorMessage}</Text>
                </Card>
              )}
              <View style={styles.row}>
                <StatCard label="Total Users" value={analytics.totalUsers} icon="people-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={`${analytics.activeUsers} active`} />
                <StatCard label="Documents" value={analytics.totalDocs} icon="document-text-outline" color={AdminColors.chart4} bg="#F3E8FF" hint={`${analytics.avgDocsPerUser} avg/user`} />
              </View>
              <View style={styles.row}>
                <StatCard label="OCR Success" value={`${analytics.ocrRate}%`} icon="scan-outline" color={AdminColors.success} bg={AdminColors.successSoft} hint={`${analytics.ocrCompleted} completed`} />
                <StatCard label="Events (7d)" value={analytics.recentLogs.length} icon="pulse-outline" color={AdminColors.warning} bg={AdminColors.warningSoft} hint={`${analytics.critical24h} critical/24h`} />
              </View>

              <Card title="Security & Predictions" subtitle="Signals from current admin data">
                <View style={styles.predHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.predLabel}>Risk level</Text>
                    <Text style={styles.predHint}>Based on critical alerts, OCR failures, and warnings</Text>
                  </View>
                  <Badge label={analytics.riskLevel} tone={analytics.riskTone as any} />
                </View>
                <View style={styles.predGrid}>
                  <View style={styles.predItem}><Text style={styles.predValue}>{analytics.projectedWeekly}</Text><Text style={styles.predItemLabel}>Events / week</Text></View>
                  <View style={styles.predItem}><Text style={styles.predValue}>{analytics.warning24h}</Text><Text style={styles.predItemLabel}>Warnings (24h)</Text></View>
                  <View style={styles.predItem}><Text style={styles.predValue}>{analytics.ocrPending}</Text><Text style={styles.predItemLabel}>OCR backlog</Text></View>
                </View>
                <View style={styles.insights}>
                  {analytics.insights.map((ins, i) => (
                    <View key={i} style={styles.insightRow}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{ins}</Text></View>
                  ))}
                </View>
              </Card>

              <Card title="Audit Activity" subtitle="Events over the last 7 days">
                {logs.length ? <BarChart data={analytics.last7} height={130} /> : <Text style={styles.muted}>No log data available for chart.</Text>}
              </Card>

              <Card title="Document Processing" subtitle="OCR pipeline distribution">
                {docs.length ? (
                  <BreakdownList segments={[
                    { label: "Completed", value: analytics.ocrCompleted, color: AdminColors.success },
                    { label: "Pending", value: analytics.ocrPending, color: AdminColors.warning },
                    { label: "Failed / Other", value: analytics.ocrFailed, color: AdminColors.danger },
                  ]} />
                ) : <Text style={styles.muted}>No document data available.</Text>}
                <View style={{ marginTop: 12, gap: 6 }}>
                  <View style={styles.progressLabelRow}><Text style={styles.progressLabel}>OCR completion</Text><Text style={styles.progressPct}>{analytics.ocrRate}%</Text></View>
                  <ProgressBar value={analytics.ocrRate} color={AdminColors.success} />
                </View>
              </Card>

              <Card title="User Status" subtitle="Account health overview">
                {users.length ? (
                  <BreakdownList segments={[
                    { label: "Active", value: analytics.activeUsers, color: AdminColors.primary },
                    { label: "Suspended / Other", value: analytics.suspendedUsers, color: AdminColors.textMuted },
                  ]} />
                ) : <Text style={styles.muted}>No user breakdown available.</Text>}
              </Card>

              <Text style={styles.sectionTitle}>Quick Actions</Text>
              <View style={styles.actionsGrid}>
                {quickActions.map((a) => (
                  <Pressable key={a.route} style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.85 }]} onPress={() => router.push(a.route as any)}>
                    <View style={[styles.actionIcon, { backgroundColor: a.bg }]}><Ionicons name={a.icon} size={20} color={a.color} /></View>
                    <Text style={styles.actionLabel}>{a.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={AdminColors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        <AdminBottomNav />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background },
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  brand: { fontSize: 22, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.4 },
  brandSub: { fontSize: 13, color: AdminColors.textSecondary, marginTop: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  row: { flexDirection: "row", gap: 12 },
  center: { alignItems: "center", paddingVertical: 48, gap: 10 },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 },
  errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  partialTitle: { fontSize: 15, fontWeight: "700", color: AdminColors.warningText, marginBottom: 4 },
  errorHint: { fontSize: 12, color: AdminColors.textMuted, marginTop: 6, lineHeight: 17 },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  predHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  predLabel: { fontSize: 14, fontWeight: "700", color: AdminColors.text },
  predHint: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  predGrid: { flexDirection: "row", gap: 10, marginBottom: 12 },
  predItem: { flex: 1, backgroundColor: AdminColors.surfaceAlt, borderRadius: AdminRadii.md, padding: 12, alignItems: "center" },
  predValue: { fontSize: 20, fontWeight: "800", color: AdminColors.text },
  predItemLabel: { fontSize: 11, color: AdminColors.textSecondary, marginTop: 2, textAlign: "center" },
  insights: { gap: 8, borderTopWidth: 1, borderTopColor: AdminColors.border, paddingTop: 12 },
  insightRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontSize: 12, color: AdminColors.textSecondary },
  progressPct: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: AdminColors.text, marginTop: 4 },
  actionsGrid: { gap: 10 },
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 14 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: AdminColors.text },
});
