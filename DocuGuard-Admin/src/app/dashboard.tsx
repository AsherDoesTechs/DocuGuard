import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getAdminDocuments, getAdminLogs, getAdminOverview, getAdminUsers, logoutAdmin, getAdminApiBaseUrl,
  type AdminMetrics, type AuditLogEntry, type VaultDocument, type AdminUser,
} from "../services/adminApi";
import { clearAdminToken, getAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { BarChart, BreakdownList, Card, ProgressBar, StatCard, Badge, IconButton, SkeletonScreen } from "../components/ui";

const REFRESH_MS = 15000;

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialMessage, setPartialMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);

  const load = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent) setLoading(true);
    setErrorMessage("");
    setPartialMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const [overviewRes, usersRes, docsRes, logsRes] = await Promise.allSettled([
        getAdminOverview(token), getAdminUsers(token), getAdminDocuments(token), getAdminLogs(token),
      ]);
      let ok = 0; const failures: string[] = [];
      if (overviewRes.status === "fulfilled") { ok++; setMetrics((overviewRes.value as any).metrics ?? (overviewRes.value as any)); } else failures.push("overview");
      if (usersRes.status === "fulfilled") { ok++; const d = usersRes.value as any; setUsers(Array.isArray(d) ? d : d?.users || []); } else failures.push("users");
      if (docsRes.status === "fulfilled") { ok++; const d = docsRes.value as any; setDocs(Array.isArray(d) ? d : d?.documents || []); } else failures.push("documents");
      if (logsRes.status === "fulfilled") { ok++; const d = logsRes.value as any; setLogs(Array.isArray(d) ? d : d?.logs || []); } else failures.push("logs");
      if (!ok) {
        const firstErr = [overviewRes, usersRes, docsRes, logsRes].map((r) => r.status === "rejected" ? r.reason : null).find(Boolean);
        throw firstErr instanceof Error ? firstErr : new Error("Unable to load admin data.");
      }
      if (failures.length) setPartialMessage(`Unavailable: ${failures.join(", ")}.`);
      setLastSync(new Date());
    } catch (error) {
      if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load dashboard.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false, false); }, [load]);

  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (ui.autoSync) timerRef.current = setInterval(() => { void load(false, true); }, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [ui.autoSync, load]);

  const handleSignOut = async () => {
    setSettingsOpen(false);
    try { const token = await getAdminToken(); if (token) await logoutAdmin(token); else await clearAdminToken(); } catch { await clearAdminToken(); }
    router.replace("/");
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
    const now = Date.now(); const dayMs = 86400000;
    const recentLogs = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && now - t <= 7 * dayMs; });
    const critical24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return String(l.severity).toLowerCase() === "critical" && Number.isFinite(t) && now - t <= dayMs; }).length;
    const warning24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return String(l.severity).toLowerCase() === "warning" && Number.isFinite(t) && now - t <= dayMs; }).length;
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const last7 = Array.from({ length: 7 }, (_, idx) => {
      const i = 6 - idx; const d = new Date(now - i * dayMs);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const count = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && t >= start && t < start + dayMs; }).length;
      return { label: dayNames[d.getDay()], value: count };
    });
    const categories = Object.entries(docs.reduce<Record<string, number>>((acc, d) => { const k = String((d as any).category || "other").toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
      .sort((a,b) => b[1]-a[1]).slice(0,6);
    const avgDocsPerUser = totalUsers ? (totalDocs / totalUsers).toFixed(1) : "0.0";
    const riskLevel: "Low"|"Moderate"|"High" = critical24h > 0 || ocrFailed > Math.max(1, Math.ceil(docs.length * 0.15)) ? "High" : warning24h > 2 || ocrPending > Math.max(3, ocrCompleted) ? "Moderate" : "Low";
    const riskTone = riskLevel === "High" ? "danger" : riskLevel === "Moderate" ? "warning" : "success";
    const insights: string[] = [];
    if (ocrPending > 0) insights.push(`${ocrPending} document${ocrPending>1?"s":""} pending OCR.`);
    if (ocrFailed > 0) insights.push(`${ocrFailed} OCR issue${ocrFailed>1?"s":""} detected.`);
    if (critical24h > 0) insights.push(`${critical24h} critical event${critical24h>1?"s":""} in last 24h.`);
    if (!insights.length) insights.push("No immediate issues detected.");
    return { totalUsers, totalDocs, activeUsers, suspendedUsers, ocrCompleted, ocrPending, ocrFailed, ocrUnknown, ocrRate, recentLogs, critical24h, warning24h, last7, categories, avgDocsPerUser, riskLevel, riskTone, insights };
  }, [metrics, users, docs, logs]);

  const recentLogItems = useMemo(() => logs.slice(0, 5), [logs]);
  const quickActions = [
    { label: "Manage Users", icon: "people-outline" as const, route: "/users", desc: "Search, filter, suspend/activate" },
    { label: "Documents", icon: "folder-open-outline" as const, route: "/documents", desc: "Browse by category & OCR status" },
    { label: "Security Logs", icon: "shield-checkmark-outline" as const, route: "/logs", desc: "Investigate events & risk" },
    { label: "System Health", icon: "pulse-outline" as const, route: "/health", desc: "Infra diagnostics" },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>DocuGuard</Text>
            <Text style={styles.brandSub}>Admin · {ui.autoSync ? `Auto-sync 15s` : "Sync paused"}{lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <IconButton icon="refresh-outline" onPress={() => void load(true)} label="Refresh" />
            <IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" />
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={AdminColors.primary} />}>
          {loading && !metrics && users.length === 0 && docs.length === 0 && logs.length === 0 ? (
            <SkeletonScreen />
          ) : errorMessage && users.length === 0 && docs.length === 0 ? (
            <Card><Text style={styles.errorTitle}>Unable to load dashboard</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void load()}><Text style={styles.retryText}>Try again</Text></Pressable></Card>
          ) : (
            <>
              {!!partialMessage && <Card><View style={styles.partialRow}><Ionicons name="warning-outline" size={16} color={AdminColors.warning} /><Text style={styles.partialTitle}>{partialMessage}</Text></View></Card>}
              <View style={styles.row}><StatCard label="Total Users" value={analytics.totalUsers} icon="people-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={`${analytics.activeUsers} active`} /><StatCard label="Documents" value={analytics.totalDocs} icon="folder-open-outline" color={AdminColors.chart4} bg="#F3EEFF" hint={`${analytics.avgDocsPerUser} avg/user`} /></View>
              <View style={styles.row}><StatCard label="OCR Success" value={`${analytics.ocrRate}%`} icon="scan-outline" color={AdminColors.success} bg={AdminColors.successSoft} hint={`${analytics.ocrCompleted} done`} /><StatCard label="Events (7d)" value={analytics.recentLogs.length} icon="pulse-outline" color={AdminColors.warning} bg={AdminColors.warningSoft} hint={`${analytics.critical24h} critical/24h`} /></View>

              <Card title="Security posture" subtitle="Signals from available admin data">
                <View style={styles.riskHeader}><View style={{ flex: 1 }}><Text style={styles.riskLabel}>Risk level</Text><Text style={styles.riskHint}>Alerts, OCR issues, warnings</Text></View><Badge label={analytics.riskLevel} tone={analytics.riskTone as any} /></View>
                <View style={styles.miniGrid}><Mini label="Critical (24h)" value={String(analytics.critical24h)} /><Mini label="Warnings (24h)" value={String(analytics.warning24h)} /><Mini label="OCR backlog" value={String(analytics.ocrPending)} /></View>
                <View style={styles.insights}>{analytics.insights.map((ins, i) => (<View key={i} style={styles.insightRow}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{ins}</Text></View>))}</View>
              </Card>

              <Card title="Audit activity" subtitle="Last 7 days">{logs.length ? <BarChart data={analytics.last7} height={120} /> : <Text style={styles.muted}>No log data.</Text>}</Card>

              <Card title="Document categories" subtitle="Top categories by count">
                {analytics.categories.length ? <BreakdownList segments={analytics.categories.map(([label, value], i) => ({ label: label.charAt(0).toUpperCase()+label.slice(1), value, color: [AdminColors.chart1,AdminColors.chart2,AdminColors.chart3,AdminColors.chart4,AdminColors.chart5,AdminColors.chart6][i%6] }))} /> : <Text style={styles.muted}>No category data.</Text>}
              </Card>

              <Card title="OCR pipeline" subtitle="Processing distribution">
                {docs.length ? <BreakdownList segments={[{ label: "Completed", value: analytics.ocrCompleted, color: AdminColors.success }, { label: "Pending", value: analytics.ocrPending, color: AdminColors.warning }, { label: "Failed/Other", value: analytics.ocrFailed + analytics.ocrUnknown, color: AdminColors.danger }]} /> : <Text style={styles.muted}>No document data.</Text>}
                <View style={{ marginTop: 12, gap: 6 }}><View style={styles.progressLabelRow}><Text style={styles.progressLabel}>Completion</Text><Text style={styles.progressPct}>{analytics.ocrRate}%</Text></View><ProgressBar value={analytics.ocrRate} color={AdminColors.success} /></View>
              </Card>

              <Card title="Recent security events" subtitle="Latest activity" right={<Pressable onPress={() => router.push("/logs" as any)}><Text style={styles.link}>View all</Text></Pressable>}>
                {recentLogItems.length ? <View style={{ gap: 10 }}>{recentLogItems.map((item, idx) => { const sev = String(item.severity||"info").toLowerCase(); const tone = sev==="critical"?"danger":sev==="warning"?"warning":"info"; return (<View key={String(item.id??idx)} style={styles.recentRow}><View style={{ flex: 1 }}><Text style={styles.recentAction} numberOfLines={1}>{item.action||"Event"}</Text><Text style={styles.recentMeta} numberOfLines={1}>{item.actor||"system"} · {item.timestamp?new Date(item.timestamp).toLocaleString():"—"}</Text></View><Badge label={sev} tone={tone as any} /></View>); })}</View> : <Text style={styles.muted}>No recent events.</Text>}
              </Card>

              <Text style={styles.sectionTitle}>Quick actions</Text>
              <View style={{ gap: 10 }}>{quickActions.map((a) => (<Pressable key={a.route} style={styles.actionCard} onPress={() => router.push(a.route as any)}><View style={[styles.actionIcon, { backgroundColor: AdminColors.primarySoft }]}><Ionicons name={a.icon} size={20} color={AdminColors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.actionLabel}>{a.label}</Text><Text style={styles.actionDesc}>{a.desc}</Text></View><Ionicons name="chevron-forward" size={18} color={AdminColors.textMuted} /></Pressable>))}</View>
            </>
          )}
        </ScrollView>
        <AdminBottomNav />
      </View>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSettingsOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>Admin Settings</Text><Pressable onPress={() => setSettingsOpen(false)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.groupTitle}>Sync & Session</Text>
              <SettingRow label="Auto-sync data" hint="Refresh dashboard/users/docs/logs every 15s" value={ui.autoSync} onChange={(v) => setAdminUiSettings({ autoSync: v })} />
              <Info label="Last sync" value={lastSync ? lastSync.toLocaleString() : "—"} />
              <Info label="API endpoint" value={getAdminApiBaseUrl()} />
              <Text style={[styles.groupTitle, { marginTop: 14 }]}>Privacy & Security</Text>
              <SettingRow label="Privacy-aware mode" hint="Mask user emails and sensitive identifiers in admin views" value={ui.privacyMode} onChange={(v) => setAdminUiSettings({ privacyMode: v })} />
              <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={16} color={AdminColors.primary} /><Text style={styles.noticeText}>Admins manage operations and security. User document contents, private files, and personal secrets are not exposed in this dashboard. Access is role-checked, token-based, and audited by the backend.</Text></View>
              <View style={styles.bullets}>{["No document file/content preview for admins","User emails masked in privacy-aware mode","Session token stored locally for admin access","Sign out clears local admin session"].map((t)=>(<View key={t} style={styles.bulletRow}><Ionicons name="checkmark-circle" size={14} color={AdminColors.success} /><Text style={styles.bulletText}>{t}</Text></View>))}</View>
              <Pressable style={styles.signOutBtn} onPress={handleSignOut}><Ionicons name="log-out-outline" size={18} color="#fff" /><Text style={styles.signOutText}>Sign out</Text></Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Mini({ label, value }: { label: string; value: string }) { return <View style={styles.miniItem}><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniLabel}>{label}</Text></View>; }
function SettingRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v:boolean)=>void }) { return <View style={styles.settingRow}><View style={{ flex: 1 }}><Text style={styles.settingLabel}>{label}</Text><Text style={styles.settingHint}>{hint}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: AdminColors.borderStrong, true: "#93C5FD" }} thumbColor={value ? AdminColors.primary : "#fff"} /></View>; }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background }, screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  brand: { fontSize: 22, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.4 }, brandSub: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 1 },
  scroll: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 }, row: { flexDirection: "row", gap: 12 },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 }, errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  partialRow: { flexDirection: "row", alignItems: "center", gap: 6 }, partialTitle: { fontSize: 13, fontWeight: "600", color: AdminColors.warningText },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm }, retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  riskHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }, riskLabel: { fontSize: 14, fontWeight: "700", color: AdminColors.text }, riskHint: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  miniGrid: { flexDirection: "row", gap: 10, marginBottom: 12 }, miniItem: { flex: 1, backgroundColor: AdminColors.surfaceAlt, borderRadius: 12, padding: 12, alignItems: "center" }, miniValue: { fontSize: 18, fontWeight: "800", color: AdminColors.text }, miniLabel: { fontSize: 11, color: AdminColors.textSecondary, marginTop: 2, textAlign: "center" },
  insights: { gap: 8, borderTopWidth: 1, borderTopColor: AdminColors.border, paddingTop: 12 }, insightRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" }, insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between" }, progressLabel: { fontSize: 12, color: AdminColors.textSecondary }, progressPct: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: AdminColors.text, marginTop: 2 },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 10 }, recentAction: { fontSize: 13, fontWeight: "700", color: AdminColors.text }, recentMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  link: { fontSize: 13, fontWeight: "700", color: AdminColors.primary },
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 14 },
  actionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" }, actionLabel: { fontSize: 15, fontWeight: "700", color: AdminColors.text }, actionDesc: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(16,24,40,0.35)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: AdminColors.surface, borderRadius: 20, padding: 18, maxHeight: "85%", borderWidth: 1, borderColor: AdminColors.border },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }, modalTitle: { fontSize: 18, fontWeight: "800", color: AdminColors.text },
  groupTitle: { fontSize: 13, fontWeight: "800", color: AdminColors.text, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border }, settingLabel: { fontSize: 14, fontWeight: "700", color: AdminColors.text }, settingHint: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2, lineHeight: 17 },
  infoRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border }, infoLabel: { fontSize: 11, fontWeight: "700", color: AdminColors.textMuted, textTransform: "uppercase", marginBottom: 2 }, infoValue: { fontSize: 13, color: AdminColors.text },
  notice: { flexDirection: "row", gap: 8, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: AdminColors.primarySoft }, noticeText: { flex: 1, fontSize: 12, color: AdminColors.primaryDark, lineHeight: 18 },
  bullets: { gap: 8, marginTop: 12 }, bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" }, bulletText: { flex: 1, fontSize: 12, color: AdminColors.textSecondary, lineHeight: 17 },
  signOutBtn: { marginTop: 18, height: 46, borderRadius: 12, backgroundColor: AdminColors.danger, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }, signOutText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
