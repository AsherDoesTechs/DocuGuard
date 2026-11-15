import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminSystemHealth, type SystemHealthData } from "../services/adminApi";
import { getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, Card, IconButton, ProgressBar, ScreenHeader, StatCard } from "../components/ui";

export default function AdminHealthScreen() {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminSystemHealth(token);
      setHealth(((data as any).health ?? (data as any)) as SystemHealthData);
      setLastUpdated(new Date());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load health metrics.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchHealth(); }, [fetchHealth]);

  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh) {
      timerRef.current = setInterval(() => { void fetchHealth(true); }, 30000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchHealth]);

  const analytics = useMemo(() => {
    if (!health) return null;
    const dbOk = health.database?.status === "connected";
    const storageOk = String(health.supabaseStorage?.status || "").toLowerCase() === "operational";
    const ocrStatus = String(health.azureOcr?.status || "").toLowerCase();
    const ocrOk = ocrStatus === "operational";
    const score = [dbOk, storageOk, ocrOk || ocrStatus === "unknown"].filter(Boolean).length;
    const healthScore = Math.round((score / 3) * 100);
    const ocrRate = Number(health.azureOcr?.successRate24h ?? 0);
    const queue = Number(health.azureOcr?.pendingQueueCount ?? 0);
    const latency = Number(health.database?.latencyMs ?? 0);
    const risk: "Low" | "Moderate" | "High" = !dbOk ? "High" : !storageOk || queue > 20 || (ocrOk && ocrRate < 80) ? "Moderate" : "Low";
    const recommendations: string[] = [];
    if (!dbOk) recommendations.push("Database unreachable — check DB connectivity and credentials.");
    if (!storageOk) recommendations.push("Storage not fully operational — verify Supabase/storage config.");
    if (queue > 20) recommendations.push("OCR queue elevated — monitor processing throughput.");
    if (latency > 500) recommendations.push("High DB latency — investigate database load/network.");
    if (ocrStatus === "unknown") recommendations.push("OCR telemetry unavailable in current schema/config.");
    if (!recommendations.length) recommendations.push("All monitored services appear healthy.");
    const prediction = recommendations[0];
    return { dbOk, storageOk, ocrOk, ocrStatus, healthScore, ocrRate, queue, latency, risk, prediction, recommendations };
  }, [health]);

  const formatBytes = (bytes: number) => { if (!bytes || bytes <= 0) return "0 MB"; const mb = bytes / (1024 * 1024); return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`; };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader
          title="System Health"
          subtitle={lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Infrastructure diagnostics"}
          right={
            <View style={{ flexDirection: "row", gap: 8 }}>
              <IconButton icon={autoRefresh ? "pause-outline" : "play-outline"} onPress={() => setAutoRefresh((v) => !v)} label="Auto refresh" tone={autoRefresh ? "primary" : "default"} />
              <IconButton icon="refresh-outline" onPress={() => void fetchHealth(true)} label="Refresh" />
            </View>
          }
        />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Running diagnostics…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Diagnostics failed</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchHealth()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : health && analytics ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchHealth(true)} tintColor={AdminColors.primary} />}>
            <View style={styles.autoRow}>
              <View style={[styles.dot, { backgroundColor: autoRefresh ? AdminColors.success : AdminColors.textMuted }]} />
              <Text style={styles.autoText}>{autoRefresh ? "Auto-refresh on (30s)" : "Auto-refresh off"}</Text>
              <Pressable onPress={() => setAutoRefresh((v) => !v)}><Text style={styles.link}>{autoRefresh ? "Pause" : "Enable"}</Text></Pressable>
            </View>

            <View style={styles.row}>
              <StatCard label="Health Score" value={`${analytics.healthScore}%`} icon="fitness-outline" color={analytics.healthScore === 100 ? AdminColors.success : AdminColors.warning} bg={analytics.healthScore === 100 ? AdminColors.successSoft : AdminColors.warningSoft} />
              <StatCard label="DB Latency" value={`${analytics.latency}ms`} icon="speedometer-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={health.database?.status || "—"} />
            </View>

            <Card title="Operational status" subtitle="Risk & recommendations">
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Risk level</Text>
                <Badge label={analytics.risk} tone={analytics.risk === "High" ? "danger" : analytics.risk === "Moderate" ? "warning" : "success"} />
              </View>
              <View style={{ gap: 8 }}>
                <View style={styles.mRow}><Text style={styles.mLabel}>Service availability</Text><Text style={styles.mVal}>{analytics.healthScore}%</Text></View>
                <ProgressBar value={analytics.healthScore} color={analytics.healthScore >= 90 ? AdminColors.success : AdminColors.warning} />
                <View style={styles.mRow}><Text style={styles.mLabel}>OCR success (24h)</Text><Text style={styles.mVal}>{analytics.ocrRate}%</Text></View>
                <ProgressBar value={analytics.ocrRate} color={analytics.ocrRate >= 90 ? AdminColors.success : AdminColors.warning} />
              </View>
              <View style={styles.insights}>
                {analytics.recommendations.map((r, i) => (
                  <View key={i} style={styles.insight}><Ionicons name={i === 0 ? "sparkles-outline" : "checkmark-circle-outline"} size={14} color={i === 0 ? AdminColors.primary : AdminColors.success} /><Text style={styles.insightText}>{r}</Text></View>
                ))}
              </View>
            </Card>

            <Card title="Services" subtitle={`Last checked: ${health.lastChecked ? new Date(health.lastChecked).toLocaleString() : "—"}`}>
              <View style={{ gap: 12 }}>
                <ServiceRow icon="server-outline" title="Database" meta={`Latency ${analytics.latency} ms`} status={String(health.database?.status || "unknown")} ok={analytics.dbOk} />
                <ServiceRow icon="cloud-outline" title="Supabase Storage" meta={`${health.supabaseStorage?.totalFiles ?? 0} files · ${formatBytes(Number(health.supabaseStorage?.bucketUsageBytes || 0))}`} status={String(health.supabaseStorage?.status || "unknown")} ok={analytics.storageOk} />
                <ServiceRow icon="scan-outline" title="Azure OCR" meta={`${analytics.queue} pending · ${analytics.ocrRate}% success (24h)`} status={String(health.azureOcr?.status || "unknown")} ok={analytics.ocrOk} warn={analytics.ocrStatus === "unknown"} />
              </View>
            </Card>

            <Card title="System summary">
              <SummaryRow label="Overall status" value={String(health.status || "unknown").toUpperCase()} />
              <SummaryRow label="Uptime" value={health.uptime || "—"} />
              <SummaryRow label="OCR queue" value={String(analytics.queue)} />
              <SummaryRow label="Documents indexed" value={String(health.supabaseStorage?.totalFiles ?? 0)} />
              <Text style={styles.summaryHint}>Health metrics and recommendations are derived from available admin telemetry.</Text>
            </Card>
          </ScrollView>
        ) : null}

        <AdminBottomNav />
      </View>
    </SafeAreaView>
  );
}

function ServiceRow({ icon, title, meta, status, ok, warn }: { icon: any; title: string; meta: string; status: string; ok: boolean; warn?: boolean }) {
  const tone = ok ? "success" : warn ? "neutral" : "warning";
  const color = ok ? AdminColors.success : warn ? AdminColors.textSecondary : AdminColors.warning;
  const bg = ok ? AdminColors.successSoft : warn ? AdminColors.surfaceAlt : AdminColors.warningSoft;
  return (
    <View style={styles.serviceRow}>
      <View style={[styles.sIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={18} color={color} /></View>
      <View style={{ flex: 1 }}><Text style={styles.sTitle}>{title}</Text><Text style={styles.sMeta}>{meta}</Text></View>
      <Badge label={status} tone={tone as any} />
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background },
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  row: { flexDirection: "row", gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 },
  errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  autoRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  autoText: { flex: 1, fontSize: 12, color: AdminColors.textSecondary },
  link: { fontSize: 12, fontWeight: "700", color: AdminColors.primary },
  mRow: { flexDirection: "row", justifyContent: "space-between" },
  mLabel: { fontSize: 12, color: AdminColors.textSecondary },
  mVal: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  insights: { gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border },
  insight: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sTitle: { fontSize: 14, fontWeight: "700", color: AdminColors.text },
  sMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
  summaryLabel: { fontSize: 13, color: AdminColors.textSecondary },
  summaryValue: { fontSize: 13, fontWeight: "700", color: AdminColors.text },
  summaryHint: { fontSize: 12, color: AdminColors.textMuted, marginTop: 10, lineHeight: 17 },
});
