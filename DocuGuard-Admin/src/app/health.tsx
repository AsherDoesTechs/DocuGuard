import React, { useCallback, useEffect, useMemo, useState } from "react";
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

  const fetchHealth = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminSystemHealth(token);
      setHealth(((data as any).health ?? (data as any)) as SystemHealthData);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load health metrics.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchHealth(); }, [fetchHealth]);

  const analytics = useMemo(() => {
    if (!health) return null;
    const dbOk = health.database?.status === "connected";
    const storageOk = health.supabaseStorage?.status === "operational";
    const ocrOk = health.azureOcr?.status === "operational";
    const score = [dbOk, storageOk, ocrOk].filter(Boolean).length;
    const healthScore = Math.round((score / 3) * 100);
    const ocrRate = Number(health.azureOcr?.successRate24h ?? 0);
    const queue = Number(health.azureOcr?.pendingQueueCount ?? 0);
    const latency = Number(health.database?.latencyMs ?? 0);
    const risk: "Low"|"Moderate"|"High" = !dbOk || !storageOk ? "High" : !ocrOk || queue > 20 || ocrRate < 80 ? "Moderate" : "Low";
    const prediction = !dbOk ? "Database connectivity issue — operations may be impacted." : !storageOk ? "Storage degraded — uploads/downloads may be affected." : queue > 20 ? `OCR queue elevated (${queue}). Expect slower processing.` : latency > 500 ? `DB latency high (${latency}ms).` : "Infrastructure signals stable.";
    return { dbOk, storageOk, ocrOk, healthScore, ocrRate, queue, latency, risk, prediction };
  }, [health]);

  const formatBytes = (bytes: number) => { if (!bytes || bytes <= 0) return "0 MB"; const mb = bytes / (1024 * 1024); return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`; };
  const statusTone = (ok: boolean) => (ok ? "success" : "danger");

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="System Health" subtitle="Infrastructure & predictions" right={<IconButton icon="refresh-outline" onPress={() => void fetchHealth()} />} />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Running diagnostics…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Diagnostics failed</Text><Text style={styles.muted}>{errorMessage}</Text><Text style={styles.errorHint}>Check token, network, and that /admin/health is available on the server.</Text><Pressable style={styles.retryBtn} onPress={() => void fetchHealth()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : health && analytics ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchHealth(true)} tintColor={AdminColors.primary} />}>
            <View style={styles.row}>
              <StatCard label="Health Score" value={`${analytics.healthScore}%`} icon="fitness-outline" color={analytics.healthScore === 100 ? AdminColors.success : AdminColors.warning} bg={analytics.healthScore === 100 ? AdminColors.successSoft : AdminColors.warningSoft} />
              <StatCard label="OCR 24h" value={`${analytics.ocrRate}%`} icon="scan-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={`${analytics.queue} queued`} />
            </View>

            <Card title="Prediction & Risk" subtitle="Derived from live service signals">
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Operational risk</Text>
                <Badge label={analytics.risk} tone={analytics.risk === "High" ? "danger" : analytics.risk === "Moderate" ? "warning" : "success"} />
              </View>
              <View style={{ gap: 8 }}>
                <View style={styles.mRow}><Text style={styles.mLabel}>Service availability</Text><Text style={styles.mVal}>{analytics.healthScore}%</Text></View>
                <ProgressBar value={analytics.healthScore} color={analytics.healthScore === 100 ? AdminColors.success : AdminColors.warning} />
                <View style={styles.mRow}><Text style={styles.mLabel}>OCR success (24h)</Text><Text style={styles.mVal}>{analytics.ocrRate}%</Text></View>
                <ProgressBar value={analytics.ocrRate} color={analytics.ocrRate >= 90 ? AdminColors.success : AdminColors.warning} />
              </View>
              <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
            </Card>

            <Card title="Services" subtitle={`Last checked: ${health.lastChecked ? new Date(health.lastChecked).toLocaleString() : "—"}`}>
              <View style={{ gap: 12 }}>
                <View style={styles.serviceRow}>
                  <View style={[styles.sIcon, { backgroundColor: analytics.dbOk ? AdminColors.successSoft : AdminColors.dangerSoft }]}><Ionicons name="server-outline" size={18} color={analytics.dbOk ? AdminColors.success : AdminColors.danger} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.sTitle}>Database</Text><Text style={styles.sMeta}>Latency {analytics.latency} ms</Text></View>
                  <Badge label={String(health.database?.status || "unknown")} tone={statusTone(analytics.dbOk) as any} />
                </View>
                <View style={styles.serviceRow}>
                  <View style={[styles.sIcon, { backgroundColor: analytics.storageOk ? AdminColors.successSoft : AdminColors.warningSoft }]}><Ionicons name="cloud-outline" size={18} color={analytics.storageOk ? AdminColors.success : AdminColors.warning} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.sTitle}>Supabase Storage</Text><Text style={styles.sMeta}>{health.supabaseStorage?.totalFiles ?? 0} files · {formatBytes(Number(health.supabaseStorage?.bucketUsageBytes || 0))}</Text></View>
                  <Badge label={String(health.supabaseStorage?.status || "unknown")} tone={(analytics.storageOk ? "success" : "warning") as any} />
                </View>
                <View style={styles.serviceRow}>
                  <View style={[styles.sIcon, { backgroundColor: analytics.ocrOk ? AdminColors.successSoft : AdminColors.warningSoft }]}><Ionicons name="scan-outline" size={18} color={analytics.ocrOk ? AdminColors.success : AdminColors.warning} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.sTitle}>Azure OCR</Text><Text style={styles.sMeta}>{analytics.queue} pending · {analytics.ocrRate}% success (24h)</Text></View>
                  <Badge label={String(health.azureOcr?.status || "unknown")} tone={(analytics.ocrOk ? "success" : "warning") as any} />
                </View>
              </View>
            </Card>

            <Card title="System Summary">
              <Text style={styles.summaryText}>Overall status: <Text style={{ fontWeight: "700", color: AdminColors.text }}>{String(health.status || "unknown").toUpperCase()}</Text></Text>
              <Text style={styles.summaryText}>Uptime: <Text style={{ fontWeight: "700", color: AdminColors.text }}>{health.uptime || "—"}</Text></Text>
              <Text style={styles.summaryHint}>Analytics and predictions are computed from currently available admin telemetry.</Text>
            </Card>
          </ScrollView>
        ) : null}

        <AdminBottomNav />
      </View>
    </SafeAreaView>
  );
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
  errorHint: { fontSize: 12, color: AdminColors.textMuted, marginTop: 6, lineHeight: 17 },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  mRow: { flexDirection: "row", justifyContent: "space-between" },
  mLabel: { fontSize: 12, color: AdminColors.textSecondary },
  mVal: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  insight: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sTitle: { fontSize: 14, fontWeight: "700", color: AdminColors.text },
  sMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  summaryText: { fontSize: 14, color: AdminColors.textSecondary, marginBottom: 6 },
  summaryHint: { fontSize: 12, color: AdminColors.textMuted, marginTop: 6, lineHeight: 17 },
});
