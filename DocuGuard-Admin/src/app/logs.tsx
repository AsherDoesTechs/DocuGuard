import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, RefreshControl, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminLogs, logoutAdmin, type AuditLogEntry } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminSettingsModal } from "../components/AdminSettingsModal";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BarChart, BreakdownList, Card, IconButton, ScreenHeader, StatCard, SkeletonScreen, SyncLine, PressableScale, FadeInView } from "../components/ui";

type SevFilter = "all" | "info" | "warning" | "critical";
const REFRESH_MS = 15000;
function sevOf(item: AuditLogEntry): "info" | "warning" | "critical" { const s = String(item.severity || "info").toLowerCase(); return s === "critical" ? "critical" : s === "warning" ? "warning" : "info"; }
function maskActor(a?: string | null) { const s = String(a || ""); if (!s) return "—"; if (s.includes("@")) { const at = s.indexOf("@"); return `${s.slice(0, 1)}•••${s.slice(at)}`; } if (/^\d+$/.test(s)) return `user ••${s.slice(-2)}`; return s.length > 10 ? `${s.slice(0, 3)}•••${s.slice(-2)}` : s; }
function maskIp(ip?: string | null) { const s = String(ip || ""); if (!s) return "—"; const parts = s.split("."); if (parts.length === 4) return `${parts[0]}.${parts[1]}.•••.•••`; return "•••"; }

export default function AdminLogsScreen() {
  const { width } = useWindowDimensions();
  const isWideNav = width >= 768;
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<SevFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);
  const fetchLogs = useCallback(async (isRefresh = false, silent = false) => { if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true); if (silent || isRefresh) setSyncing(true); setErrorMessage(""); try { const token = await getAdminToken(); if (!token) { router.replace("/"); return; } const data = await getAdminLogs(token); setLogs((Array.isArray(data) ? data : (data as any)?.logs || []) as AuditLogEntry[]); setLastSync(new Date()); } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load logs."); } finally { setLoading(false); setRefreshing(false); setTimeout(() => setSyncing(false), 350); } }, []);
  useEffect(() => { void fetchLogs(); }, [fetchLogs]);
  useEffect(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } if (ui.autoSync) timerRef.current = setInterval(() => { void fetchLogs(false, true); }, REFRESH_MS); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [ui.autoSync, fetchLogs]);

  const analytics = useMemo(() => {
    const now = Date.now(); const dayMs = 86400000;
    const info = logs.filter((l)=>sevOf(l)==="info").length; const warning = logs.filter((l)=>sevOf(l)==="warning").length; const critical = logs.filter((l)=>sevOf(l)==="critical").length;
    const last24h = logs.filter((l)=>{ const t=new Date(l.timestamp as any).getTime(); return Number.isFinite(t)&&now-t<=dayMs; }).length;
    const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const trend = Array.from({length:7},(_,idx)=>{ const i=6-idx; const d=new Date(now-i*dayMs); const start=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); const count=logs.filter((l)=>{const t=new Date(l.timestamp as any).getTime(); return Number.isFinite(t)&&t>=start&&t<start+dayMs;}).length; return {label:dayNames[d.getDay()], value:count}; });
    const topActions = Object.entries(logs.reduce<Record<string,number>>((acc,l)=>{const k=String(l.action||"event"); acc[k]=(acc[k]||0)+1; return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const risk: "Low"|"Moderate"|"High" = critical>0?"High":warning>=5?"Moderate":"Low";
    return { info, warning, critical, last24h, trend, risk, topActions, prediction: critical>0?`${critical} critical event${critical>1?"s":""} to review.`:warning>0?`${warning} warning${warning>1?"s":""} detected.`:"No high-risk patterns detected." };
  }, [logs]);

  const filteredLogs = useMemo(() => { const q = searchQuery.trim().toLowerCase(); return logs.filter((l) => { const sev = sevOf(l); if (filter !== "all" && sev !== filter) return false; if (!q) return true; const details = typeof l.details === "string" ? l.details : JSON.stringify(l.details || ""); return [l.action,l.actor,details,l.ipAddress,l.id].some((v)=>String(v??"").toLowerCase().includes(q)); }); }, [logs, searchQuery, filter]);
  const exportLogs = async () => { try { const rows = [["id","action","actor","severity","ipAddress","timestamp","details"].join(",")]; filteredLogs.forEach((l)=>{ const details=typeof l.details==="string"?l.details:JSON.stringify(l.details||{}); rows.push([l.id,l.action||"", ui.privacyMode?maskActor(l.actor): (l.actor||""), sevOf(l), ui.privacyMode?maskIp(l.ipAddress): (l.ipAddress||""), l.timestamp||"", ui.privacyMode?"[redacted]":details].map((v)=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")); }); await Share.share({ message: rows.join("\n"), title: "Security Logs Export" }); } catch { Alert.alert("Export unavailable", "Could not share export."); } };
  const signOut = async () => { setSettingsOpen(false); try { const t = await getAdminToken(); if (t) await logoutAdmin(t); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };
  const gap = ui.compactMode ? 10 : 14;

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const sev = sevOf(item); const tone = sev==="critical"?"danger":sev==="warning"?"warning":"info"; const icon = sev==="critical"?"alert-circle":sev==="warning"?"warning":"information-circle";
    return (<FadeInView><View style={styles.logCard}><View style={[styles.iconBox, { backgroundColor: sev==="critical"?AdminColors.dangerSoft:sev==="warning"?AdminColors.warningSoft:AdminColors.infoSoft }]}><Ionicons name={icon as any} size={18} color={sev==="critical"?AdminColors.danger:sev==="warning"?AdminColors.warning:AdminColors.info} /></View><View style={{ flex: 1 }}><View style={styles.rowBetween}><Text style={styles.action} numberOfLines={1}>{item.action || "Event"}</Text><Badge label={sev} tone={tone as any} /></View><Text style={styles.meta} numberOfLines={1}>{ui.privacyMode ? maskActor(item.actor) : (item.actor || "system")}{(ui.privacyMode ? maskIp(item.ipAddress) : item.ipAddress) ? ` · ${ui.privacyMode ? maskIp(item.ipAddress) : item.ipAddress}` : ""}</Text><Text style={styles.time} numberOfLines={1}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}</Text></View></View></FadeInView>);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top","left","right"]}>
      <View style={styles.screen}>
        <SyncLine syncing={syncing} />
        <ScreenHeader title="Security Logs" subtitle={`${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}${syncing ? " · syncing" : ""}`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportLogs} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchLogs(true)} label="Refresh" spinning={syncing} /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>} />
        {loading && logs.length === 0 ? <SkeletonScreen /> : errorMessage ? (<View style={{ paddingHorizontal: isWideNav ? 88 : 20 }}><Card><Text style={styles.errorTitle}>Could not load logs</Text><Text style={styles.muted}>{errorMessage}</Text><PressableScale style={styles.retryBtn} onPress={() => void fetchLogs()}><Text style={styles.retryText}>Try again</Text></PressableScale></Card></View>) : (
          <FlatList data={filteredLogs} keyExtractor={(item) => String(item.id)} renderItem={renderItem} contentContainerStyle={[styles.list, { gap: ui.compactMode ? 8 : 10, paddingRight: isWideNav ? 88 : 20 }]} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchLogs(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={<View style={{ gap, marginBottom: 2 }}>
              <View style={{ flexDirection: "row", gap: ui.compactMode ? 8 : 12 }}><StatCard label="24h Events" value={analytics.last24h} icon="time-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} /><StatCard label="Critical" value={analytics.critical} icon="alert-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} /></View>
              {ui.showInsights && <Card title="Risk assessment"><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}><Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Current risk</Text><Badge label={analytics.risk} tone={analytics.risk==="High"?"danger":analytics.risk==="Moderate"?"warning":"success"} /></View><BreakdownList segments={[{ label: "Info", value: analytics.info, color: AdminColors.info }, { label: "Warning", value: analytics.warning, color: AdminColors.warning }, { label: "Critical", value: analytics.critical, color: AdminColors.danger }]} />{!!analytics.topActions.length && <View style={styles.topActions}><Text style={styles.topTitle}>Top actions</Text>{analytics.topActions.map(([name,count])=>(<View key={name} style={styles.topRow}><Text style={styles.topName} numberOfLines={1}>{name}</Text><Text style={styles.topCount}>{count}</Text></View>))}</View>}<View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View></Card>}
              <Card title="7-day activity">{logs.length ? <BarChart data={analytics.trend} height={110} /> : <Text style={styles.muted}>No trend data.</Text>}</Card>
              <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search action, actor, IP, details…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <PressableScale onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></PressableScale>}</View>
              <View style={styles.chips}>{([{key:"all",label:"All"},{key:"critical",label:"Critical"},{key:"warning",label:"Warning"},{key:"info",label:"Info"}] as const).map((f)=>(<PressableScale key={f.key} style={[styles.chip, filter===f.key && styles.chipActive]} onPress={()=>setFilter(f.key)}><Text style={[styles.chipText, filter===f.key && styles.chipTextActive]}>{f.label}</Text></PressableScale>))}</View>
              <Text style={styles.sectionMeta}>{filteredLogs.length} result{filteredLogs.length===1?"":"s"}</Text>
            </View>}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="shield-checkmark-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No logs match.</Text></View>} />
        )}
        <AdminBottomNav />
      </View>
      <AdminSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} ui={ui} lastSync={lastSync} syncing={syncing} onSyncNow={() => void fetchLogs(false, true)} onSignOut={signOut} extra={<View><PressableScale style={styles.settingAction} onPress={() => { setSettingsOpen(false); exportLogs(); }}><Ionicons name="share-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Export filtered logs (CSV)</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => { setSearchQuery(""); setFilter("all"); }}><Ionicons name="filter-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Reset filters & search</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => setAdminUiSettings({ privacyMode: !ui.privacyMode })}><Ionicons name="eye-off-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>{ui.privacyMode ? "Disable privacy masking" : "Enable privacy masking"}</Text></PressableScale></View>} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:AdminColors.background}, screen:{flex:1}, list:{paddingHorizontal:20,paddingBottom:110},
  muted:{fontSize:13,color:AdminColors.textSecondary,lineHeight:19}, errorTitle:{fontSize:16,fontWeight:"700",color:AdminColors.dangerText,marginBottom:4},
  retryBtn:{alignSelf:"flex-start",marginTop:12,backgroundColor:AdminColors.primary,paddingHorizontal:14,paddingVertical:10,borderRadius:AdminRadii.sm}, retryText:{color:"#fff",fontWeight:"700",fontSize:13},
  searchWrap:{flexDirection:"row",alignItems:"center",gap:8,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:14,paddingHorizontal:14,height:46}, searchInput:{flex:1,fontSize:14,color:AdminColors.text},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:8}, chip:{paddingHorizontal:12,paddingVertical:7,borderRadius:AdminRadii.pill,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border}, chipActive:{backgroundColor:AdminColors.primary,borderColor:AdminColors.primary}, chipText:{fontSize:12,fontWeight:"600",color:AdminColors.textSecondary}, chipTextActive:{color:"#fff"}, sectionMeta:{fontSize:12,color:AdminColors.textMuted,fontWeight:"600"},
  logCard:{flexDirection:"row",gap:12,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:AdminRadii.lg,padding:14}, iconBox:{width:38,height:38,borderRadius:10,alignItems:"center",justifyContent:"center"}, rowBetween:{flexDirection:"row",alignItems:"center",gap:8}, action:{flex:1,fontSize:14,fontWeight:"700",color:AdminColors.text}, meta:{fontSize:12,color:AdminColors.textSecondary,marginTop:3}, time:{fontSize:11,color:AdminColors.textMuted,marginTop:2},
  insight:{flexDirection:"row",gap:8,marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border}, insightText:{flex:1,fontSize:13,color:AdminColors.textSecondary,lineHeight:18},
  topActions:{marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border,gap:8}, topTitle:{fontSize:12,fontWeight:"700",color:AdminColors.text,marginBottom:2}, topRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}, topName:{flex:1,fontSize:13,color:AdminColors.textSecondary}, topCount:{fontSize:13,fontWeight:"700",color:AdminColors.text}, empty:{alignItems:"center",paddingVertical:40,gap:8},
  settingAction:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:11,borderBottomWidth:1,borderBottomColor:AdminColors.border}, settingActionText:{fontSize:14,color:AdminColors.text,fontWeight:"500"},
});
