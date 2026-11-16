import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Platform, RefreshControl, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminDocuments, getAdminSystemHealth, logoutAdmin, type VaultDocument } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings, maskPerson } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminSettingsModal } from "../components/AdminSettingsModal";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ProgressBar, ScreenHeader, StatCard, SkeletonScreen, SyncLine, PressableScale, FadeInView } from "../components/ui";

type OcrFilter = "all" | "completed" | "pending" | "failed";
type SortKey = "recent" | "name" | "size";
const REFRESH_MS = 15000;

function fmtBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function catLabel(c: string) {
  const s = String(c || "other");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AdminDocumentsScreen() {
  const { width } = useWindowDimensions();
  const isWideNav = width >= 768;
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [ocrFilter, setOcrFilter] = useState<OcrFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [realStorageBytes, setRealStorageBytes] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadAdminUiSettings();
    return subscribeAdminUiSettings(() => setUi(getAdminUiSettings()));
  }, []);

  const fetchDocuments = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (silent || isRefresh) setSyncing(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) {
        router.replace("/");
        return;
      }
      const [docsRes, healthRes] = await Promise.allSettled([getAdminDocuments(token), getAdminSystemHealth(token)]);
      if (docsRes.status === "fulfilled") {
        const data = docsRes.value as any;
        setDocuments((Array.isArray(data) ? data : data?.documents || []) as VaultDocument[]);
        setLastSync(new Date());
      } else {
        throw docsRes.reason;
      }
      if (healthRes.status === "fulfilled") {
        const h: any = (healthRes.value as any)?.health ?? (healthRes.value as any);
        const bytes = Number(h?.supabaseStorage?.bucketUsageBytes ?? 0);
        setRealStorageBytes(Number.isFinite(bytes) ? bytes : null);
      } else {
        setRealStorageBytes(null);
      }
    } catch (error) {
      if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load documents.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setTimeout(() => setSyncing(false), 350);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (ui.autoSync)
      timerRef.current = setInterval(() => {
        void fetchDocuments(false, true);
      }, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [ui.autoSync, fetchDocuments]);

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((d) => {
      const c = String((d as any).category || "other").toLowerCase() || "other";
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [documents]);

  useEffect(() => {
    if (categoryFilter !== "all" && !categories.some(([c]) => c === categoryFilter)) setCategoryFilter("all");
  }, [categories, categoryFilter]);

  const analytics = useMemo(() => {
    const completed = documents.filter((d) => String(d.ocrStatus) === "completed").length;
    const pending = documents.filter((d) => String(d.ocrStatus) === "pending").length;
    const failed = documents.filter((d) => !["completed", "pending", "unknown"].includes(String(d.ocrStatus))).length;
    const totalBytes = documents.reduce((s, d) => {
      const anyD = d as any;
      const raw =
        anyD.fileSize ?? anyD.file_size ?? anyD.size ?? anyD.bytes ?? anyD.storageBytes ?? anyD.file_size_bytes ?? anyD.fileSizeBytes ?? anyD.sizeBytes ?? anyD.length ?? 0;
      const v = typeof raw === "string" ? Number(raw) : Number(raw);
      return s + (Number.isFinite(v) && v >= 0 ? v : 0);
    }, 0);
    const successRate = documents.length ? Math.round((completed / documents.length) * 100) : 0;
    const storageDisplayBytes = realStorageBytes != null && realStorageBytes >= 0 ? realStorageBytes : totalBytes;
    return {
      completed,
      pending,
      failed,
      totalBytes,
      storageDisplayBytes,
      successRate,
      prediction:
        failed > 0
          ? `${failed} OCR issue${failed > 1 ? "s" : ""} need attention.`
          : pending > 0
            ? `${pending} item${pending > 1 ? "s" : ""} still processing.`
            : "OCR pipeline stable.",
    };
  }, [documents, realStorageBytes]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = documents.filter((d) => {
      const ocr = String(d.ocrStatus || "pending");
      const cat = String((d as any).category || "other").toLowerCase();
      if (ocrFilter === "completed" && ocr !== "completed") return false;
      if (ocrFilter === "pending" && ocr !== "pending") return false;
      if (ocrFilter === "failed" && ["completed", "pending"].includes(ocr)) return false;
      if (categoryFilter !== "all" && cat !== categoryFilter) return false;
      if (!q) return true;
      return [d.title, d.fileName, d.ownerEmail, d.id, ocr, cat].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      const anyA = a as any;
      const anyB = b as any;
      if (sort === "name") return String(a.title || a.fileName || "").localeCompare(String(b.title || b.fileName || ""));
      if (sort === "size") return Number(anyB.fileSize ?? anyB.file_size ?? anyB.size ?? 0) - Number(anyA.fileSize ?? anyA.file_size ?? anyA.size ?? 0);
      return new Date((b as any).createdAt || 0).getTime() - new Date((a as any).createdAt || 0).getTime();
    });
    return list;
  }, [documents, searchQuery, ocrFilter, categoryFilter, sort]);

  const exportDocs = async () => {
    try {
      const rows = [["id", "title", "fileName", "category", "ownerEmail", "ocrStatus", "fileSize", "createdAt"].join(",")];
      filteredDocs.forEach((d) => {
        const anyD = d as any;
        const sizeVal = Number(anyD.fileSize ?? anyD.file_size ?? anyD.size ?? 0);
        rows.push(
          [
            ui.privacyMode ? maskPerson(d.id) : d.id,
            d.title || "",
            ui.privacyMode ? "restricted" : d.fileName || "",
            anyD.category || "other",
            ui.privacyMode ? maskPerson(d.ownerEmail) : d.ownerEmail || "",
            d.ocrStatus || "",
            Number.isFinite(sizeVal) ? sizeVal : 0,
            anyD.createdAt || "",
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
      });
      const csv = rows.join("\n");
      const filename = `documents-export-${new Date().toISOString().slice(0, 10)}.csv`;

      if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      await Share.share({ message: csv, title: "Documents Export" });
    } catch {
      Alert.alert("Export unavailable", "Could not share/export.");
    }
  };

  const signOut = async () => {
    setSettingsOpen(false);
    try {
      const t = await getAdminToken();
      if (t) await logoutAdmin(t);
      else await clearAdminToken();
    } catch {
      await clearAdminToken();
    }
    router.replace("/");
  };
  const gap = ui.compactMode ? 10 : 14;

  const renderItem = ({ item }: { item: VaultDocument }) => {
    const anyD = item as any;
    const ocr = String(item.ocrStatus || "pending");
    const tone = ocr === "completed" ? "success" : ocr === "pending" ? "warning" : "danger";
    const cat = String(anyD.category || "other").toLowerCase();
    const sizeVal = Number(anyD.fileSize ?? anyD.file_size ?? anyD.size ?? 0);
    return (
      <FadeInView>
        <View style={styles.docCard}>
          <View style={styles.iconBox}>
            <Ionicons name="document-text-outline" size={20} color={AdminColors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.docTitle} numberOfLines={1}>
              {item.title || item.fileName || "Untitled"}
            </Text>
            <Text style={styles.docMeta} numberOfLines={1}>
              {ui.privacyMode ? maskPerson(item.ownerEmail) : item.ownerEmail || "Unknown owner"} · {fmtBytes(Number.isFinite(sizeVal) ? sizeVal : 0)}
            </Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <Badge label={ocr} tone={tone as any} />
              <Badge label={catLabel(cat)} tone="neutral" />
            </View>
          </View>
        </View>
      </FadeInView>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <SyncLine syncing={syncing} />
        <ScreenHeader
          title="Documents"
          subtitle={`${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}${syncing ? " · syncing" : ""}`}
          right={
            <View style={{ flexDirection: "row", gap: 8 }}>
              <IconButton icon="share-outline" onPress={exportDocs} label="Export" />
              <IconButton icon="refresh-outline" onPress={() => void fetchDocuments(true)} label="Refresh" spinning={syncing} />
              <IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" />
            </View>
          }
        />
        {loading && documents.length === 0 ? (
          <SkeletonScreen />
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: isWideNav ? 160 : 20 }}>
            <Card>
              <Text style={styles.errorTitle}>Could not load documents</Text>
              <Text style={styles.muted}>{errorMessage}</Text>
              <PressableScale style={styles.retryBtn} onPress={() => void fetchDocuments()}>
                <Text style={styles.retryText}>Try again</Text>
              </PressableScale>
            </Card>
          </View>
        ) : (
          <FlatList
            data={filteredDocs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={[styles.list, { gap: ui.compactMode ? 8 : 10, paddingRight: isWideNav ? 160 : 20 }]}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void fetchDocuments(true)} tintColor={AdminColors.primary} />
            }
            ListHeaderComponent={
              <View style={{ gap, marginBottom: 2 }}>
                <View style={{ flexDirection: "row", gap: ui.compactMode ? 8 : 12 }}>
                  <StatCard
                    label="OCR Success"
                    value={`${analytics.successRate}%`}
                    icon="scan-outline"
                    color={AdminColors.success}
                    bg={AdminColors.successSoft}
                  />
                  <StatCard
                    label="Storage"
                    value={fmtBytes(analytics.storageDisplayBytes)}
                    icon="cloud-outline"
                    color={AdminColors.primary}
                    bg={AdminColors.primarySoft}
                    hint={realStorageBytes != null ? "Live (from server)" : "From list sum"}
                  />
                </View>
                {ui.showInsights && (
                  <Card title="OCR pipeline">
                    <BreakdownList
                      segments={[
                        { label: "Completed", value: analytics.completed, color: AdminColors.success },
                        { label: "Pending", value: analytics.pending, color: AdminColors.warning },
                        { label: "Failed/Other", value: analytics.failed, color: AdminColors.danger },
                      ]}
                    />
                    <View style={{ marginTop: 12, gap: 6 }}>
                      <View style={styles.progressRow}>
                        <Text style={styles.progressLabel}>Completion</Text>
                        <Text style={styles.progressPct}>{analytics.successRate}%</Text>
                      </View>
                      <ProgressBar value={analytics.successRate} color={AdminColors.success} />
                    </View>
                    <View style={styles.insight}>
                      <Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} />
                      <Text style={styles.insightText}>{analytics.prediction}</Text>
                    </View>
                  </Card>
                )}
                <Card title="Categories" subtitle="Filter by category and totals">
                  <View style={styles.catGrid}>
                    <PressableScale
                      style={[styles.catChip, categoryFilter === "all" && styles.catChipActive]}
                      onPress={() => setCategoryFilter("all")}
                    >
                      <Text style={[styles.catChipLabel, categoryFilter === "all" && styles.catChipLabelActive]}>All</Text>
                      <View style={[styles.catCount, categoryFilter === "all" && styles.catCountActive]}>
                        <Text style={[styles.catCountText, categoryFilter === "all" && styles.catCountTextActive]}>{documents.length}</Text>
                      </View>
                    </PressableScale>
                    {categories.map(([cat, count]) => (
                      <PressableScale
                        key={cat}
                        style={[styles.catChip, categoryFilter === cat && styles.catChipActive]}
                        onPress={() => setCategoryFilter(cat)}
                      >
                        <Text style={[styles.catChipLabel, categoryFilter === cat && styles.catChipLabelActive]} numberOfLines={1}>
                          {catLabel(cat)}
                        </Text>
                        <View style={[styles.catCount, categoryFilter === cat && styles.catCountActive]}>
                          <Text style={[styles.catCountText, categoryFilter === cat && styles.catCountTextActive]}>{count}</Text>
                        </View>
                      </PressableScale>
                    ))}
                  </View>
                  {!categories.length && <Text style={styles.muted}>No category data from backend.</Text>}
                </Card>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={18} color={AdminColors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search title, owner, category, status…"
                    placeholderTextColor={AdminColors.textMuted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  {!!searchQuery && (
                    <PressableScale onPress={() => setSearchQuery("")}>
                      <Ionicons name="close-circle" size={18} color={AdminColors.textMuted} />
                    </PressableScale>
                  )}
                </View>
                <View style={styles.chips}>
                  {(
                    [
                      { key: "all", label: "All OCR" },
                      { key: "completed", label: "Completed" },
                      { key: "pending", label: "Pending" },
                      { key: "failed", label: "Failed/Other" },
                    ] as const
                  ).map((f) => (
                    <PressableScale key={f.key} style={[styles.chip, ocrFilter === f.key && styles.chipActive]} onPress={() => setOcrFilter(f.key)}>
                      <Text style={[styles.chipText, ocrFilter === f.key && styles.chipTextActive]}>{f.label}</Text>
                    </PressableScale>
                  ))}
                </View>
                <View style={styles.sortRow}>
                  <Text style={styles.sectionMeta}>
                    {filteredDocs.length} result{filteredDocs.length === 1 ? "" : "s"}
                    {categoryFilter !== "all" ? ` · ${catLabel(categoryFilter)}` : ""}
                  </Text>
                  <View style={styles.sortBtns}>
                    {(
                      [
                        { k: "recent", l: "Recent" },
                        { k: "name", l: "Name" },
                        { k: "size", l: "Size" },
                      ] as const
                    ).map((s) => (
                      <PressableScale key={s.k} onPress={() => setSort(s.k)} style={[styles.sortChip, sort === s.k && styles.sortChipActive]}>
                        <Text style={[styles.sortText, sort === s.k && styles.sortTextActive]}>{s.l}</Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="folder-open-outline" size={40} color={AdminColors.textMuted} />
                <Text style={styles.muted}>No documents match filters.</Text>
              </View>
            }
          />
        )}
        <AdminBottomNav />
      </View>
      <AdminSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        ui={ui}
        lastSync={lastSync}
        syncing={syncing}
        onSyncNow={() => void fetchDocuments(false, true)}
        onSignOut={signOut}
        extra={
          <View>
            <PressableScale
              style={styles.settingAction}
              onPress={() => {
                setSettingsOpen(false);
                exportDocs();
              }}
            >
              <Ionicons name="share-outline" size={16} color={AdminColors.text} />
              <Text style={styles.settingActionText}>Export filtered documents (CSV)</Text>
            </PressableScale>
            <PressableScale
              style={styles.settingAction}
              onPress={() => {
                setSearchQuery("");
                setOcrFilter("all");
                setCategoryFilter("all");
                setSort("recent");
              }}
            >
              <Ionicons name="filter-outline" size={16} color={AdminColors.text} />
              <Text style={styles.settingActionText}>Reset filters & search</Text>
            </PressableScale>
            <PressableScale style={styles.settingAction} onPress={() => setAdminUiSettings({ privacyMode: !ui.privacyMode })}>
              <Ionicons name="eye-off-outline" size={16} color={AdminColors.text} />
              <Text style={styles.settingActionText}>{ui.privacyMode ? "Disable privacy masking" : "Enable privacy masking"}</Text>
            </PressableScale>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background },
  screen: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 110 },
  muted: { fontSize: 13, color: AdminColors.textSecondary, lineHeight: 19 },
  errorTitle: { fontSize: 16, fontWeight: "700", color: AdminColors.dangerText, marginBottom: 4 },
  retryBtn: {
    alignSelf: "flex-start",
    marginTop: 12,
    backgroundColor: AdminColors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: AdminRadii.sm,
  },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: AdminColors.surface,
    borderWidth: 1,
    borderColor: AdminColors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
  },
  searchInput: { flex: 1, fontSize: 14, color: AdminColors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: AdminRadii.pill,
    backgroundColor: AdminColors.surface,
    borderWidth: 1,
    borderColor: AdminColors.border,
  },
  chipActive: { backgroundColor: AdminColors.primary, borderColor: AdminColors.primary },
  chipText: { fontSize: 12, fontWeight: "600", color: AdminColors.textSecondary },
  chipTextActive: { color: "#fff" },
  sortRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sortBtns: { flexDirection: "row", gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: AdminColors.surfaceAlt },
  sortChipActive: { backgroundColor: AdminColors.primarySoft },
  sortText: { fontSize: 11, fontWeight: "600", color: AdminColors.textSecondary },
  sortTextActive: { color: AdminColors.primary },
  sectionMeta: { fontSize: 12, color: AdminColors.textMuted, fontWeight: "600", flex: 1 },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: AdminColors.surface,
    borderWidth: 1,
    borderColor: AdminColors.border,
    borderRadius: AdminRadii.lg,
    padding: 14,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: AdminColors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  docTitle: { fontSize: 15, fontWeight: "700", color: AdminColors.text },
  docMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  progressRow: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontSize: 12, color: AdminColors.textSecondary },
  progressPct: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  insight: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: AdminColors.surfaceAlt,
    borderWidth: 1,
    borderColor: AdminColors.border,
  },
  catChipActive: { backgroundColor: AdminColors.primarySoft, borderColor: "#BFDBFE" },
  catChipLabel: { fontSize: 12, fontWeight: "600", color: AdminColors.textSecondary, maxWidth: 140 },
  catChipLabelActive: { color: AdminColors.primaryDark },
  catCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: AdminColors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: AdminColors.border,
  },
  catCountActive: { backgroundColor: AdminColors.primary, borderColor: AdminColors.primary },
  catCountText: { fontSize: 11, fontWeight: "700", color: AdminColors.text },
  catCountTextActive: { color: "#fff" },
  settingAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: AdminColors.border,
  },
  settingActionText: { fontSize: 14, color: AdminColors.text, fontWeight: "500" },
});
