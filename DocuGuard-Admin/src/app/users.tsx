import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminUsers, updateAdminUserStatus, logoutAdmin, type AdminUser } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings, maskEmail, maskPerson } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminSettingsModal } from "../components/AdminSettingsModal";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ScreenHeader, StatCard, SkeletonScreen, SyncLine, PressableScale, FadeInView } from "../components/ui";

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
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);

  const fetchUsers = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true);
    if (silent || isRefresh) setSyncing(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminUsers(token);
      setUsers((Array.isArray(data) ? data : (data as any)?.users || []) as AdminUser[]);
      setLastSync(new Date());
    } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load users."); }
    finally { setLoading(false); setRefreshing(false); setTimeout(() => setSyncing(false), 350); }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);
  useEffect(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } if (ui.autoSync) timerRef.current = setInterval(() => { void fetchUsers(false, true); }, REFRESH_MS); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [ui.autoSync, fetchUsers]);

  const analytics = useMemo(() => {
    const active = users.filter((u) => String(u.status || "active") === "active").length;
    const suspended = users.filter((u) => String(u.status) === "suspended").length;
    const admins = users.filter((u) => String(u.role) === "admin").length;
    return { active, suspended, admins, prediction: suspended > 0 ? `${suspended} suspended account${suspended>1?"s":""} to review.` : "Account status looks healthy." };
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
      return new Date((b as any).createdAt || 0).getTime() - new Date((a as any).createdAt || 0).getTime();
    });
    return list;
  }, [users, searchQuery, filter, sort]);

  const handleToggleStatus = (user: AdminUser) => {
    const status = String(user.status || "active");
    const nextStatus = status === "active" ? "suspended" : "active";
    Alert.alert(
      `${nextStatus === "suspended" ? "Suspend" : "Activate"} user`,
      `${ui.privacyMode ? "Selected account" : user.email || user.name || "User"} will be ${nextStatus}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: nextStatus === "suspended" ? "destructive" : "default",
          onPress: async () => {
            try {
              const token = await getAdminToken();
              if (!token) {
                Alert.alert("Not signed in", "Please sign in again.");
                router.replace("/");
                return;
              }
              const res: any = await updateAdminUserStatus(token, user.id, nextStatus);
              const updated = res?.user;
              if (updated && typeof updated === "object") {
                setUsers((prev) =>
                  prev.map((u) =>
                    String(u.id) === String(user.id)
                      ? { ...u, ...updated, status: String(updated.status || nextStatus) }
                      : u,
                  ),
                );
              } else {
                setUsers((prev) =>
                  prev.map((u) =>
                    String(u.id) === String(user.id) ? { ...u, status: nextStatus } : u,
                  ),
                );
              }
            } catch (err: any) {
              const msg =
                err?.response?.data?.error ||
                err?.data?.error ||
                err?.message ||
                "Could not update status.";
              Alert.alert("Update failed", msg);
            }
          },
        },
      ],
    );
  };

  const exportUsers = async () => { try { const rows = [["id","name","email","role","status","createdAt"].join(",")]; filteredUsers.forEach((u) => rows.push([ui.privacyMode ? maskPerson(u.id) : u.id, ui.privacyMode ? maskPerson(u.name) : (u.name||""), ui.privacyMode ? maskEmail(u.email) : (u.email||""), u.role||"user", u.status||"active", (u as any).createdAt||""].map((v)=>`"${String(v).replace(/"/g,'""')}"`).join(","))); await Share.share({ message: rows.join("\n"), title: "Users Export" }); } catch { Alert.alert("Export unavailable", "Could not share export."); } };
  const signOut = async () => { setSettingsOpen(false); try { const t = await getAdminToken(); if (t) await logoutAdmin(t); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };
  const filters: { key: Filter; label: string }[] = [{ key: "all", label: "All" }, { key: "active", label: "Active" }, { key: "suspended", label: "Suspended" }, { key: "admin", label: "Admins" }];
  const gap = ui.compactMode ? 10 : 14;

  const renderItem = ({ item }: { item: AdminUser }) => {
    const status = String(item.status || "active"); const isActive = status === "active"; const name = ui.privacyMode ? (item.name ? maskPerson(item.name) : "User") : (item.name || "Unnamed User"); const email = ui.privacyMode ? maskEmail(item.email) : item.email;
    return (<FadeInView><View style={styles.userCard}><View style={styles.avatar}><Text style={styles.avatarText}>{(name || String(email) || "?").charAt(0).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.userName} numberOfLines={1}>{name}</Text><Text style={styles.userEmail} numberOfLines={1}>{email || "—"}</Text><View style={styles.badgeRow}><Badge label={status} tone={isActive ? "success" : "danger"} /><Badge label={String(item.role || "user")} tone={String(item.role) === "admin" ? "primary" : "neutral"} /></View></View><PressableScale style={[styles.actionBtn, isActive ? styles.suspendBtn : styles.activateBtn]} onPress={() => handleToggleStatus(item)}><Text style={[styles.actionText, isActive ? styles.suspendText : styles.activateText]}>{isActive ? "Suspend" : "Activate"}</Text></PressableScale></View></FadeInView>);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <SyncLine syncing={syncing} />
        <ScreenHeader title="Users" subtitle={`${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}${syncing ? " · syncing" : ""}`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportUsers} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchUsers(true)} label="Refresh" spinning={syncing} /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>} />
        {loading && users.length === 0 ? <SkeletonScreen /> : errorMessage ? (<View style={{ paddingHorizontal: 20 }}><Card><Text style={styles.errorTitle}>Could not load users</Text><Text style={styles.muted}>{errorMessage}</Text><PressableScale style={styles.retryBtn} onPress={() => void fetchUsers()}><Text style={styles.retryText}>Try again</Text></PressableScale></Card></View>) : (
          <FlatList data={filteredUsers} keyExtractor={(item) => String(item.id)} renderItem={renderItem} contentContainerStyle={[styles.list, { gap: ui.compactMode ? 8 : 10 }]} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchUsers(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={<View style={{ gap, marginBottom: 2 }}>
              <View style={{ flexDirection: "row", gap: ui.compactMode ? 8 : 12 }}><StatCard label="Active" value={analytics.active} icon="checkmark-circle-outline" color={AdminColors.success} bg={AdminColors.successSoft} /><StatCard label="Suspended" value={analytics.suspended} icon="pause-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} /></View>
              {ui.showInsights && <Card title="Overview"><BreakdownList segments={[{ label: "Active", value: analytics.active, color: AdminColors.success }, { label: "Suspended", value: analytics.suspended, color: AdminColors.danger }, { label: "Admins", value: analytics.admins, color: AdminColors.primary }]} /><View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View></Card>}
              <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search name, email, role…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <PressableScale onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></PressableScale>}</View>
              <View style={styles.chips}>{filters.map((f) => (<PressableScale key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}><Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text></PressableScale>))}</View>
              <View style={styles.sortRow}><Text style={styles.sectionMeta}>{filteredUsers.length} result{filteredUsers.length===1?"":"s"}</Text><View style={styles.sortBtns}>{([{k:"recent",l:"Recent"},{k:"name",l:"Name"},{k:"email",l:"Email"}] as const).map((s)=>(<PressableScale key={s.k} onPress={()=>setSort(s.k)} style={[styles.sortChip, sort===s.k&&styles.sortChipActive]}><Text style={[styles.sortText, sort===s.k&&styles.sortTextActive]}>{s.l}</Text></PressableScale>))}</View></View>
            </View>}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No users match filters.</Text></View>} />
        )}
        <AdminBottomNav />
      </View>
      <AdminSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} ui={ui} lastSync={lastSync} syncing={syncing} onSyncNow={() => void fetchUsers(false, true)} onSignOut={signOut} extra={<View><PressableScale style={styles.settingAction} onPress={() => { setSettingsOpen(false); exportUsers(); }}><Ionicons name="share-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Export filtered users (CSV)</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => { setSearchQuery(""); setFilter("all"); setSort("recent"); }}><Ionicons name="filter-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>Reset filters & search</Text></PressableScale><PressableScale style={styles.settingAction} onPress={() => setAdminUiSettings({ privacyMode: !ui.privacyMode })}><Ionicons name="eye-off-outline" size={16} color={AdminColors.text} /><Text style={styles.settingActionText}>{ui.privacyMode ? "Disable privacy masking" : "Enable privacy masking"}</Text></PressableScale></View>} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:AdminColors.background}, screen:{flex:1}, list:{paddingHorizontal:20,paddingBottom:110},
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
  settingAction:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:11,borderBottomWidth:1,borderBottomColor:AdminColors.border}, settingActionText:{fontSize:14,color:AdminColors.text,fontWeight:"500"},
});
