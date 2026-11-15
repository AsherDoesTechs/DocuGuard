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
import { getAdminDocuments, type VaultDocument } from "../services/adminApi";
import { getAdminToken } from "../services/adminSession";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ProgressBar, ScreenHeader, StatCard } from "../components/ui";

type OcrFilter = "all" | "completed" | "pending" | "failed";

export default function AdminDocumentsScreen() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<OcrFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  const analytics = useMemo(() => {
    const completed = documents.filter((d) => String(d.ocrStatus) === "completed").length;
    const pending = documents.filter((d) => String(d.ocrStatus) === "pending").length;
    const failed = documents.filter((d) => !["completed", "pending"].includes(String(d.ocrStatus))).length;
    const totalBytes = documents.reduce((s, d) => s + (Number(d.fileSize) || 0), 0);
    const successRate = documents.length ? Math.round((completed / documents.length) * 100) : 0;
    const prediction = failed > 0
      ? `${failed} failed OCR item${failed > 1 ? "s" : ""} — review uploads/formats.`
      : pending > completed
        ? "OCR backlog higher than completed — expect processing delays."
        : pending > 0
          ? `${pending} item${pending > 1 ? "s" : ""} still processing.`
          : "OCR pipeline stable.";
    return { completed, pending, failed, totalBytes, successRate, prediction };
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((d) => {
      const ocr = String(d.ocrStatus || "pending");
      if (filter === "completed" && ocr !== "completed") return false;
      if (filter === "pending" && ocr !== "pending") return false;
      if (filter === "failed" && ["completed", "pending"].includes(ocr)) return false;
      if (!q) return true;
      return [d.title, d.fileName, d.ownerEmail].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [documents, searchQuery, filter]);

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const k = 1024; const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const filters: { key: OcrFilter; label: string }[] = [
    { key: "all", label: "All" }, { key: "completed", label: "Completed" }, { key: "pending", label: "Pending" }, { key: "failed", label: "Failed" },
  ];

  const renderItem = ({ item }: { item: VaultDocument }) => {
    const ocr = String(item.ocrStatus || "pending");
    const tone = ocr === "completed" ? "success" : ocr === "pending" ? "warning" : "danger";
    return (
      <Pressable style={styles.docCard} onPress={() => Alert.alert("Document", `Title: ${item.title || item.fileName}\nOwner: ${item.ownerEmail || "Unknown"}\nOCR: ${ocr.toUpperCase()}\nSize: ${formatFileSize(Number(item.fileSize || 0))}`, [{ text: "Close" }])}>
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
        <ScreenHeader title="Documents" subtitle={`${documents.length} files`} right={<IconButton icon="refresh-outline" onPress={() => void fetchDocuments()} />} />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /><Text style={styles.muted}>Loading documents…</Text></View>
        ) : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}>
            <Card><Text style={styles.errorTitle}>Could not load documents</Text><Text style={styles.muted}>{errorMessage}</Text><Text style={styles.errorHint}>Check token, network, and server routes/DB schema.</Text>
              <Pressable style={styles.retryBtn} onPress={() => void fetchDocuments()}><Text style={styles.retryText}>Try again</Text></Pressable></Card>
          </View>
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
                <View style={styles.row}>
                  <StatCard label="OCR Success" value={`${analytics.successRate}%`} icon="scan-outline" color={AdminColors.success} bg={AdminColors.successSoft} />
                  <StatCard label="Storage" value={formatFileSize(analytics.totalBytes)} icon="cloud-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} />
                </View>
                <Card title="OCR Pipeline" subtitle="Processing status & prediction">
                  <BreakdownList segments={[
                    { label: "Completed", value: analytics.completed, color: AdminColors.success },
                    { label: "Pending", value: analytics.pending, color: AdminColors.warning },
                    { label: "Failed / Other", value: analytics.failed, color: AdminColors.danger },
                  ]} />
                  <View style={{ marginTop: 12, gap: 6 }}>
                    <View style={styles.progressRow}><Text style={styles.progressLabel}>Completion rate</Text><Text style={styles.progressPct}>{analytics.successRate}%</Text></View>
                    <ProgressBar value={analytics.successRate} color={AdminColors.success} />
                  </View>
                  <View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View>
                </Card>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={18} color={AdminColors.textMuted} />
                  <TextInput style={styles.searchInput} placeholder="Search title, file, owner" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />
                  {!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}
                </View>
                <View style={styles.chips}>{filters.map((f) => (<Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}><Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
                <Text style={styles.sectionMeta}>{filteredDocs.length} result{filteredDocs.length === 1 ? "" : "s"}</Text>
              </View>
            }
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="folder-open-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No documents match.</Text></View>}
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
});
