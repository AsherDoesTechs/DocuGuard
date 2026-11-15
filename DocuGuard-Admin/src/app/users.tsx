import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminUsers, updateAdminUserStatus, logoutAdmin, getAdminApiBaseUrl, type AdminUser } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings, maskEmail } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ScreenHeader, StatCard, SkeletonScreen } from "../components/ui";

type Filter = "all" | "active" | "suspended" | "admin";
type SortKey = "recent" | "name" | "email";
const REFRESH_MS = 15000;

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);

  const fetchUsers = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminUsers(token);
      const list = Array.isArray(data) ? data : (data as any)?.users || [];
      setUsers(list as AdminUser[]);
      setLastSync(new Date());
    } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load users."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);
  useEffect(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } if (ui.autoSync) timerRef.current = setInterval(() => { void fetchUsers(false, true); }, REFRESH_MS); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [ui.autoSync, fetchUsers]);

  const analytics = useMemo(() => {
    const active = users.filter((u) => String(u.status || "active") === "active").length;
    const suspended = users.filter((u) => String(u.status) === "suspended").length;
    const admins = users.filter((u) => String(u.role) === "admin").length;
    const prediction = suspended > 0 ? `${suspended} suspended account${suspended>1?"s":""} — review if unintentional.` : admins > 1 ? `${admins} admin accounts detected — ensure least privilege.` : "Account status looks healthy.";
    return { active, suspended, admins, prediction };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = users.filter((u) => {
      const status = String(u.status || "active"); const role = String(u.role || "user");
      if (filter === "active" && status !== "active") return false;
      if (filter === "suspended" && status !== "suspended") return false;
      if (filter === "admin" && role !== "admin") return false;
      if (!q) return true;
      return [u.email, u.name, u.role, u.status, u.id].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""));
      if (sort === "email") return String(a.email || "").localeCompare(String(b.email || ""));
      const ta = new Date((a as any).createdAt || 0).getTime(); const tb = new Date((b as any).createdAt || 0).getTime(); return tb - ta;
    });
    return list;
  }, [users, searchQuery, filter, sort]);

  const handleToggleStatus = (user: AdminUser) => {
    const status = String(user.status || "active"); const nextStatus = status === "active" ? "suspended" : "active";
    Alert.alert(`${nextStatus === "suspended" ? "Suspend" : "Activate"} user`, `${ui.privacyMode ? "Selected account" : (user.email || user.name || "User")} will be ${nextStatus}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: nextStatus === "suspended" ? "destructive" : "default", onPress: async () => {
        try { const token = await getAdminToken(); if (!token) return; await updateAdminUserStatus(token, user.id, nextStatus as any);
          setUsers((prev) => prev.map((u) => (String(u.id) === String(user.id) ? { ...u, status: nextStatus } : u)));
          setSelected((s) => (s && String(s.id) === String(user.id) ? { ...s, status: nextStatus } : s));
        } catch (err: any) { Alert.alert("Update failed", err?.message || "Could not update status. Schema may not support user status."); }
      }},
    ]);
  };

  const exportUsers = async () => {
    try {
      const rows = [["id","name","email","role","status","createdAt"].join(",")];
      filteredUsers.forEach((u) => rows.push([u.id, u.name||"", ui.privacyMode ? maskEmail(u.email) : (u.email||""), u.role||"user", u.status||"active", (u as any).createdAt||""].map((v)=>`"${String(v).replace(/"/g,'""')}"`).join(",")));
      await Share.share({ message: rows.join("\n"), title: "DocuGuard Users Export" });
    } catch { Alert.alert("Export unavailable", "Could not share export on this device."); }
  };

  const signOut = async () => { setSettingsOpen(false); try { const t = await getAdminToken(); if (t) await logoutAdmin(t); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };

  const filters: { key: Filter; label: string }[] = [{ key: "all", label: "All" }, { key: "active", label: "Active" }, { key: "suspended", label: "Suspended" }, { key: "admin", label: "Admins" }];

  const renderItem = ({ item }: { item: AdminUser }) => {
    const status = String(item.status || "active"); const isActive = status === "active";
    const name = item.name || "Unnamed User"; const email = ui.privacyMode ? maskEmail(item.email) : item.email;
    return (
      <Pressable style={styles.userCard} onPress={() => setSelected(item)}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(name || String(email) || "?").charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName} numberOfLines={1}>{name}</Text>
          <Text style={styles.userEmail} numberOfLines={1}>{email || "—"}</Text>
          <View style={styles.badgeRow}><Badge label={status} tone={isActive ? "success" : "danger"} /><Badge label={String(item.role || "user")} tone={String(item.role) === "admin" ? "primary" : "neutral"} /></View>
        </View>
        <Pressable style={[styles.actionBtn, isActive ? styles.suspendBtn : styles.activateBtn]} onPress={() => handleToggleStatus(item)}><Text style={[styles.actionText, isActive ? styles.suspendText : styles.activateText]}>{isActive ? "Suspend" : "Activate"}</Text></Pressable>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Users" subtitle={`${users.length} accounts · ${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportUsers} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchUsers(true)} label="Refresh" /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>} />
        {loading && users.length === 0 ? <SkeletonScreen /> : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Could not load users</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchUsers()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : (
          <FlatList data={filteredUsers} keyExtractor={(item) => String(item.id)} renderItem={renderItem} contentContainerStyle={styles.list} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchUsers(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={<View style={{ gap: 14, marginBottom: 4 }}>
              <View style={styles.row}><StatCard label="Active" value={analytics.active} icon="checkmark-circle-outline" color={AdminColors.success} bg={AdminColors.successSoft} /><StatCard label="Suspended" value={analytics.suspended} icon="pause-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} /></View>
              <Card title="Account overview" subtitle="Roles and status"><BreakdownList segments={[{ label: "Active", value: analytics.active, color: AdminColors.success }, { label: "Suspended", value: analytics.suspended, color: AdminColors.danger }, { label: "Admins", value: analytics.admins, color: AdminColors.primary }]} /><View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View></Card>
              <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search name, email, role…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}</View>
              <View style={styles.chips}>{filters.map((f) => (<Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}><Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
              <View style={styles.sortRow}><Text style={styles.sectionMeta}>{filteredUsers.length} result{filteredUsers.length===1?"":"s"}</Text><View style={styles.sortBtns}>{([{k:"recent",l:"Recent"},{k:"name",l:"Name"},{k:"email",l:"Email"}] as const).map((s)=>(<Pressable key={s.k} onPress={()=>setSort(s.k)} style={[styles.sortChip, sort===s.k&&styles.sortChipActive]}><Text style={[styles.sortText, sort===s.k&&styles.sortTextActive]}>{s.l}</Text></Pressable>))}</View></View>
            </View>}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No users match your filters.</Text></View>} />
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
            <Row label="Privacy-aware mode" hint="Mask user emails and hide sensitive identifiers" value={ui.privacyMode} onChange={(v)=>setAdminUiSettings({ privacyMode: v })} />
            <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={16} color={AdminColors.primary} /><Text style={styles.noticeText}>Admins manage operations and security. User document contents/files and personal secrets are not exposed. Access is role-checked, token-based, and auditable.</Text></View>
            <Pressable style={styles.signOutBtn} onPress={signOut}><Ionicons name="log-out-outline" size={18} color="#fff" /><Text style={styles.signOutText}>Sign out</Text></Pressable>
          </ScrollView>
        </Pressable></Pressable>
      </Modal>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}><Pressable style={styles.modalCard} onPress={() => {}}>
          {selected && <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>User details</Text><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
            <Detail label="Name" value={selected.name || "—"} /><Detail label="Email" value={ui.privacyMode ? maskEmail(selected.email) : (selected.email || "—")} />
            <Detail label="Role" value={String(selected.role || "user")} /><Detail label="Status" value={String(selected.status || "active")} />
            <Detail label="User ID" value={String(selected.id)} /><Detail label="Created" value={(selected as any).createdAt ? new Date((selected as any).createdAt).toLocaleString() : "—"} />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}><Pressable style={[styles.modalBtn, styles.modalBtnSecondary]} onPress={() => setSelected(null)}><Text style={styles.modalBtnSecondaryText}>Close</Text></Pressable><Pressable style={[styles.modalBtn, String(selected.status||"active")==="active"?styles.modalBtnDanger:styles.modalBtnPrimary]} onPress={()=>handleToggleStatus(selected)}><Text style={styles.modalBtnPrimaryText}>{String(selected.status||"active")==="active"?"Suspend":"Activate"}</Text></Pressable></View>
          </ScrollView>}
        </Pressable></Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v:boolean)=>void }) { return <View style={styles.settingRow}><View style={{ flex: 1 }}><Text style={styles.settingLabel}>{label}</Text><Text style={styles.settingHint}>{hint}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: AdminColors.borderStrong, true: "#93C5FD" }} thumbColor={value ? AdminColors.primary : "#fff"} /></View>; }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:AdminColors.background}, screen:{flex:1}, list:{paddingHorizontal:20,paddingBottom:24,gap:10}, row:{flexDirection:"row",gap:12},
  muted:{fontSize:13,color:AdminColors.textSecondary,lineHeight:19}, errorTitle:{fontSize:16,fontWeight:"700",color:AdminColors.dangerText,marginBottom:4},
  retryBtn:{alignSelf:"flex-start",marginTop:12,backgroundColor:AdminColors.primary,paddingHorizontal:14,paddingVertical:10,borderRadius:AdminRadii.sm}, retryText:{color:"#fff",fontWeight:"700",fontSize:13},
  searchWrap:{flexDirection:"row",alignItems:"center",gap:8,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:14,paddingHorizontal:14,height:46}, searchInput:{flex:1,fontSize:14,color:AdminColors.text},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:8}, chip:{paddingHorizontal:12,paddingVertical:7,borderRadius:AdminRadii.pill,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border}, chipActive:{backgroundColor:AdminColors.primary,borderColor:AdminColors.primary}, chipText:{fontSize:12,fontWeight:"600",color:AdminColors.textSecondary}, chipTextActive:{color:"#fff"},
  sortRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}, sortBtns:{flexDirection:"row",gap:6}, sortChip:{paddingHorizontal:10,paddingVertical:6,borderRadius:8,backgroundColor:AdminColors.surfaceAlt}, sortChipActive:{backgroundColor:AdminColors.primarySoft}, sortText:{fontSize:11,fontWeight:"600",color:AdminColors.textSecondary}, sortTextActive:{color:AdminColors.primary}, sectionMeta:{fontSize:12,color:AdminColors.textMuted,fontWeight:"600"},
  userCard:{flexDirection:"row",alignItems:"center",gap:12,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:AdminRadii.lg,padding:14},
  avatar:{width:42,height:42,borderRadius:21,backgroundColor:AdminColors.primarySoft,alignItems:"center",justifyContent:"center"}, avatarText:{fontSize:16,fontWeight:"700",color:AdminColors.primary},
  userName:{fontSize:15,fontWeight:"700",color:AdminColors.text}, userEmail:{fontSize:12,color:AdminColors.textSecondary,marginTop:1}, badgeRow:{flexDirection:"row",gap:6,marginTop:6},
  actionBtn:{paddingHorizontal:12,paddingVertical:8,borderRadius:10,borderWidth:1}, suspendBtn:{backgroundColor:AdminColors.dangerSoft,borderColor:"#FECACA"}, activateBtn:{backgroundColor:AdminColors.successSoft,borderColor:"#BBF7D0"}, actionText:{fontSize:12,fontWeight:"700"}, suspendText:{color:AdminColors.dangerText}, activateText:{color:AdminColors.successText},
  insight:{flexDirection:"row",gap:8,marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border}, insightText:{flex:1,fontSize:13,color:AdminColors.textSecondary,lineHeight:18}, empty:{alignItems:"center",paddingVertical:40,gap:8},
  modalOverlay:{flex:1,backgroundColor:"rgba(16,24,40,0.35)",justifyContent:"center",padding:20}, modalCard:{backgroundColor:AdminColors.surface,borderRadius:20,padding:18,maxHeight:"85%",borderWidth:1,borderColor:AdminColors.border},
  modalHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}, modalTitle:{fontSize:18,fontWeight:"800",color:AdminColors.text},
  detailRow:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, detailLabel:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}, detailValue:{fontSize:14,color:AdminColors.text},
  modalBtn:{flex:1,height:44,borderRadius:12,alignItems:"center",justifyContent:"center"}, modalBtnSecondary:{backgroundColor:AdminColors.surfaceAlt}, modalBtnPrimary:{backgroundColor:AdminColors.primary}, modalBtnDanger:{backgroundColor:AdminColors.danger}, modalBtnSecondaryText:{fontWeight:"700",color:AdminColors.text}, modalBtnPrimaryText:{fontWeight:"700",color:"#fff"},
  groupTitle:{fontSize:13,fontWeight:"800",color:AdminColors.text,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}, settingRow:{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, settingLabel:{fontSize:14,fontWeight:"700",color:AdminColors.text}, settingHint:{fontSize:12,color:AdminColors.textSecondary,marginTop:2,lineHeight:17},
  infoRow:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, infoLabel:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",marginBottom:2}, infoValue:{fontSize:13,color:AdminColors.text},
  notice:{flexDirection:"row",gap:8,marginTop:12,padding:12,borderRadius:12,backgroundColor:AdminColors.primarySoft}, noticeText:{flex:1,fontSize:12,color:AdminColors.primaryDark,lineHeight:18},
  signOutBtn:{marginTop:18,height:46,borderRadius:12,backgroundColor:AdminColors.danger,flexDirection:"row",gap:8,alignItems:"center",justifyContent:"center"}, signOutText:{color:"#fff",fontWeight:"700",fontSize:14},
});
