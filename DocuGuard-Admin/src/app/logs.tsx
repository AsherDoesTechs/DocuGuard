import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminLogs, type AuditLogEntry } from "../services/adminApi";
import { getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BarChart, BreakdownList, Card, IconButton, ScreenHeader, StatCard } from "../components/ui";

type SevFilter = "all" | "info" | "warning" | "critical";

function getSeverity(item: AuditLogEntry): "info" | "warning" | "critical" {
  const sev = String(item.severity || "info").toLowerCase();
  if (sev === "critical") return "critical";
  if (sev === "warning") return "warning";
  return "info";
}

export default function AdminLogsScreen() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<SevFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

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
    const info = logs.filter((l) => getSeverity(l) === "info").length;
    const warning = logs.filter((l) => getSeverity(l) === "warning").length;
    const critical = logs.filter((l) => getSeverity(l) === "critical").length;
    const last24h = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && now - t <= dayMs; }).length;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const trend = Array.from({ length: 7 }, (_, idx) => {
      const i = 6 - idx; const d = new Date(now - i * dayMs);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const count = logs.filter((l) => { const t = new Date(l.timestamp as any).getTime(); return Number.isFinite(t) && t >= start && t < start + dayMs; }).length;
      return { label: dayNames[d.getDay()], value: count };
    });
    const topActions = Object.entries(
      logs.reduce<Record<string, number>>((acc, l) => { const k = String(l.action || "event"); acc[k] = (acc[k] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const risk: "Low" | "Moderate" | "High" = critical > 0 ? "High" : warning >= 5 ? "Moderate" : "Low";
    const prediction = critical > 0
      ? `${critical} critical event${critical > 1 ? "s" : ""} require immediate review.`
      : warning > 0
        ? `${warning} warning${warning > 1 ? "s" : ""} detected — monitor for escalation.`
        : "No high-risk patterns detected.";
    return { info, warning, critical, last24h, trend, risk, prediction, topActions };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((l) => {
      const sev = getSeverity(l);
      if (filter !== "all" && sev !== filter) return false;
      if (!q) return true;
      const details = typeof l.details === "string" ? l.details : JSON.stringify(l.details || "");
      return [l.action, l.actor, details, l.ipAddress, l.id].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [logs, searchQuery, filter]);

  const exportLogs = async () => {
    try {
      const rows = [["id", "action", "actor", "severity", "ipAddress", "timestamp", "details"].join(",")];
      filteredLogs.forEach((l) => {
        const details = typeof l.details === "string" ? l.details : JSON.stringify(l.details || {});
        rows.push([l.id, l.action || "", l.actor || "", getSeverity(l), l.ipAddress || "", l.timestamp || "", details].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
      });
      await Share.share({ message: rows.join("\n"), title: "DocuGuard Security Logs Export" });
    } catch {
      Alert.alert("Export unavailable", "Could not share export on this device.");
    }
  };

  const filters: { key: SevFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "critical", label: "Critical" }, { key: "warning", label: "Warning" }, { key: "info", label: "Info" }];

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const sev = getSeverity(item);
    const tone = sev === "critical" ? "danger" : sev === "warning" ? "warning" : "info";
    const icon = sev === "critical" ? "alert-circle" : sev === "warning" ? "warning" : "information-circle";
    return (
      <Pressable style={styles.logCard} onPress={() => setSelected(item)}>
        <View style={[styles.iconBox, { backgroundColor: sev === "critical" ? AdminColors.dangerSoft : sev === "warning" ? AdminColors.warningSoft : AdminColors.infoSoft }]}>
          <Ionicons name={icon as any} size={18} color={sev === "critical" ? AdminColors.danger : sev === "warning" ? AdminColors.warning : AdminColors.info} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowBetween}><Text style={styles.action} numberOfLines={1}>{item.action || "Event"}</Text><Badge label={sev} tone={tone as any} /></View>
          <Text style={styles.meta} numberOfLines={1}>{item.actor || "system"}{item.ipAddress ? ` · ${item.ipAddress}` : ""}</Text>
          <Text style={styles.time} numberOfLines={1}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Security Logs" subtitle={`${logs.length} events`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportLogs} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchLogs()} label="Refresh" /></View>} />
        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading logs…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Could not load logs</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchLogs()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : (
          <FlatList
            data={filteredLogs}
            keyExtractor={(item, idx) => String(item.id ?? idx)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchLogs(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={
              <View style={{ gap: 14, marginBottom: 4 }}>
                <View style={styles.statsRow}><StatCard label="24h Events" value={analytics.last24h} icon="time-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} /><StatCard label="Critical" value={analytics.critical} icon="alert-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} /></View>
                <Card title="Risk assessment" subtitle="Severity distribution">
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}><Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Current risk</Text><Badge label={analytics.risk} tone={analytics.risk === "High" ? "danger" : analytics.risk === "Moderate" ? "warning" : "success"} /></View>
                  <BreakdownList segments={[{ label: "Info", value: analytics.info, color: AdminColors.info }, { label: "Warning", value: analytics.warning, color: AdminColors.warning }, { label: "Critical", value: analytics.critical, color: AdminColors.danger }]} />
                  {!!analytics.topActions.length && (
                    <View style={styles.topActions}><Text style={styles.topTitle}>Top actions</Text>{analytics.topActions.map(([name, count]) => (<View key={name} style={styles.topRow}><Text style={styles.topName} numberOfLines={1}>{name}</Text><Text style={styles.topCount}>{count}</Text></View>))}</View>
                  )}
                  <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
                </Card>
                <Card title="7-day activity" subtitle="Event volume trend">{logs.length ? <BarChart data={analytics.trend} height={120} /> : <Text style={styles.muted}>No trend data.</Text>}</Card>
                <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search action, actor, IP, details…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}</View>
                <View style={styles.chips}>{filters.map((f) => (<Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}><Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
                <Text style={styles.sectionMeta}>{filteredLogs.length} result{filteredLogs.length === 1 ? "" : "s"}</Text>
              </View>
            }
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="shield-checkmark-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No logs match.</Text></View>}
          />
        )}
        <AdminBottomNav />
      </View>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {selected && (() => {
              const sev = getSeverity(selected);
              const details = typeof selected.details === "string" ? selected.details : selected.details ? JSON.stringify(selected.details, null, 2) : "—";
              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.modalHeader}><Text style={styles.modalTitle}>Log details</Text><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
                  <DetailRow label="Action" value={String(selected.action || "—")} />
                  <DetailRow label="Actor" value={String(selected.actor || "system")} />
                  <DetailRow label="Severity" value={sev} />
                  <DetailRow label="IP address" value={String(selected.ipAddress || "—")} />
                  <DetailRow label="Time" value={selected.timestamp ? new Date(selected.timestamp).toLocaleString() : "—"} />
                  <DetailRow label="Log ID" value={String(selected.id ?? "—")} />
                  <Text style={styles.detailLabel}>Details</Text>
                  <View style={styles.detailsBox}><Text style={styles.detailsText}>{details}</Text></View>
                  <Pressable style={[styles.modalBtn, { marginTop: 16 }]} onPress={() => setSelected(null)}><Text style={styles.modalBtnText}>Close</Text></Pressable>
                </ScrollView>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
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
  topActions: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border, gap: 8 },
  topTitle: { fontSize: 12, fontWeight: "700", color: AdminColors.text, marginBottom: 2 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  topName: { flex: 1, fontSize: 13, color: AdminColors.textSecondary },
  topCount: { fontSize: 13, fontWeight: "700", color: AdminColors.text },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(16,24,40,0.4)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: AdminColors.surface, borderRadius: 20, padding: 18, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: AdminColors.text },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
  detailLabel: { fontSize: 11, fontWeight: "700", color: AdminColors.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, marginTop: 8 },
  detailValue: { fontSize: 14, color: AdminColors.text },
  detailsBox: { backgroundColor: AdminColors.surfaceAlt, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: AdminColors.border },
  detailsText: { fontSize: 12, color: AdminColors.textSecondary, lineHeight: 18, fontFamily: "monospace" },
  modalBtn: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: AdminColors.surfaceAlt },
  modalBtnText: { fontWeight: "700", color: AdminColors.text },
});
