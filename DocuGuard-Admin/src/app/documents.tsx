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
import { getAdminDocuments, type VaultDocument } from "../services/adminApi";
import { getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ProgressBar, ScreenHeader, StatCard } from "../components/ui";

type OcrFilter = "all" | "completed" | "pending" | "failed";
type SortKey = "recent" | "name" | "size";

export default function AdminDocumentsScreen() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<OcrFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selected, setSelected] = useState<VaultDocument | null>(null);

  const fetchDocuments = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminDocuments(token);
      const list = Array.isArray(data) ? data : (data as any)?.documents || [];
      setDocuments(list as VaultDocument[]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load documents.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  const analytics = useMemo(() => {
    const completed = documents.filter((d) => String(d.ocrStatus) === "completed").length;
    const pending = documents.filter((d) => String(d.ocrStatus) === "pending").length;
    const failed = documents.filter((d) => !["completed", "pending", "unknown"].includes(String(d.ocrStatus))).length;
    const unknown = documents.filter((d) => String(d.ocrStatus) === "unknown").length;
    const totalBytes = documents.reduce((s, d) => s + (Number(d.fileSize) || 0), 0);
    const successRate = documents.length ? Math.round((completed / documents.length) * 100) : 0;
    const avgSize = documents.length ? totalBytes / documents.length : 0;
    const prediction = failed > 0
      ? `${failed} document${failed > 1 ? "s" : ""} need OCR attention.`
      : pending > completed
        ? "Backlog high — processing may be delayed."
        : pending > 0
          ? `${pending} item${pending > 1 ? "s" : ""} still processing.`
          : "OCR pipeline stable.";
    return { completed, pending, failed, unknown, totalBytes, avgSize, successRate, prediction };
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = documents.filter((d) => {
      const ocr = String(d.ocrStatus || "pending");
      if (filter === "completed" && ocr !== "completed") return false;
      if (filter === "pending" && ocr !== "pending") return false;
      if (filter === "failed" && ["completed", "pending"].includes(ocr)) return false;
      if (!q) return true;
      return [d.title, d.fileName, d.ownerEmail, d.id, d.ocrStatus].some((v) => String(v || "").toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return String(a.title || a.fileName || "").localeCompare(String(b.title || b.fileName || ""));
      if (sort === "size") return Number(b.fileSize || 0) - Number(a.fileSize || 0);
      const ta = new Date((a as any).createdAt || 0).getTime();
      const tb = new Date((b as any).createdAt || 0).getTime();
      return tb - ta;
    });
    return list;
  }, [documents, searchQuery, filter, sort]);

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const k = 1024; const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const exportDocs = async () => {
    try {
      const rows = [["id", "title", "fileName", "ownerEmail", "ocrStatus", "fileSize", "createdAt"].join(",")];
      filteredDocs.forEach((d) => rows.push([d.id, d.title || "", d.fileName || "", d.ownerEmail || "", d.ocrStatus || "", d.fileSize || 0, (d as any).createdAt || ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")));
      await Share.share({ message: rows.join("\n"), title: "DocuGuard Documents Export" });
    } catch {
      Alert.alert("Export unavailable", "Could not share export on this device.");
    }
  };

  const filters: { key: OcrFilter; label: string }[] = [
    { key: "all", label: "All" }, { key: "completed", label: "Completed" }, { key: "pending", label: "Pending" }, { key: "failed", label: "Failed/Other" },
  ];

  const renderItem = ({ item }: { item: VaultDocument }) => {
    const ocr = String(item.ocrStatus || "pending");
    const tone = ocr === "completed" ? "success" : ocr === "pending" ? "warning" : "danger";
    return (
      <Pressable style={styles.docCard} onPress={() => setSelected(item)}>
        <View style={styles.iconBox}><Ionicons name="document-text-outline" size={20} color={AdminColors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.docTitle} numberOfLines={1}>{item.title || item.fileName || "Untitled"}</Text>
          <Text style={styles.docMeta} numberOfLines={1}>{item.ownerEmail || "Unknown owner"} · {formatFileSize(Number(item.fileSize || 0))}</Text>
          <View style={{ marginTop: 6 }}><Badge label={ocr} tone={tone as any} /></View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={AdminColors.textMuted} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Documents" subtitle={`${documents.length} files`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportDocs} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchDocuments()} label="Refresh" /></View>} />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading documents…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Could not load documents</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchDocuments()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : (
          <FlatList
            data={filteredDocs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            style={styles.listFlex}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchDocuments(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={
              <View style={{ gap: 14, marginBottom: 4 }}>
                <View style={styles.row}><StatCard label="OCR Success" value={`${analytics.successRate}%`} icon="scan-outline" color={AdminColors.success} bg={AdminColors.successSoft} /><StatCard label="Storage" value={formatFileSize(analytics.totalBytes)} icon="cloud-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} hint={`Avg ${formatFileSize(analytics.avgSize)}`} /></View>
                <Card title="OCR pipeline" subtitle="Processing status & prediction">
                  <BreakdownList segments={[{ label: "Completed", value: analytics.completed, color: AdminColors.success }, { label: "Pending", value: analytics.pending, color: AdminColors.warning }, { label: "Failed/Other", value: analytics.failed + analytics.unknown, color: AdminColors.danger }]} />
                  <View style={{ marginTop: 12, gap: 6 }}><View style={styles.progressRow}><Text style={styles.progressLabel}>Completion rate</Text><Text style={styles.progressPct}>{analytics.successRate}%</Text></View><ProgressBar value={analytics.successRate} color={AdminColors.success} /></View>
                  <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
                </Card>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={18} color={AdminColors.textMuted} />
                  <TextInput style={styles.searchInput} placeholder="Search title, owner, status…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />
                  {!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}
                </View>
                <View style={styles.chips}>{filters.map((f) => (<Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}><Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
                <View style={styles.sortRow}>
                  <Text style={styles.sectionMeta}>{filteredDocs.length} result{filteredDocs.length === 1 ? "" : "s"}</Text>
                  <View style={styles.sortBtns}>{([{ k: "recent", l: "Recent" }, { k: "name", l: "Name" }, { k: "size", l: "Size" }] as const).map((s) => (<Pressable key={s.k} onPress={() => setSort(s.k)} style={[styles.sortChip, sort === s.k && styles.sortChipActive]}><Text style={[styles.sortText, sort === s.k && styles.sortTextActive]}>{s.l}</Text></Pressable>))}</View>
                </View>
              </View>
            }
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="folder-open-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No documents match.</Text></View>}
          />
        )}
        <AdminBottomNav />
      </View>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {selected && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}><Text style={styles.modalTitle}>Document details</Text><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
                <DetailRow label="Title" value={selected.title || "—"} />
                <DetailRow label="File name" value={selected.fileName || "—"} />
                <DetailRow label="Owner" value={selected.ownerEmail || "—"} />
                <DetailRow label="OCR status" value={String(selected.ocrStatus || "—")} />
                <DetailRow label="Size" value={formatFileSize(Number(selected.fileSize || 0))} />
                <DetailRow label="Document ID" value={String(selected.id)} />
                <DetailRow label="Created" value={(selected as any).createdAt ? new Date((selected as any).createdAt).toLocaleString() : "—"} />
                <Pressable style={[styles.modalBtn, styles.modalBtnSecondary, { marginTop: 16 }]} onPress={() => setSelected(null)}><Text style={styles.modalBtnSecondaryText}>Close</Text></Pressable>
              </ScrollView>
            )}
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
  row: { flexDirection: "row", gap: 12 },
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
  sortRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sortBtns: { flexDirection: "row", gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: AdminColors.surfaceAlt },
  sortChipActive: { backgroundColor: AdminColors.primarySoft },
  sortText: { fontSize: 11, fontWeight: "600", color: AdminColors.textSecondary },
  sortTextActive: { color: AdminColors.primary },
  sectionMeta: { fontSize: 12, color: AdminColors.textMuted, fontWeight: "600" },
  docCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: AdminColors.surface, borderWidth: 1, borderColor: AdminColors.border, borderRadius: AdminRadii.lg, padding: 14 },
  iconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: AdminColors.primarySoft, alignItems: "center", justifyContent: "center" },
  docTitle: { fontSize: 15, fontWeight: "700", color: AdminColors.text },
  docMeta: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  progressRow: { flexDirection: "row", justifyContent: "space-between" },
  progressLabel: { fontSize: 12, color: AdminColors.textSecondary },
  progressPct: { fontSize: 12, fontWeight: "700", color: AdminColors.text },
  insight: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: AdminColors.border },
  insightText: { flex: 1, fontSize: 13, color: AdminColors.textSecondary, lineHeight: 18 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(16,24,40,0.4)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: AdminColors.surface, borderRadius: 20, padding: 18, maxHeight: "80%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: AdminColors.text },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
  detailLabel: { fontSize: 11, fontWeight: "700", color: AdminColors.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  detailValue: { fontSize: 14, color: AdminColors.text },
  modalBtn: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnSecondary: { backgroundColor: AdminColors.surfaceAlt },
  modalBtnSecondaryText: { fontWeight: "700", color: AdminColors.text },
});
