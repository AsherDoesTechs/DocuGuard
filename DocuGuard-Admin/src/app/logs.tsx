import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminLogs, logoutAdmin, getAdminApiBaseUrl, type AuditLogEntry } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BarChart, BreakdownList, Card, IconButton, ScreenHeader, StatCard, SkeletonScreen } from "../components/ui";

type SevFilter = "all" | "info" | "warning" | "critical";
const REFRESH_MS = 15000;
function sevOf(item: AuditLogEntry): "info"|"warning"|"critical" { const s = String(item.severity||"info").toLowerCase(); return s==="critical"?"critical":s==="warning"?"warning":"info"; }
function maskActor(a?: string|null){ const s=String(a||""); if(!s) return "—"; if(s.includes("@")){ const at=s.indexOf("@"); return `${s.slice(0,1)}•••${s.slice(at)}`; } if(/^\d+$/.test(s)) return `user ••${s.slice(-2)}`; return s.length>10?`${s.slice(0,3)}•••${s.slice(-2)}`:s; }
function maskIp(ip?: string|null){ const s=String(ip||""); if(!s) return "—"; const parts=s.split("."); if(parts.length===4) return `${parts[0]}.${parts[1]}.•••.•••`; return "•••"; }

export default function AdminLogsScreen() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<SevFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);

  const fetchLogs = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminLogs(token);
      const list = Array.isArray(data) ? data : (data as any)?.logs || [];
      setLogs(list as AuditLogEntry[]);
      setLastSync(new Date());
    } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load logs."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

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
    const prediction = critical>0 ? `${critical} critical event${critical>1?"s":""} require review.` : warning>0 ? `${warning} warning${warning>1?"s":""} detected.` : "No high-risk patterns detected.";
    return { info, warning, critical, last24h, trend, risk, prediction, topActions };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((l) => {
      const sev = sevOf(l); if (filter !== "all" && sev !== filter) return false;
      if (!q) return true;
      const details = typeof l.details === "string" ? l.details : JSON.stringify(l.details || "");
      return [l.action,l.actor,details,l.ipAddress,l.id].some((v)=>String(v??"").toLowerCase().includes(q));
    });
  }, [logs, searchQuery, filter]);

  const exportLogs = async () => {
    try {
      const rows = [["id","action","actor","severity","ipAddress","timestamp","details"].join(",")];
      filteredLogs.forEach((l)=>{ const details=typeof l.details==="string"?l.details:JSON.stringify(l.details||{}); rows.push([l.id,l.action||"", ui.privacyMode?maskActor(l.actor): (l.actor||""), sevOf(l), ui.privacyMode?maskIp(l.ipAddress): (l.ipAddress||""), l.timestamp||"", ui.privacyMode?"[redacted]":details].map((v)=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")); });
      await Share.share({ message: rows.join("\n"), title: "DocuGuard Security Logs Export" });
    } catch { Alert.alert("Export unavailable", "Could not share export."); }
  };

  const signOut = async () => { setSettingsOpen(false); try { const t = await getAdminToken(); if (t) await logoutAdmin(t); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };
  const filters: { key: SevFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "critical", label: "Critical" }, { key: "warning", label: "Warning" }, { key: "info", label: "Info" }];

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const sev = sevOf(item); const tone = sev==="critical"?"danger":sev==="warning"?"warning":"info"; const icon = sev==="critical"?"alert-circle":sev==="warning"?"warning":"information-circle";
    const actor = ui.privacyMode ? maskActor(item.actor) : (item.actor || "system");
    const ip = ui.privacyMode ? maskIp(item.ipAddress) : (item.ipAddress || "");
    return (
      <Pressable style={styles.logCard} onPress={() => setSelected(item)}>
        <View style={[styles.iconBox, { backgroundColor: sev==="critical"?AdminColors.dangerSoft:sev==="warning"?AdminColors.warningSoft:AdminColors.infoSoft }]}><Ionicons name={icon as any} size={18} color={sev==="critical"?AdminColors.danger:sev==="warning"?AdminColors.warning:AdminColors.info} /></View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowBetween}><Text style={styles.action} numberOfLines={1}>{item.action || "Event"}</Text><Badge label={sev} tone={tone as any} /></View>
          <Text style={styles.meta} numberOfLines={1}>{actor}{ip ? ` · ${ip}` : ""}</Text>
          <Text style={styles.time} numberOfLines={1}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : "—"}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top","left","right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Security Logs" subtitle={`${logs.length} events · ${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportLogs} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchLogs(true)} label="Refresh" /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>} />
        {loading && logs.length === 0 ? <SkeletonScreen /> : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Could not load logs</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchLogs()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : (
          <FlatList data={filteredLogs} keyExtractor={(item,idx)=>String(item.id ?? idx)} renderItem={renderItem} contentContainerStyle={styles.list} style={{ flex: 1 }} showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchLogs(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={<View style={{ gap: 14, marginBottom: 4 }}>
              <View style={styles.statsRow}><StatCard label="24h Events" value={analytics.last24h} icon="time-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} /><StatCard label="Critical" value={analytics.critical} icon="alert-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} /></View>
              <Card title="Risk assessment" subtitle="Severity distribution">
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}><Text style={{ fontSize: 13, color: AdminColors.textSecondary }}>Current risk</Text><Badge label={analytics.risk} tone={analytics.risk==="High"?"danger":analytics.risk==="Moderate"?"warning":"success"} /></View>
                <BreakdownList segments={[{ label: "Info", value: analytics.info, color: AdminColors.info }, { label: "Warning", value: analytics.warning, color: AdminColors.warning }, { label: "Critical", value: analytics.critical, color: AdminColors.danger }]} />
                {!!analytics.topActions.length && <View style={styles.topActions}><Text style={styles.topTitle}>Top actions</Text>{analytics.topActions.map(([name,count])=>(<View key={name} style={styles.topRow}><Text style={styles.topName} numberOfLines={1}>{name}</Text><Text style={styles.topCount}>{count}</Text></View>))}</View>}
                <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
              </Card>
              <Card title="7-day activity" subtitle="Event volume trend">{logs.length ? <BarChart data={analytics.trend} height={120} /> : <Text style={styles.muted}>No trend data.</Text>}</Card>
              <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search action, actor, IP, details…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}</View>
              <View style={styles.chips}>{filters.map((f)=>(<Pressable key={f.key} style={[styles.chip, filter===f.key && styles.chipActive]} onPress={()=>setFilter(f.key)}><Text style={[styles.chipText, filter===f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
              <Text style={styles.sectionMeta}>{filteredLogs.length} result{filteredLogs.length===1?"":"s"}</Text>
            </View>}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="shield-checkmark-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No logs match.</Text></View>} />
        )}
        <AdminBottomNav />
      </View>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSettingsOpen(false)}><Pressable style={styles.modalCard} onPress={() => {}}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Admin Settings</Text><Pressable onPress={() => setSettingsOpen(false)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
          <ScrollView><Text style={styles.groupTitle}>Sync & Session</Text>
            <Row label="Auto-sync (15s)" hint="Refresh data automatically every 15 seconds" value={ui.autoSync} onChange={(v)=>setAdminUiSettings({ autoSync: v })} />
            <Info label="Last sync" value={lastSync ? lastSync.toLocaleString() : "—"} /><Info label="API endpoint" value={getAdminApiBaseUrl()} />
            <Text style={[styles.groupTitle,{marginTop:14}]}>Privacy & Security</Text>
            <Row label="Privacy-aware mode" hint="Mask actor/IP identifiers in log views and exports" value={ui.privacyMode} onChange={(v)=>setAdminUiSettings({ privacyMode: v })} />
            <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={16} color={AdminColors.primary} /><Text style={styles.noticeText}>Security logs are shown for operational monitoring. In privacy-aware mode, sensitive identifiers are masked in the UI/exports where applicable. Backend access remains role-checked and audited.</Text></View>
            <Pressable style={styles.signOutBtn} onPress={signOut}><Ionicons name="log-out-outline" size={18} color="#fff" /><Text style={styles.signOutText}>Sign out</Text></Pressable>
          </ScrollView>
        </Pressable></Pressable>
      </Modal>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}><Pressable style={styles.modalCard} onPress={() => {}}>
          {selected && (() => { const sev = sevOf(selected); const details = typeof selected.details === "string" ? selected.details : selected.details ? JSON.stringify(selected.details, null, 2) : "—"; return (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}><Text style={styles.modalTitle}>Log details</Text><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
              <Detail label="Action" value={String(selected.action||"—")} /><Detail label="Actor" value={ui.privacyMode?maskActor(selected.actor):String(selected.actor||"system")} />
              <Detail label="Severity" value={sev} /><Detail label="IP address" value={ui.privacyMode?maskIp(selected.ipAddress):String(selected.ipAddress||"—")} />
              <Detail label="Time" value={selected.timestamp?new Date(selected.timestamp).toLocaleString():"—"} /><Detail label="Log ID" value={String(selected.id??"—")} />
              <Text style={styles.detailLabelBlock}>Details</Text><View style={styles.detailsBox}><Text style={styles.detailsText}>{ui.privacyMode ? "Details masked in privacy-aware mode." : details}</Text></View>
              <Pressable style={[styles.modalBtn,{marginTop:16}]} onPress={() => setSelected(null)}><Text style={styles.modalBtnText}>Close</Text></Pressable>
            </ScrollView>
          ); })()}
        </Pressable></Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v:boolean)=>void }) { return <View style={styles.settingRow}><View style={{ flex: 1 }}><Text style={styles.settingLabel}>{label}</Text><Text style={styles.settingHint}>{hint}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: AdminColors.borderStrong, true: "#93C5FD" }} thumbColor={value ? AdminColors.primary : "#fff"} /></View>; }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:AdminColors.background}, screen:{flex:1}, list:{paddingHorizontal:20,paddingBottom:24,gap:10}, statsRow:{flexDirection:"row",gap:12},
  muted:{fontSize:13,color:AdminColors.textSecondary,lineHeight:19}, errorTitle:{fontSize:16,fontWeight:"700",color:AdminColors.dangerText,marginBottom:4},
  retryBtn:{alignSelf:"flex-start",marginTop:12,backgroundColor:AdminColors.primary,paddingHorizontal:14,paddingVertical:10,borderRadius:AdminRadii.sm}, retryText:{color:"#fff",fontWeight:"700",fontSize:13},
  searchWrap:{flexDirection:"row",alignItems:"center",gap:8,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:14,paddingHorizontal:14,height:46}, searchInput:{flex:1,fontSize:14,color:AdminColors.text},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:8}, chip:{paddingHorizontal:12,paddingVertical:7,borderRadius:AdminRadii.pill,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border}, chipActive:{backgroundColor:AdminColors.primary,borderColor:AdminColors.primary}, chipText:{fontSize:12,fontWeight:"600",color:AdminColors.textSecondary}, chipTextActive:{color:"#fff"}, sectionMeta:{fontSize:12,color:AdminColors.textMuted,fontWeight:"600"},
  logCard:{flexDirection:"row",gap:12,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:AdminRadii.lg,padding:14}, iconBox:{width:38,height:38,borderRadius:10,alignItems:"center",justifyContent:"center"}, rowBetween:{flexDirection:"row",alignItems:"center",gap:8}, action:{flex:1,fontSize:14,fontWeight:"700",color:AdminColors.text}, meta:{fontSize:12,color:AdminColors.textSecondary,marginTop:3}, time:{fontSize:11,color:AdminColors.textMuted,marginTop:2},
  insight:{flexDirection:"row",gap:8,marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border}, insightText:{flex:1,fontSize:13,color:AdminColors.textSecondary,lineHeight:18},
  topActions:{marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border,gap:8}, topTitle:{fontSize:12,fontWeight:"700",color:AdminColors.text,marginBottom:2}, topRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}, topName:{flex:1,fontSize:13,color:AdminColors.textSecondary}, topCount:{fontSize:13,fontWeight:"700",color:AdminColors.text}, empty:{alignItems:"center",paddingVertical:40,gap:8},
  modalOverlay:{flex:1,backgroundColor:"rgba(16,24,40,0.35)",justifyContent:"center",padding:20}, modalCard:{backgroundColor:AdminColors.surface,borderRadius:20,padding:18,maxHeight:"85%",borderWidth:1,borderColor:AdminColors.border},
  modalHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}, modalTitle:{fontSize:18,fontWeight:"800",color:AdminColors.text},
  detailRow:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, detailLabel:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}, detailLabelBlock:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:4,marginTop:8}, detailValue:{fontSize:14,color:AdminColors.text},
  detailsBox:{backgroundColor:AdminColors.surfaceAlt,borderRadius:12,padding:12,borderWidth:1,borderColor:AdminColors.border}, detailsText:{fontSize:12,color:AdminColors.textSecondary,lineHeight:18},
  modalBtn:{height:44,borderRadius:12,alignItems:"center",justifyContent:"center",backgroundColor:AdminColors.surfaceAlt}, modalBtnText:{fontWeight:"700",color:AdminColors.text},
  groupTitle:{fontSize:13,fontWeight:"800",color:AdminColors.text,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}, settingRow:{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, settingLabel:{fontSize:14,fontWeight:"700",color:AdminColors.text}, settingHint:{fontSize:12,color:AdminColors.textSecondary,marginTop:2,lineHeight:17},
  infoRow:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, infoLabel:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",marginBottom:2}, infoValue:{fontSize:13,color:AdminColors.text},
  notice:{flexDirection:"row",gap:8,marginTop:12,padding:12,borderRadius:12,backgroundColor:AdminColors.primarySoft}, noticeText:{flex:1,fontSize:12,color:AdminColors.primaryDark,lineHeight:18},
  signOutBtn:{marginTop:18,height:46,borderRadius:12,backgroundColor:AdminColors.danger,flexDirection:"row",gap:8,alignItems:"center",justifyContent:"center"}, signOutText:{color:"#fff",fontWeight:"700",fontSize:14},
});
