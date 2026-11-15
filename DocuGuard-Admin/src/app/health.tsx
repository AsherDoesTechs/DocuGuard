import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminSystemHealth, logoutAdmin, type SystemHealthData } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminSettingsModal } from "../components/AdminSettingsModal";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, Card, IconButton, ProgressBar, ScreenHeader, StatCard, SkeletonScreen } from "../components/ui";

const REFRESH_MS = 15000;

export default function AdminHealthScreen() {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);
  const fetchHealth = useCallback(async (isRefresh = false, silent = false) => { if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true); setErrorMessage(""); try { const token = await getAdminToken(); if (!token) { router.replace("/"); return; } const data = await getAdminSystemHealth(token); setHealth(((data as any).health ?? (data as any)) as SystemHealthData); setLastSync(new Date()); } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load health metrics."); } finally { setLoading(false); setRefreshing(false); } }, []);
  useEffect(() => { void fetchHealth(); }, [fetchHealth]);
  useEffect(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } if (ui.autoSync) timerRef.current = setInterval(() => { void fetchHealth(false, true); }, REFRESH_MS); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [ui.autoSync, fetchHealth]);

  const analytics = useMemo(() => {
    if (!health) return null;
    const dbOk = String(health.database?.status || "").toLowerCase() === "connected";
    const storageStatus = String(health.supabaseStorage?.status || "").toLowerCase();
    const storageOk = storageStatus === "operational";
    const ocrStatus = String(health.azureOcr?.status || "").toLowerCase();
    const ocrOk = ocrStatus === "operational";
    const score = [dbOk, storageOk || storageStatus === "unknown", ocrOk || ocrStatus === "configured" || ocrStatus === "unknown"].filter(Boolean).length;
    const healthScore = Math.round((score / 3) * 100);
    const ocrRate = Number(health.azureOcr?.successRate24h ?? 0);
    const queue = Number(health.azureOcr?.pendingQueueCount ?? 0);
    const latency = Number(health.database?.latencyMs ?? 0);
    const subs = health.subscriptions || [];
    const expiringSubs = subs.filter((s) => s.status === "expiring_soon").length;
    const expiredSubs = subs.filter((s) => s.status === "expired").length;
    const risk: "Low" | "Moderate" | "High" = !dbOk || expiredSubs > 0 ? "High" : !storageOk || queue > 20 || expiringSubs > 0 || ocrStatus === "not_configured" || ocrStatus === "degraded" ? "Moderate" : "Low";
    const recommendations: string[] = [];
    if (!dbOk) recommendations.push("Database unreachable — check connection/credentials.");
    if (storageStatus !== "operational" && storageStatus !== "unknown") recommendations.push("Storage degraded — verify Supabase storage config.");
    if (ocrStatus === "not_configured") recommendations.push("Azure OCR not detected: set AZURE_ENDPOINT/AZURE_KEY (or AZURE_DOCUMENT_INTELLIGENCE_*) on the API server and redeploy.");
    if (ocrStatus === "configured") recommendations.push("Azure credentials detected but OCR telemetry is limited by schema; verify OCR status tracking.");
    if (queue > 20) recommendations.push("OCR queue elevated — monitor processing throughput.");
    if (latency > 500) recommendations.push("High DB latency — investigate load/network.");
    if (expiredSubs > 0) recommendations.push(`${expiredSubs} service subscription${expiredSubs>1?"s":""} expired — renew immediately.`);
    if (expiringSubs > 0) recommendations.push(`${expiringSubs} service subscription${expiringSubs>1?"s":""} expiring soon.`);
    if (health.azureOcr?.issue) recommendations.push(`OCR: ${health.azureOcr.issue}`);
    if (!recommendations.length) recommendations.push("All monitored services appear healthy.");
    return { dbOk, storageOk, ocrOk, ocrStatus, healthScore, ocrRate, queue, latency, risk, recommendations, expiringSubs, expiredSubs };
  }, [health]);

  const fmtBytes = (bytes: number) => { if (!bytes || bytes <= 0) return "0 MB"; const mb = bytes / (1024 * 1024); return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`; };
  const signOut = async () => { setSettingsOpen(false); try { const t = await getAdminToken(); if (t) await logoutAdmin(t); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };
  const exportReport = async () => { try { await Share.share({ message: health ? JSON.stringify({ fetchedAt: new Date().toISOString(), health }, null, 2) : "No health data", title: "System Health Report" }); } catch { Alert.alert("Export unavailable", "Could not share report."); } };
  const gap = ui.compactMode ? 10 : 14;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top","left","right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="System Health" subtitle={`${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportReport} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchHealth(true)} label="Refresh" /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>} />
        {loading && !health ? <SkeletonScreen /> : errorMessage ? (<View style={{ paddingHorizontal: 20 }}><Card><Text style={styles.errorTitle}>Diagnostics failed</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchHealth()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>) : health && analytics ? (
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { gap }]} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchHealth(true)} tintColor={AdminColors.primary} />}>
            <View style={{ flexDirection: "row", gap: ui.compactMode ? 8 : 12 }}><StatCard label="Health Score" value={`${analytics.healthScore}%`} icon="fitness-outline" color={analytics.healthScore===100?AdminColors.success:AdminColors.warning} bg={analytics.healthScore===100?AdminColors.successSoft:AdminColors.warningSoft} /><StatCard label="DB Latency" value={`${analytics.latency}ms`} icon="speedometer-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={String(health.database?.status||"—")} /></View>
            <Card title="Operational status"><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Risk level</Text><Badge label={analytics.risk} tone={analytics.risk==="High"?"danger":analytics.risk==="Moderate"?"warning":"success"} /></View><View style={{ gap: 8 }}><View style={styles.mRow}><Text style={styles.mLabel}>Service availability</Text><Text style={styles.mVal}>{analytics.healthScore}%</Text></View><ProgressBar value={analytics.healthScore} color={analytics.healthScore>=90?AdminColors.success:AdminColors.warning} /><View style={styles.mRow}><Text style={styles.mLabel}>OCR success (24h)</Text><Text style={styles.mVal}>{analytics.ocrRate}%</Text></View><ProgressBar value={analytics.ocrRate} color={analytics.ocrRate>=90?AdminColors.success:AdminColors.warning} /></View>{ui.showInsights && <View style={styles.insights}>{analytics.recommendations.map((r,i)=>(<View key={i} style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{r}</Text></View>))}</View>}</Card>

            <Card title="Services" subtitle={`Last checked: ${health.lastChecked ? new Date(health.lastChecked).toLocaleString() : "—"}`}>
              <View style={{ gap: 12 }}>
                <ServiceRow icon="server-outline" title="Database" meta={`Latency ${analytics.latency} ms`} status={String(health.database?.status||"unknown")} ok={analytics.dbOk} />
                <ServiceRow icon="cloud-outline" title="Storage" meta={`${health.supabaseStorage?.totalFiles ?? 0} files · ${fmtBytes(Number(health.supabaseStorage?.bucketUsageBytes || 0))}`} status={String(health.supabaseStorage?.status||"unknown")} ok={analytics.storageOk} />
                <ServiceRow icon="scan-outline" title="Azure OCR" meta={`${analytics.queue} pending · ${analytics.ocrRate}% success · ${Number(health.azureOcr?.completedCount||0)} completed`} status={String(health.azureOcr?.status||"unknown")} ok={analytics.ocrOk} warn={analytics.ocrStatus==="configured" || analytics.ocrStatus==="unknown" || analytics.ocrStatus==="not_configured"} />
              </View>
            </Card>

            <Card title="Subscriptions & renewals" subtitle="Track service expiration and when to subscribe again">
              {(health.subscriptions || []).length ? <View style={{ gap: 10 }}>{(health.subscriptions || []).map((s) => {
                const st = String(s.status || "active");
                const tone = st === "active" ? "success" : st === "expiring_soon" ? "warning" : st === "expired" ? "danger" : "neutral";
                const exp = s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "Not set";
                const renew = s.renewBy ? new Date(s.renewBy).toLocaleDateString() : "Not set";
                const due = s.daysUntilExpiry == null ? "set renewal date on server env" : s.daysUntilExpiry < 0 ? `${Math.abs(s.daysUntilExpiry)}d overdue` : `${s.daysUntilExpiry}d left`;
                return (<View key={s.id} style={styles.subRow}><View style={{ flex: 1 }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}><Text style={styles.sTitle}>{s.name}</Text><Badge label={st.replace("_"," ")} tone={tone as any} /></View><Text style={styles.sMeta}>{s.provider} · {s.billing} · {s.purpose}</Text><Text style={styles.sMeta}>Expires: {exp} · Renew by: {renew} · {due}</Text>{s.note ? <Text style={styles.sNote}>{s.note}</Text> : null}</View></View>);
              })}</View> : <Text style={styles.muted}>No subscription data available.</Text>}
              <Text style={styles.summaryHint}>Set server env vars like AZURE_SUBSCRIPTION_EXPIRES_AT / *_RENEW_BY (ISO date) and *_BILLING_CYCLE to track renewals accurately.</Text>
            </Card>

            <Card title="Summary"><SummaryRow label="Overall status" value={String(health.status||"unknown").toUpperCase()} /><SummaryRow label="Uptime" value={String(health.uptime||"—")} /><SummaryRow label="OCR queue" value={String(analytics.queue)} /><SummaryRow label="OCR failed" value={String(Number(health.azureOcr?.failedCount||0))} /><SummaryRow label="Documents indexed" value={String(health.supabaseStorage?.totalFiles ?? 0)} /><Text style={styles.summaryHint}>Metrics derived from backend admin telemetry. Admins do not access user document contents.</Text></Card>
          </ScrollView>
        ) : null}
        <AdminBottomNav />
      </View>
      <AdminSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} ui={ui} lastSync={lastSync} onSyncNow={() => void fetchHealth(false, true)} onSignOut={signOut} extra={<View><Pressable style={styles.settingAction} onPress={() => { setSettingsOpen(false); exportReport(); }}><Ionicons name="share-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Export health report (JSON)</Text></Pressable><Pressable style={styles.settingAction} onPress={() => void fetchHealth(true)}><Ionicons name="refresh-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Run diagnostics refresh</Text></Pressable></View>} />
    </SafeAreaView>
  );
}

function ServiceRow({ icon, title, meta, status, ok, warn }: { icon: any; title: string; meta: string; status: string; ok: boolean; warn?: boolean }) { const tone = ok ? "success" : warn ? "neutral" : "warning"; const color = ok ? AdminColors.success : warn ? AdminColors.textSecondary : AdminColors.warning; const bg = ok ? AdminColors.successSoft : warn ? AdminColors.surfaceAlt : AdminColors.warningSoft; return <View style={styles.serviceRow}><View style={[styles.sIcon,{backgroundColor:bg}]}><Ionicons name={icon} size={18} color={color} /></View><View style={{ flex: 1 }}><Text style={styles.sTitle}>{title}</Text><Text style={styles.sMeta}>{meta}</Text></View><Badge label={status.replace("_"," ")} tone={tone as any} /></View>; }
function SummaryRow({ label, value }: { label: string; value: string }) { return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:AdminColors.background}, screen:{flex:1}, scroll:{flex:1}, content:{paddingHorizontal:20,paddingBottom:24},
  muted:{fontSize:13,color:AdminColors.textSecondary,lineHeight:19}, errorTitle:{fontSize:16,fontWeight:"700",color:AdminColors.dangerText,marginBottom:4},
  retryBtn:{alignSelf:"flex-start",marginTop:12,backgroundColor:AdminColors.primary,paddingHorizontal:14,paddingVertical:10,borderRadius:AdminRadii.sm}, retryText:{color:"#fff",fontWeight:"700",fontSize:13},
  mRow:{flexDirection:"row",justifyContent:"space-between"}, mLabel:{fontSize:12,color:AdminColors.textSecondary}, mVal:{fontSize:12,fontWeight:"700",color:AdminColors.text},
  insights:{gap:8,marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border}, insight:{flexDirection:"row",gap:8,alignItems:"flex-start"}, insightText:{flex:1,fontSize:13,color:AdminColors.textSecondary,lineHeight:18},
  serviceRow:{flexDirection:"row",alignItems:"center",gap:12}, sIcon:{width:40,height:40,borderRadius:12,alignItems:"center",justifyContent:"center"}, sTitle:{fontSize:14,fontWeight:"700",color:AdminColors.text}, sMeta:{fontSize:12,color:AdminColors.textSecondary,marginTop:2},
  subRow:{padding:12,borderWidth:1,borderColor:AdminColors.border,borderRadius:12,backgroundColor:AdminColors.surfaceAlt}, sNote:{fontSize:12,color:AdminColors.textSecondary,marginTop:4,lineHeight:17},
  summaryRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingVertical:8,borderBottomWidth:1,borderBottomColor:AdminColors.border}, summaryLabel:{fontSize:13,color:AdminColors.textSecondary}, summaryValue:{fontSize:13,fontWeight:"700",color:AdminColors.text}, summaryHint:{fontSize:12,color:AdminColors.textMuted,marginTop:10,lineHeight:17},
  settingAction:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:11,borderBottomWidth:1,borderBottomColor:AdminColors.border}, settingActionText:{fontSize:14,color:AdminColors.text,fontWeight:"500"},
});
