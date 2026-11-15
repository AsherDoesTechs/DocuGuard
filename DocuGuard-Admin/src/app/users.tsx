import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminUsers, updateAdminUserStatus, type AdminUser } from "../services/adminApi";
import { getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ScreenHeader, StatCard } from "../components/ui";

type Filter = "all" | "active" | "suspended" | "admin";

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminUsers(token);
      const list = Array.isArray(data) ? data : (data as any)?.users || [];
      setUsers(list as AdminUser[]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load users.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  const analytics = useMemo(() => {
    const active = users.filter((u) => String(u.status || "active") === "active").length;
    const suspended = users.filter((u) => String(u.status) === "suspended").length;
    const admins = users.filter((u) => String(u.role) === "admin").length;
    const inactiveRate = users.length ? Math.round(((users.length - active) / users.length) * 100) : 0;
    const prediction = suspended > 0
      ? `${suspended} suspended account${suspended > 1 ? "s" : ""} — review access if not intentional.`
      : inactiveRate > 20
        ? `${inactiveRate}% non-active rate — consider engagement or cleanup.`
        : "User activity looks healthy. No immediate action predicted.";
    return { active, suspended, admins, prediction };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      const status = String(u.status || "active");
      const role = String(u.role || "user");
      if (filter === "active" && status !== "active") return false;
      if (filter === "suspended" && status !== "suspended") return false;
      if (filter === "admin" && role !== "admin") return false;
      if (!q) return true;
      return String(u.email || "").toLowerCase().includes(q) || String(u.name || "").toLowerCase().includes(q);
    });
  }, [users, searchQuery, filter]);

  const handleToggleStatus = (userId: string | number, currentStatus?: string) => {
    const status = String(currentStatus || "active");
    const nextStatus = status === "active" ? "suspended" : "active";
    Alert.alert(`${nextStatus === "suspended" ? "Suspend" : "Activate"} user`, `Confirm ${nextStatus} for this account?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        style: nextStatus === "suspended" ? "destructive" : "default",
        onPress: async () => {
          try {
            const token = await getAdminToken();
            if (!token) return;
            await updateAdminUserStatus(token, userId, nextStatus as any);
            setUsers((prev) => prev.map((u) => (String(u.id) === String(userId) ? { ...u, status: nextStatus } : u)));
          } catch (err: any) {
            Alert.alert("Update failed", err?.message || "Could not update status.");
          }
        },
      },
    ]);
  };

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" }, { key: "active", label: "Active" }, { key: "suspended", label: "Suspended" }, { key: "admin", label: "Admins" },
  ];

  const renderItem = ({ item }: { item: AdminUser }) => {
    const status = String(item.status || "active");
    const isActive = status === "active";
    const name = item.name || "Unnamed User";
    return (
      <View style={styles.userCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(name || item.email || "?").charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName} numberOfLines={1}>{name}</Text>
          <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
          <View style={styles.badgeRow}>
            <Badge label={status} tone={isActive ? "success" : "danger"} />
            <Badge label={String(item.role || "user")} tone={String(item.role) === "admin" ? "primary" : "neutral"} />
          </View>
        </View>
        <Pressable style={[styles.actionBtn, isActive ? styles.suspendBtn : styles.activateBtn]} onPress={() => handleToggleStatus(item.id, status)}>
          <Text style={[styles.actionText, isActive ? styles.suspendText : styles.activateText]}>{isActive ? "Suspend" : "Activate"}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Users" subtitle={`${users.length} accounts`} right={<IconButton icon="refresh-outline" onPress={() => void fetchUsers()} />} />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading users…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}>
            <Card>
              <Text style={styles.errorTitle}>Could not load users</Text>
              <Text style={styles.muted}>{errorMessage}</Text>
              <Text style={styles.errorHint}>Check admin token, network, and that the server is reachable and up to date.</Text>
              <Pressable style={styles.retryBtn} onPress={() => void fetchUsers()}><Text style={styles.retryText}>Try again</Text></Pressable>
            </Card>
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchUsers(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={
              <View style={{ gap: 14, marginBottom: 4 }}>
                <View style={styles.row}>
                  <StatCard label="Active" value={analytics.active} icon="checkmark-circle-outline" color={AdminColors.success} bg={AdminColors.successSoft} />
                  <StatCard label="Suspended" value={analytics.suspended} icon="pause-circle-outline" color={AdminColors.danger} bg={AdminColors.dangerSoft} />
                </View>
                <Card title="Account Breakdown" subtitle="Role and status distribution">
                  <BreakdownList segments={[
                    { label: "Active users", value: analytics.active, color: AdminColors.success },
                    { label: "Suspended", value: analytics.suspended, color: AdminColors.danger },
                    { label: "Admins", value: analytics.admins, color: AdminColors.primary },
                  ]} />
                  <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
                </Card>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={18} color={AdminColors.textMuted} />
                  <TextInput style={styles.searchInput} placeholder="Search name or email" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />
                  {!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}
                </View>
                <View style={styles.chips}>
                  {filters.map((f) => (
                    <Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}>
                      <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.sectionMeta}>{filteredUsers.length} result{filteredUsers.length === 1 ? "" : "s"}</Text>
              </View>
            }
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No users match your filters.</Text></View>}
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
  row: { flexDirection: "row", gap: 12 },
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
  userCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 14 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: AdminColors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontWeight: "700", color: AdminColors.primary },
  userName: { fontSize: 15, fontWeight: "700", color: AdminColors.text },
  userEmail: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 1 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  suspendBtn: { backgroundColor: AdminColors.dangerSoft, borderColor: "#FECACA" },
  activateBtn: { backgroundColor: AdminColors.successSoft, borderColor: "#BBF7D0" },
  actionText: { fontSize: 12, fontWeight: "700" },
  suspendText: { color: AdminColors.dangerText },
  activateText: { color: AdminColors.successText },
  insight: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
});
