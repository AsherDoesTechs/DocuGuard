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

type LoadState = "loading" | "ready" | "error";

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialMessage, setPartialMessage] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setState("loading");
    setErrorMessage("");
    setPartialMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const [overviewRes, usersRes, docsRes, logsRes] = await Promise.allSettled([
        getAdminOverview(token),
        getAdminUsers(token),
        getAdminDocuments(token),
        getAdminLogs(token),
      ]);

      let ok = 0;
      const failures: string[] = [];
      if (overviewRes.status === "fulfilled") { ok++; setMetrics((overviewRes.value as any).metrics ?? (overviewRes.value as any)); } else failures.push("overview");
      if (usersRes.status === "fulfilled") { ok++; const d = usersRes.value as any; setUsers(Array.isArray(d) ? d : d?.users || []); } else failures.push("users");
      if (docsRes.status === "fulfilled") { ok++; const d = docsRes.value as any; setDocs(Array.isArray(d) ? d : d?.documents || []); } else failures.push("documents");
      if (logsRes.status === "fulfilled") { ok++; const d = logsRes.value as any; setLogs(Array.isArray(d) ? d : d?.logs || []); } else failures.push("logs");

      if (!ok) {
        const firstErr = [overviewRes, usersRes, docsRes, logsRes].map((r) => r.status === "rejected" ? r.reason : null).find(Boolean);
        throw firstErr instanceof Error ? firstErr : new Error("Unable to load admin data.");
      }
      if (failures.length) setPartialMessage(`Some sections unavailable: ${failures.join(", ")}.`);
      setState("ready");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to load dashboard.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSignOut = async () => {
    Alert.alert("Sign out", "End this admin session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          try {
            const token = await getAdminToken();
            if (token) await logoutAdmin(token); else await clearAdminToken();
          } catch {
            await clearAdminToken();
          } finally {
            router.replace("/");
          }
        },
      },
    ]);
  };

  const analytics = useMemo(() => {
    const totalUsers = metrics?.totalUsers ?? users.length;
    const totalDocs = metrics?.totalDocuments ?? docs.length;
    const activeUsers = users.filter((u) => String(u.status || "active") === "active").length;
    const suspendedUsers = Math.max(0, users.length - activeUsers);
    const ocrCompleted = docs.filter((d) => String(d.ocrStatus) === "completed").length;
    const ocrPending = docs.filter((d) => String(d.ocrStatus) === "pending").length;
    const ocrFailed = docs.filter((d) => !["completed", "pending", "unknown"].includes(String(d.ocrStatus))).length;
    const ocrUnknown = docs.filter((d) => String(d.ocrStatus) === "unknown").length;
    const ocrRate = docs.length ? Math.round((ocrCompleted / docs.length) * 100) : 0;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const recentLogs = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && now - t <= 7 * dayMs; });
    const critical24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return String(l.severity).toLowerCase() === "critical" && Number.isFinite(t) && now - t <= dayMs; }).length;
    const warning24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return String(l.severity).toLowerCase() === "warning" && Number.isFinite(t) && now - t <= dayMs; }).length;

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const last7 = Array.from({ length: 7 }, (_, idx) => {
      const i = 6 - idx;
      const d = new Date(now - i * dayMs);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const end = start + dayMs;
      const count = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && t >= start && t < end; }).length;
      return { label: dayNames[d.getDay()], value: count };
    });

    const avgDocsPerUser = totalUsers ? (totalDocs / totalUsers).toFixed(1) : "0.0";
    const riskLevel: "Low" | "Moderate" | "High" =
      critical24h > 0 || ocrFailed > Math.max(1, Math.ceil(docs.length * 0.15))
        ? "High"
        : warning24h > 2 || ocrPending > Math.max(3, ocrCompleted)
          ? "Moderate"
          : "Low";
    const riskTone = riskLevel === "High" ? "danger" : riskLevel === "Moderate" ? "warning" : "success";

    const insights: string[] = [];
    if (ocrPending > 0) insights.push(`${ocrPending} document${ocrPending > 1 ? "s" : ""} pending OCR.`);
    if (ocrFailed > 0) insights.push(`${ocrFailed} OCR issue${ocrFailed > 1 ? "s" : ""} detected.`);
    if (critical24h > 0) insights.push(`${critical24h} critical event${critical24h > 1 ? "s" : ""} in last 24h.`);
    if (warning24h > 0) insights.push(`${warning24h} warning${warning24h > 1 ? "s" : ""} in last 24h.`);
    if (suspendedUsers > 0) insights.push(`${suspendedUsers} suspended account${suspendedUsers > 1 ? "s" : ""}.`);
    if (!insights.length) insights.push("No immediate issues detected from available data.");

    return { totalUsers, totalDocs, activeUsers, suspendedUsers, ocrCompleted, ocrPending, ocrFailed, ocrUnknown, ocrRate, recentLogs, critical24h, warning24h, last7, avgDocsPerUser, riskLevel, riskTone, insights };
  }, [metrics, users, docs, logs]);

  const recentLogItems = useMemo(() => logs.slice(0, 5), [logs]);
  const quickActions = [
    { label: "Manage Users", icon: "people-outline" as const, route: "/users", color: AdminColors.primary, bg: AdminColors.primarySoft, desc: "Search, filter, suspend/activate" },
    { label: "Documents", icon: "folder-open-outline" as const, route: "/documents", color: AdminColors.chart4, bg: "#F3EEFF", desc: "Browse OCR status & owners" },
    { label: "Security Logs", icon: "shield-checkmark-outline" as const, route: "/logs", color: AdminColors.warning, bg: AdminColors.warningSoft, desc: "Investigate events & risk" },
    { label: "System Health", icon: "pulse-outline" as const, route: "/health", color: AdminColors.success, bg: AdminColors.successSoft, desc: "Infra status & diagnostics" },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>DocuGuard</Text>
            <Text style={styles.brandSub}>Admin control center</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <IconButton icon="refresh-outline" onPress={() => void load(true)} label="Refresh" />
            <IconButton icon="log-out-outline" onPress={handleSignOut} label="Sign out" tone="danger" />
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={AdminColors.primary} />}
        >
          {state === "loading" ? (
            <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading dashboard…</Text></View>
          ) : state === "error" ? (
            <Card>
              <Text style={styles.errorTitle}>Unable to load dashboard</Text>
              <Text style={styles.muted}>{errorMessage}</Text>
              <Text style={styles.errorHint}>Verify API reachability, admin session, and CORS for this origin.</Text>
              <Pressable style={styles.retryBtn} onPress={() => void load()}><Text style={styles.retryText}>Try again</Text></Pressable>
            </Card>
          ) : (
            <>
              {!!partialMessage && (
                <Card>
                  <View style={styles.partialRow}><Ionicons name="warning-outline" size={16} color={AdminColors.warning} /><Text style={styles.partialTitle}>Partial data loaded</Text></View>
                  <Text style={styles.muted}>{partialMessage}</Text>
                </Card>
              )}

              <View style={styles.row}>
                <StatCard label="Total Users" value={analytics.totalUsers} icon="people-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={`${analytics.activeUsers} active`} />
                <StatCard label="Documents" value={analytics.totalDocs} icon="folder-open-outline" color={AdminColors.chart4} bg="#F3EEFF" hint={`${analytics.avgDocsPerUser} avg/user`} />
              </View>
              <View style={styles.row}>
                <StatCard label="OCR Success" value={`${analytics.ocrRate}%`} icon="scan-outline" color={AdminColors.success} bg={AdminColors.successSoft} hint={`${analytics.ocrCompleted} completed`} />
                <StatCard label="Events (7d)" value={analytics.recentLogs.length} icon="pulse-outline" color={AdminColors.warning} bg={AdminColors.warningSoft} hint={`${analytics.critical24h} critical / 24h`} />
              </View>

              <Card title="Security posture" subtitle="Signals from current admin data">
                <View style={styles.riskHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.riskLabel}>Risk level</Text>
                    <Text style={styles.riskHint}>Derived from alerts, OCR issues, and warnings</Text>
                  </View>
                  <Badge label={analytics.riskLevel} tone={analytics.riskTone as any} />
                </View>
                <View style={styles.miniGrid}>
                  <MiniMetric label="Critical (24h)" value={String(analytics.critical24h)} />
                  <MiniMetric label="Warnings (24h)" value={String(analytics.warning24h)} />
                  <MiniMetric label="OCR backlog" value={String(analytics.ocrPending)} />
                </View>
                <View style={styles.insights}>
                  {analytics.insights.map((ins, i) => (
                    <View key={i} style={styles.insightRow}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{ins}</Text></View>
                  ))}
                </View>
              </Card>

              <Card title="Audit activity" subtitle="Events over the last 7 days">
                {logs.length ? <BarChart data={analytics.last7} height={130} /> : <Text style={styles.muted}>No log data available for chart.</Text>}
              </Card>

              <View style={styles.row}>
                <Card title="OCR pipeline" subtitle="Document processing" style={{ flex: 1 }}>
                  {docs.length ? (
                    <BreakdownList segments={[
                      { label: "Completed", value: analytics.ocrCompleted, color: AdminColors.success },
                      { label: "Pending", value: analytics.ocrPending, color: AdminColors.warning },
                      { label: "Failed/Other", value: analytics.ocrFailed + analytics.ocrUnknown, color: AdminColors.danger },
                    ]} />
                  ) : <Text style={styles.muted}>No document data.</Text>}
                  <View style={{ marginTop: 12, gap: 6 }}>
                    <View style={styles.progressLabelRow}><Text style={styles.progressLabel}>Completion</Text><Text style={styles.progressPct}>{analytics.ocrRate}%</Text></View>
                    <ProgressBar value={analytics.ocrRate} color={AdminColors.success} />
                  </View>
                </Card>
              </View>

              <Card title="User accounts" subtitle="Status overview">
                {users.length ? (
                  <BreakdownList segments={[
                    { label: "Active", value: analytics.activeUsers, color: AdminColors.primary },
                    { label: "Suspended / Other", value: analytics.suspendedUsers, color: AdminColors.textMuted },
                  ]} />
                ) : <Text style={styles.muted}>No user data available.</Text>}
              </Card>

              <Card title="Recent security events" subtitle="Latest activity" right={<Pressable onPress={() => router.push("/logs" as any)}><Text style={styles.link}>View all</Text></Pressable>}>
                {recentLogItems.length ? (
                  <View style={{ gap: 10 }}>
                    {recentLogItems.map((item, idx) => {
                      const sev = String(item.severity || "info").toLowerCase();
                      const tone = sev === "critical" ? "danger" : sev === "warning" ? "warning" : "info";
                      return (
                        <View key={String(item.id ?? idx)} style={styles.recentRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.recentAction} numberOfLines={1}>{item.action || "Event"}</Text>
                            <Text style={styles.recentMeta} numberOfLines={1}>{item.actor || "system"} · {item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}</Text>
                          </View>
                          <Badge label={sev} tone={tone as any} />
                        </View>
                      );
                    })}
                  </View>
                ) : <Text style={styles.muted}>No recent events.</Text>}
              </Card>

              <Text style={styles.sectionTitle}>Quick actions</Text>
              <View style={{ gap: 10 }}>
                {quickActions.map((a) => (
                  <Pressable key={a.route} style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.9 }]} onPress={() => router.push(a.route as any)}>
                    <View style={[styles.actionIcon, { backgroundColor: a.bg }]}><Ionicons name={a.icon} size={20} color={a.color} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.actionLabel}>{a.label}</Text>
                      <Text style={styles.actionDesc}>{a.desc}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={AdminColors.textMuted} />
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniItem}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background },
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  brand: { fontSize: 22, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.4 },
  brandSub: { fontSize: 13, color: AdminColors.textSecondary, marginTop: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  row: { flexDirection: "row", gap: 12 },
  center: { alignItems: "center", paddingVertical: 48, gap: 10 },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 },
  errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  partialRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  partialTitle: { fontSize: 14, fontWeight: "700", color: AdminColors.warningText },
  errorHint: { fontSize: 12, color: AdminColors.textMuted, marginTop: 6, lineHeight: 17 },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  riskHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  riskLabel: { fontSize: 14, fontWeight: "700", color: AdminColors.text },
  riskHint: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  miniGrid: { flexDirection: "row", gap: 10, marginBottom: 12 },
  miniItem: { flex: 1, backgroundColor: AdminColors.surfaceAlt, borderRadius: 12, padding: 12, alignItems: "center" },
  miniValue: { fontSize: 18, fontWeight: "800", color: AdminColors.text },
  miniLabel: { fontSize: 11, color: AdminColors.textSecondary, marginTop: 2, textAlign: "center" },
  insights: { gap: 8, borderTopWidth: 1, borderTopColor: AdminColors.border, paddingTop: 12 },
  insightRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontSize: 12, color: AdminColors.textSecondary },
  progressPct: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: AdminColors.text, marginTop: 2 },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  recentAction: { fontSize: 13, fontWeight: "700", color: AdminColors.text },
  recentMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  link: { fontSize: 13, fontWeight: "700", color: AdminColors.primary },
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 14 },
  actionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 15, fontWeight: "700", color: AdminColors.text },
  actionDesc: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
});
