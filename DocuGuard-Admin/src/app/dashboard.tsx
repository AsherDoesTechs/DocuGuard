import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getAdminDocuments, getAdminLogs, getAdminOverview, getAdminSystemHealth, getAdminUsers, logoutAdmin, type AdminMetrics, type AuditLogEntry, type VaultDocument, type AdminUser, type SystemHealthData } from "../services/adminApi";
import { clearAdminToken, getAdminToken } from "../services/adminSession";
import { getAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings, setAdminUiSettings } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminSettingsModal } from "../components/AdminSettingsModal";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { BarChart, BreakdownList, Card, ProgressBar, StatCard, Badge, IconButton, SkeletonScreen, SyncBanner, SyncLine, PressableScale, FadeInView } from "../components/ui";

const REFRESH_MS = 15000;

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialMessage, setPartialMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const load = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true);
    if (silent || isRefresh) setSyncing(true);
    setErrorMessage(""); setPartialMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const [overviewRes, usersRes, docsRes, logsRes, healthRes] = await Promise.allSettled([getAdminOverview(token), getAdminUsers(token), getAdminDocuments(token), getAdminLogs(token), getAdminSystemHealth(token)]);
      let ok = 0; const failures: string[] = [];
      if (overviewRes.status === "fulfilled") { ok++; setMetrics((overviewRes.value as any).metrics ?? (overviewRes.value as any)); } else failures.push("overview");
      if (usersRes.status === "fulfilled") { ok++; const d = usersRes.value as any; setUsers(Array.isArray(d) ? d : d?.users || []); } else failures.push("users");
      if (docsRes.status === "fulfilled") { ok++; const d = docsRes.value as any; setDocs(Array.isArray(d) ? d : d?.documents || []); } else failures.push("documents");
      if (logsRes.status === "fulfilled") { ok++; const d = logsRes.value as any; setLogs(Array.isArray(d) ? d : d?.logs || []); } else failures.push("logs");
      if (healthRes.status === "fulfilled") { ok++; setHealth(((healthRes.value as any).health ?? (healthRes.value as any)) as SystemHealthData); } else failures.push("health");
      if (!ok) { const firstErr = [overviewRes, usersRes, docsRes, logsRes, healthRes].map((r) => r.status === "rejected" ? r.reason : null).find(Boolean); throw firstErr instanceof Error ? firstErr : new Error("Unable to load admin data."); }
      if (failures.length) setPartialMessage(`Partial data: ${failures.join(", ")} unavailable.`);
      setLastSync(new Date());
    } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load dashboard."); }
    finally { setLoading(false); setRefreshing(false); setTimeout(() => setSyncing(false), 350); }
  }, []);

  useEffect(() => { void load(false, false); }, [load]);
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (ui.autoSync) timerRef.current = setInterval(() => { void load(false, true); }, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [ui.autoSync, load]);

  const handleSignOut = async () => { setSettingsOpen(false); try { const token = await getAdminToken(); if (token) await logoutAdmin(token); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };
  const exportSummary = async () => { try { const subs = (health?.subscriptions||[]).map((s)=>`${s.name}: ${s.status}${s.expiresAt?` (expires ${s.expiresAt})`:""}`).join(" | "); await Share.share({ message: [`DocuGuard Admin Summary - ${new Date().toISOString()}`, `Users: ${metrics?.totalUsers ?? users.length}`, `Documents: ${metrics?.totalDocuments ?? docs.length}`, `Logs loaded: ${logs.length}`, `Azure OCR: ${health?.azureOcr?.status || "unknown"}`, `Subscriptions: ${subs || "n/a"}`, `Last sync: ${lastSync ? lastSync.toISOString() : "n/a"}`].join("\n"), title: "Admin Summary" }); } catch { Alert.alert("Export unavailable", "Could not share summary."); } };

  const analytics = useMemo(() => {
    const totalUsers = metrics?.totalUsers ?? users.length; const totalDocs = metrics?.totalDocuments ?? docs.length;
    const activeUsers = users.filter((u) => String(u.status || "active") === "active").length;
    const suspendedUsers = users.filter((u) => String(u.status) === "suspended").length;
    const ocrCompleted = docs.filter((d) => String(d.ocrStatus) === "completed").length;
    const ocrPending = docs.filter((d) => String(d.ocrStatus) === "pending").length;
    const ocrFailed = docs.filter((d) => !["completed", "pending", "unknown"].includes(String(d.ocrStatus))).length;
    const ocrRate = docs.length ? Math.round((ocrCompleted / docs.length) * 100) : 0;
    const nowMs = Date.now(); const dayMs = 86400000;
    const recentLogs = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && nowMs - t <= 7 * dayMs; });
    const critical24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return String(l.severity).toLowerCase() === "critical" && Number.isFinite(t) && nowMs - t <= dayMs; }).length;
    const warning24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return String(l.severity).toLowerCase() === "warning" && Number.isFinite(t) && nowMs - t <= dayMs; }).length;
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const last7 = Array.from({ length: 7 }, (_, idx) => { const i = 6 - idx; const d = new Date(nowMs - i * dayMs); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); const count = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && t >= start && t < start + dayMs; }).length; return { label: dayNames[d.getDay()], value: count }; });
    const categories = Object.entries(docs.reduce<Record<string, number>>((acc, d) => { const k = String((d as any).category || "other").toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((a,b) => b[1]-a[1]).slice(0,6);
    const riskLevel: "Low"|"Moderate"|"High" = critical24h > 0 ? "High" : warning24h > 2 || ocrFailed > 0 ? "Moderate" : "Low";
    const riskTone = riskLevel === "High" ? "danger" : riskLevel === "Moderate" ? "warning" : "success";
    const insights: string[] = [];
    if (ocrPending > 0) insights.push(`${ocrPending} document${ocrPending>1?"s":""} pending OCR.`);
    if (ocrFailed > 0) insights.push(`${ocrFailed} document${ocrFailed>1?"s":""} with OCR issues.`);
    if (critical24h > 0) insights.push(`${critical24h} critical event${critical24h>1?"s":""} in last 24h.`);
    if (!insights.length) insights.push("Operations stable based on loaded data.");
    return { totalUsers, totalDocs, activeUsers, suspendedUsers, ocrCompleted, ocrPending, ocrFailed, ocrRate, recentLogs, critical24h, warning24h, last7, categories, riskLevel, riskTone, insights };
  }, [metrics, users, docs, logs]);

  const serviceSummary = useMemo(() => {
    const subs = health?.subscriptions || [];
    const expiring = subs.filter((s) => s.status === "expiring_soon");
    const expired = subs.filter((s) => s.status === "expired");
    const azure = health?.azureOcr;
    return { subs, expiring, expired, azureStatus: String(azure?.status || "unknown"), azureIssue: azure?.issue || null };
  }, [health]);

  const syncMeta = useMemo(() => {
    if (syncing) return "Syncing live data…";
    if (!lastSync) return ui.autoSync ? "Auto-sync 15s · waiting for first sync" : "Sync paused";
    const ageSec = Math.max(0, Math.floor((now - lastSync.getTime()) / 1000));
    const age = ageSec < 5 ? "just now" : ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;
    if (!ui.autoSync) return `Sync paused · ${age}`;
    const nextIn = Math.max(0, 15 - (ageSec % 15));
    return `Auto-sync 15s · ${age} · next in ${nextIn}s`;
  }, [lastSync, now, ui.autoSync, syncing]);

  const attentionItems = useMemo(() => {
    const items: { tone: "danger" | "warning" | "info" | "success"; text: string; route?: string }[] = [];
    if (partialMessage) items.push({ tone: "warning", text: partialMessage });
    if (serviceSummary.azureStatus === "not_configured") items.push({ tone: "danger", text: "Azure OCR not detected on server. Configure credentials and redeploy API.", route: "/health" });
    else if (serviceSummary.azureStatus === "degraded") items.push({ tone: "warning", text: serviceSummary.azureIssue || "Azure OCR is degraded.", route: "/health" });
    if (serviceSummary.expired.length) items.push({ tone: "danger", text: `${serviceSummary.expired.length} service subscription${serviceSummary.expired.length>1?"s":""} expired. Renew now.`, route: "/health" });
    if (serviceSummary.expiring.length) items.push({ tone: "warning", text: `${serviceSummary.expiring.length} service subscription${serviceSummary.expiring.length>1?"s":""} expiring soon.`, route: "/health" });
    if (analytics.critical24h > 0) items.push({ tone: "danger", text: `${analytics.critical24h} critical security event${analytics.critical24h>1?"s":""} in last 24h.`, route: "/logs" });
    if (analytics.ocrFailed > 0) items.push({ tone: "warning", text: `${analytics.ocrFailed} document${analytics.ocrFailed>1?"s":""} with OCR issues.`, route: "/documents" });
    if (analytics.suspendedUsers > 0) items.push({ tone: "info", text: `${analytics.suspendedUsers} suspended user account${analytics.suspendedUsers>1?"s":""}.`, route: "/users" });
    if (analytics.ocrPending > 10) items.push({ tone: "info", text: `${analytics.ocrPending} documents pending OCR backlog.`, route: "/documents" });
    if (!items.length) items.push({ tone: "success", text: "No urgent issues detected. Services, OCR, and security signals look stable." });
    return items;
  }, [partialMessage, serviceSummary, analytics]);

  const gap = ui.compactMode ? 10 : 14;
  const quickActions = [{ label: "Users", icon: "people-outline" as const, route: "/users" }, { label: "Documents", icon: "folder-open-outline" as const, route: "/documents" }, { label: "Logs", icon: "shield-checkmark-outline" as const, route: "/logs" }, { label: "Health", icon: "pulse-outline" as const, route: "/health" }];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <SyncLine syncing={syncing} />
        <View style={[styles.header, { paddingBottom: ui.compactMode ? 6 : 10 }]}>
          <View style={{ flex: 1 }}>
            <SyncBanner text={syncMeta} syncing={syncing} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportSummary} label="Export" /><IconButton icon="refresh-outline" onPress={() => void load(true)} label="Refresh" spinning={syncing} /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { gap }]} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={AdminColors.primary} />}>
          {loading && !metrics && users.length === 0 && docs.length === 0 && logs.length === 0 ? <SkeletonScreen /> : errorMessage && users.length === 0 && docs.length === 0 ? (
            <Card><Text style={styles.errorTitle}>Unable to load dashboard</Text><Text style={styles.muted}>{errorMessage}</Text><PressableScale style={styles.retryBtn} onPress={() => void load()}><Text style={styles.retryText}>Try again</Text></PressableScale></Card>
          ) : (
            <>
              {ui.privacyMode && <FadeInView><View style={styles.privacyBanner}><Ionicons name="shield-checkmark-outline" size={14} color={AdminColors.primary} /><Text style={styles.privacyBannerText}>Privacy mode on: personal identifiers masked. Admins cannot access user document contents.</Text></View></FadeInView>}

              <Card title="Needs attention" subtitle="Actionable signals across services, security, OCR, and users">
                <View style={{ gap: 10 }}>
                  {attentionItems.map((item, i) => {
                    const icon = item.tone === "danger" ? "alert-circle" : item.tone === "warning" ? "warning" : item.tone === "success" ? "checkmark-circle" : "information-circle";
                    const color = item.tone === "danger" ? AdminColors.danger : item.tone === "warning" ? AdminColors.warning : item.tone === "success" ? AdminColors.success : AdminColors.info;
                    const content = (<View style={styles.attentionRow}><Ionicons name={icon as any} size={16} color={color} /><Text style={styles.attentionText}>{item.text}</Text>{item.route ? <Ionicons name="chevron-forward" size={14} color={AdminColors.textMuted} /> : null}</View>);
                    return item.route ? <PressableScale key={i} onPress={() => router.push(item.route as any)}>{content}</PressableScale> : <View key={i}>{content}</View>;
                  })}
                </View>
              </Card>
              <View style={[styles.row, { gap: ui.compactMode ? 8 : 12 }]}><StatCard label="Total Users" value={analytics.totalUsers} icon="people-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={`${analytics.activeUsers} active · ${analytics.suspendedUsers} suspended`} delay={40} /><StatCard label="Documents" value={analytics.totalDocs} icon="folder-open-outline" color={AdminColors.chart4} bg="#F3EEFF" hint={`${analytics.ocrRate}% OCR`} delay={80} /></View>
              <View style={[styles.row, { gap: ui.compactMode ? 8 : 12 }]}><StatCard label="OCR Backlog" value={analytics.ocrPending} icon="scan-outline" color={AdminColors.warning} bg={AdminColors.warningSoft} hint={`${analytics.ocrCompleted} done`} delay={120} /><StatCard label="Events (7d)" value={analytics.recentLogs.length} icon="pulse-outline" color={AdminColors.success} bg={AdminColors.successSoft} hint={`${analytics.critical24h} critical`} delay={160} /></View>

              <Card title="Services & subscriptions" subtitle="OCR status and paid service renewals" right={<PressableScale onPress={() => router.push("/health" as any)}><Text style={styles.link}>Details</Text></PressableScale>}>
                <View style={{ gap: 10 }}>
                  <View style={styles.serviceLine}><View style={{ flex: 1 }}><Text style={styles.serviceName}>Azure Document Intelligence (OCR)</Text><Text style={styles.serviceMeta}>{serviceSummary.azureIssue || (serviceSummary.azureStatus === "operational" ? "Configured and operational" : serviceSummary.azureStatus === "not_configured" ? "Not detected on server env" : "Check configuration/status")}</Text></View><Badge label={serviceSummary.azureStatus.replace("_"," ")} tone={serviceSummary.azureStatus==="operational"?"success":serviceSummary.azureStatus==="not_configured"?"danger":"warning"} /></View>
                  {(serviceSummary.expired.length > 0 || serviceSummary.expiring.length > 0) ? (
                    <View style={styles.alertBox}><Ionicons name="alert-circle-outline" size={16} color={AdminColors.warning} /><Text style={styles.alertText}>{serviceSummary.expired.length} expired, {serviceSummary.expiring.length} expiring soon. Review renewals in Health.</Text></View>
                  ) : serviceSummary.subs.length ? <Text style={styles.muted}>No subscriptions expiring soon. {serviceSummary.subs.filter((s)=>!s.expiresAt).length} service(s) need renewal dates set on server.</Text> : <Text style={styles.muted}>Subscription data unavailable.</Text>}
                  {serviceSummary.subs.slice(0,3).map((s) => {
                    const due = s.daysUntilExpiry == null ? "date not set" : s.daysUntilExpiry < 0 ? `${Math.abs(s.daysUntilExpiry)}d overdue` : `${s.daysUntilExpiry}d left`;
                    const tone = s.status === "active" ? "success" : s.status === "expiring_soon" ? "warning" : s.status === "expired" ? "danger" : "neutral";
                    return <View key={s.id} style={styles.subMini}><Text style={styles.subMiniName} numberOfLines={1}>{s.name}</Text><Text style={styles.subMiniMeta}>{s.renewBy ? `Renew by ${new Date(s.renewBy).toLocaleDateString()}` : "Renewal date not set"} · {due}</Text><Badge label={s.status.replace("_"," ")} tone={tone as any} /></View>;
                  })}
                </View>
              </Card>

              <Card title="Security posture"><View style={styles.riskHeader}><Text style={styles.riskLabel}>Risk level</Text><Badge label={analytics.riskLevel} tone={analytics.riskTone as any} /></View>{ui.showInsights && <View style={styles.insights}>{analytics.insights.map((ins, i) => (<View key={i} style={styles.insightRow}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{ins}</Text></View>))}</View>}</Card>
              <Card title="Audit activity (7 days)">{logs.length ? <BarChart data={analytics.last7} height={110} /> : <Text style={styles.muted}>No log data.</Text>}</Card>
              <Card title="Categories">{analytics.categories.length ? <BreakdownList segments={analytics.categories.map(([label, value], i) => ({ label: label.charAt(0).toUpperCase()+label.slice(1), value, color: [AdminColors.chart1,AdminColors.chart2,AdminColors.chart3,AdminColors.chart4,AdminColors.chart5,AdminColors.chart6][i%6] }))} /> : <Text style={styles.muted}>No category data.</Text>}</Card>
              <Card title="OCR pipeline">{docs.length ? <><BreakdownList segments={[{ label: "Completed", value: analytics.ocrCompleted, color: AdminColors.success }, { label: "Pending", value: analytics.ocrPending, color: AdminColors.warning }, { label: "Failed/Other", value: analytics.ocrFailed, color: AdminColors.danger }]} /><View style={{ marginTop: 12, gap: 6 }}><View style={styles.progressLabelRow}><Text style={styles.progressLabel}>Completion</Text><Text style={styles.progressPct}>{analytics.ocrRate}%</Text></View><ProgressBar value={analytics.ocrRate} color={AdminColors.success} /></View></> : <Text style={styles.muted}>No document data.</Text>}</Card>
              <Text style={styles.sectionTitle}>Quick actions</Text>
              <View style={styles.quickGrid}>{quickActions.map((a, idx) => (<PressableScale key={a.route} style={styles.actionCard} onPress={() => router.push(a.route as any)}><View style={styles.actionIcon}><Ionicons name={a.icon} size={18} color={AdminColors.primary} /></View><Text style={styles.actionLabel}>{a.label}</Text><Ionicons name="chevron-forward" size={16} color={AdminColors.textMuted} /></PressableScale>))}</View>
            </>
          )}
        </ScrollView>
        <AdminBottomNav />
      </View>
      <AdminSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} ui={ui} lastSync={lastSync} syncing={syncing} onSyncNow={() => void load(false, true)} onSignOut={handleSignOut} extra={<View><PressableScale style={styles.settingAction} onPress={() => { setSettingsOpen(false); exportSummary(); }}><Ionicons name="share-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Export dashboard summary</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => { setSettingsOpen(false); router.push("/health" as any); }}><Ionicons name="card-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Open subscriptions & service health</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => { setSettingsOpen(false); setAdminUiSettings({ compactMode: !ui.compactMode }); }}><Ionicons name="resize-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Toggle compact layout</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => setAdminUiSettings({ privacyMode: !ui.privacyMode })}><Ionicons name="eye-off-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>{ui.privacyMode ? "Disable privacy masking" : "Enable privacy masking"}</Text></PressableScale></View>} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background }, screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  brandSub: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 1 },
  scroll: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 110 }, row: { flexDirection: "row" },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 }, errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  partialRow: { flexDirection: "row", alignItems: "center", gap: 6 }, partialTitle: { fontSize: 13, fontWeight: "600", color: AdminColors.warningText },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm }, retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  privacyBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, backgroundColor: AdminColors.primarySoft, borderWidth: 1, borderColor: "#BFDBFE" }, privacyBannerText: { flex: 1, fontSize: 12, color: AdminColors.primaryDark, lineHeight: 17 },
  attentionRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 }, attentionText: { flex: 1, fontSize: 13, color: AdminColors.text, lineHeight: 18 },
  riskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }, riskLabel: { fontSize: 14, fontWeight: "700", color: AdminColors.text },
  insights: { gap: 8, borderTopWidth: 1, borderTopColor: AdminColors.border, paddingTop: 10 }, insightRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" }, insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between" }, progressLabel: { fontSize: 12, color: AdminColors.textSecondary }, progressPct: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: AdminColors.text },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCard: { width: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 12 },
  actionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: AdminColors.primarySoft }, actionLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: AdminColors.text },
  link: { fontSize: 13, fontWeight: "700", color: AdminColors.primary },
  serviceLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, serviceName: { fontSize: 14, fontWeight: "700", color: AdminColors.text }, serviceMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2, lineHeight: 17 },
  alertBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 10, backgroundColor: AdminColors.warningSoft }, alertText: { flex: 1, fontSize: 12, color: AdminColors.warningText, lineHeight: 17 },
  subMini: { paddingTop: 10, borderTopWidth: 1, borderTopColor: AdminColors.border, gap: 4 }, subMiniName: { fontSize: 13, fontWeight: "700", color: AdminColors.text }, subMiniMeta: { fontSize: 12, color: AdminColors.textSecondary },
  settingAction: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: AdminColors.border }, settingActionText: { fontSize: 14, color: AdminColors.text, fontWeight: "500" },
});
