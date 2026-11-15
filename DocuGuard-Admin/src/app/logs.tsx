import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminLogs, type AuditLogEntry } from "../services/adminApi";
import { getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BarChart, BreakdownList, Card, IconButton, ScreenHeader, StatCard } from "../components/ui";

type SevFilter = "all" | "info" | "warning" | "critical";

export default function AdminLogsScreen() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<SevFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchLogs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminLogs(token);
      const list = Array.isArray(data) ? data : (data as any)?.logs || [];
      setLogs(list as AuditLogEntry[]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load logs.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  const analytics = useMemo(() => {
    const now = Date.now(); const dayMs = 86400000;
    const info = logs.filter((l) => String(l.severity) === "info").length;
    const warning = logs.filter((l) => String(l.severity) === "warning").length;
    const critical = logs.filter((l) => String(l.severity) === "critical").length;
    const last24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && now - t <= dayMs; }).length;
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const trend = Array.from({ length: 7 }, (_, idx) => {
      const i = 6 - idx; const d = new Date(now - i * dayMs);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const count = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && t >= start && t < start + dayMs; }).length;
      return { label: dayNames[d.getDay()], value: count };
    });
    const risk: "Low"|"Moderate"|"High" = critical > 0 ? "High" : warning >= 5 ? "Moderate" : "Low";
    const prediction = critical > 0 ? `${critical} critical event${critical>1?"s":""} — investigate immediately.` : warning > 0 ? `${warning} warning${warning>1?"s":""} — monitor for escalation.` : "No critical/warning patterns detected.";
    return { info, warning, critical, last24h, trend, risk, prediction };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((l) => {
      const sev = String(l.severity || "info");
      if (filter !== "all" && sev !== filter) return false;
      if (!q) return true;
      const details = typeof l.details === "string" ? l.details : JSON.stringify(l.details || "");
      return [l.action, l.actor, details, l.ipAddress].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [logs, searchQuery, filter]);

  const filters: { key: SevFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "critical", label: "Critical" }, { key: "warning", label: "Warning" }, { key: "info", label: "Info" }];

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const sev = String(item.severity || "info");
    const tone = sev === "critical" ? "danger" : sev === "warning" ? "warning" : "info";
    const icon = sev === "critical" ? "alert-circle" : sev === "warning" ? "warning" : "information-circle";
    const details = typeof item.details === "string" ? item.details : item.details ? JSON.stringify(item.details, null, 2) : "No details";
    return (
      <Pressable style={styles.logCard} onPress={() => Alert.alert("Audit Log", `Action: ${item.action}\nActor: ${item.actor}\nSeverity: ${sev.toUpperCase()}\nTime: ${item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}\nIP: ${item.ipAddress || "N/A"}\n\n${details}`, [{ text: "Close" }])}>
        <View style={[styles.iconBox, { backgroundColor: sev === "critical" ? AdminColors.dangerSoft : sev === "warning" ? AdminColors.warningSoft : AdminColors.infoSoft }]}>
          <Ionicons name={icon as any} size={18} color={sev === "critical" ? AdminColors.danger : sev === "warning" ? AdminColors.warning : AdminColors.info} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowBetween}><Text style={styles.action} numberOfLines={1}>{item.action || "Event"}</Text><Badge label={sev} tone={tone as any} /></View>
          <Text style={styles.meta} numberOfLines={1}>{item.actor || "Unknown"}{item.ipAddress ? ` · ${item.ipAddress}` : ""}</Text>
          <Text style={styles.time} numberOfLines={1}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Security Logs" subtitle={`${logs.length} events`} right={<IconButton icon="refresh-outline" onPress={() => void fetchLogs()} />} />
        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading logs…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Could not load logs</Text><Text style={styles.muted}>{errorMessage}</Text><Text style={styles.errorHint}>If server says audit log unavailable, ensure audit_log table exists and server is updated.</Text><Pressable style={styles.retryBtn} onPress={() => void fetchLogs()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : (
          <FlatList
            data={filteredLogs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchLogs(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={
              <View style={{ gap: 14, marginBottom: 4 }}>
                <View style={styles.statsRow}><StatCard label="24h Events" value={analytics.last24h} icon="time-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} /><StatCard label="Critical" value={analytics.critical} icon="alert-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} /></View>
                <Card title="Risk Prediction" subtitle="Signal from log severity">
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}><Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Current risk</Text><Badge label={analytics.risk} tone={analytics.risk === "High" ? "danger" : analytics.risk === "Moderate" ? "warning" : "success"} /></View>
                  <BreakdownList segments={[{ label: "Info", value: analytics.info, color: AdminColors.info }, { label: "Warning", value: analytics.warning, color: AdminColors.warning }, { label: "Critical", value: analytics.critical, color: AdminColors.danger }]} />
                  <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
                </Card>
                <Card title="7-Day Activity" subtitle="Event volume trend">{logs.length ? <BarChart data={analytics.trend} height={120} /> : <Text style={styles.muted}>No trend data.</Text>}</Card>
                <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search action, actor, details" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}</View>
                <View style={styles.chips}>{filters.map((f) => (<Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}><Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
                <Text style={styles.sectionMeta}>{filteredLogs.length} result{filteredLogs.length === 1 ? "" : "s"}</Text>
              </View>
            }
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="shield-checkmark-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No logs match.</Text></View>}
          />
        )}
        <AdminBottomNav />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background },
  screen: { flex: 1 },
  listFlex: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  statsRow: { flexDirection: "row", gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 },
  errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  errorHint: { fontSize: 12, color: AdminColors.textMuted, marginTop: 6, lineHeight: 17 },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: AdminColors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: AdminRadii.sm },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: 14, paddingHorizontal: 14, height: 46 },
  searchInput: { flex: 1, fontSize: 14, color: AdminColors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: AdminRadii.pill, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border },
  chipActive: { backgroundColor: AdminColors.primary, borderColor: AdminColors.primary },
  chipText: { fontSize: 12, fontWeight: "600", color: AdminColors.textSecondary },
  chipTextActive: { color: "#fff" },
  sectionMeta: { fontSize: 12, color: AdminColors.textMuted, fontWeight: "600" },
  logCard: { flexDirection: "row", gap: 12, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 14 },
  iconBox: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 8 },
  action: { flex: 1, fontSize: 14, fontWeight: "700", color: AdminColors.text },
  meta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 3 },
  time: { fontSize: 11, color: AdminColors.textMuted, marginTop: 2 },
  insight: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
});
