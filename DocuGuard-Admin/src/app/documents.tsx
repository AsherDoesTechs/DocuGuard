import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminDocuments, logoutAdmin, getAdminApiBaseUrl, type VaultDocument } from "../services/adminApi";
import { getAdminToken, clearAdminToken } from "../services/adminSession";
import { getAdminUiSettings, setAdminUiSettings, subscribeAdminUiSettings, loadAdminUiSettings, maskEmail } from "../services/adminSettings";
import { AdminBottomNav } from "../components/AdminBottomNav";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { Badge, BreakdownList, Card, IconButton, ProgressBar, ScreenHeader, StatCard, SkeletonScreen } from "../components/ui";

type OcrFilter = "all" | "completed" | "pending" | "failed";
type SortKey = "recent" | "name" | "size";
const REFRESH_MS = 15000;

function fmtBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024; const sizes = ["B", "KB", "MB", "GB"]; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function catLabel(c: string) { const s = String(c || "other"); return s.charAt(0).toUpperCase() + s.slice(1); }

export default function AdminDocumentsScreen() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [ocrFilter, setOcrFilter] = useState<OcrFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selected, setSelected] = useState<VaultDocument | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ui, setUi] = useState(getAdminUiSettings());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadAdminUiSettings(); return subscribeAdminUiSettings(() => setUi(getAdminUiSettings())); }, []);

  const fetchDocuments = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true); else if (!silent) setLoading(true);
    setErrorMessage("");
    try {
      const token = await getAdminToken();
      if (!token) { router.replace("/"); return; }
      const data = await getAdminDocuments(token);
      const list = Array.isArray(data) ? data : (data as any)?.documents || [];
      setDocuments(list as VaultDocument[]);
      setLastSync(new Date());
    } catch (error) { if (!silent) setErrorMessage(error instanceof Error ? error.message : "Unable to load documents."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);
  useEffect(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } if (ui.autoSync) timerRef.current = setInterval(() => { void fetchDocuments(false, true); }, REFRESH_MS); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [ui.autoSync, fetchDocuments]);

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((d) => { const c = String((d as any).category || "other").toLowerCase() || "other"; counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  }, [documents]);

  useEffect(() => { if (categoryFilter !== "all" && !categories.some(([c]) => c === categoryFilter)) setCategoryFilter("all"); }, [categories, categoryFilter]);

  const analytics = useMemo(() => {
    const completed = documents.filter((d) => String(d.ocrStatus) === "completed").length;
    const pending = documents.filter((d) => String(d.ocrStatus) === "pending").length;
    const failed = documents.filter((d) => !["completed","pending","unknown"].includes(String(d.ocrStatus))).length;
    const unknown = documents.filter((d) => String(d.ocrStatus) === "unknown").length;
    const totalBytes = documents.reduce((s, d) => s + (Number(d.fileSize) || 0), 0);
    const successRate = documents.length ? Math.round((completed / documents.length) * 100) : 0;
    const prediction = failed > 0 ? `${failed} document${failed>1?"s":""} need OCR attention.` : pending > 0 ? `${pending} item${pending>1?"s":""} still processing.` : "OCR pipeline stable.";
    return { completed, pending, failed, unknown, totalBytes, successRate, prediction };
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = documents.filter((d) => {
      const ocr = String(d.ocrStatus || "pending");
      const cat = String((d as any).category || "other").toLowerCase();
      if (ocrFilter === "completed" && ocr !== "completed") return false;
      if (ocrFilter === "pending" && ocr !== "pending") return false;
      if (ocrFilter === "failed" && ["completed","pending"].includes(ocr)) return false;
      if (categoryFilter !== "all" && cat !== categoryFilter) return false;
      if (!q) return true;
      return [d.title, d.fileName, d.ownerEmail, d.id, ocr, cat].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return String(a.title || a.fileName || "").localeCompare(String(b.title || b.fileName || ""));
      if (sort === "size") return Number(b.fileSize || 0) - Number(a.fileSize || 0);
      const ta = new Date((a as any).createdAt || 0).getTime(); const tb = new Date((b as any).createdAt || 0).getTime(); return tb - ta;
    });
    return list;
  }, [documents, searchQuery, ocrFilter, categoryFilter, sort]);

  const exportDocs = async () => {
    try {
      const rows = [["id","title","fileName","category","ownerEmail","ocrStatus","fileSize","createdAt"].join(",")];
      filteredDocs.forEach((d) => rows.push([d.id, d.title||"", d.fileName||"", (d as any).category||"other", ui.privacyMode ? maskEmail(d.ownerEmail) : (d.ownerEmail||""), d.ocrStatus||"", d.fileSize||0, (d as any).createdAt||""].map((v)=>`"${String(v).replace(/"/g,'""')}"`).join(",")));
      await Share.share({ message: rows.join("\n"), title: "DocuGuard Documents Export" });
    } catch { Alert.alert("Export unavailable", "Could not share export."); }
  };

  const signOut = async () => { setSettingsOpen(false); try { const t = await getAdminToken(); if (t) await logoutAdmin(t); else await clearAdminToken(); } catch { await clearAdminToken(); } router.replace("/"); };
  const ocrFilters: { key: OcrFilter; label: string }[] = [{ key: "all", label: "All OCR" }, { key: "completed", label: "Completed" }, { key: "pending", label: "Pending" }, { key: "failed", label: "Failed/Other" }];

  const renderItem = ({ item }: { item: VaultDocument }) => {
    const ocr = String(item.ocrStatus || "pending");
    const tone = ocr === "completed" ? "success" : ocr === "pending" ? "warning" : "danger";
    const cat = String((item as any).category || "other").toLowerCase();
    const owner = ui.privacyMode ? maskEmail(item.ownerEmail) : (item.ownerEmail || "Unknown owner");
    return (
      <Pressable style={styles.docCard} onPress={() => setSelected(item)}>
        <View style={styles.iconBox}><Ionicons name="document-text-outline" size={20} color={AdminColors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.docTitle} numberOfLines={1}>{item.title || item.fileName || "Untitled"}</Text>
          <Text style={styles.docMeta} numberOfLines={1}>{owner} · {fmtBytes(Number(item.fileSize || 0))}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <Badge label={ocr} tone={tone as any} />
            <Badge label={catLabel(cat)} tone="neutral" />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={AdminColors.textMuted} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.screen}>
        <ScreenHeader title="Documents" subtitle={`${documents.length} files · ${ui.autoSync ? "Auto-sync 15s" : "Sync paused"}${lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ""}`} right={<View style={{ flexDirection: "row", gap: 8 }}><IconButton icon="share-outline" onPress={exportDocs} label="Export" /><IconButton icon="refresh-outline" onPress={() => void fetchDocuments(true)} label="Refresh" /><IconButton icon="settings-outline" onPress={() => setSettingsOpen(true)} label="Settings" tone="primary" /></View>} />

        {loading && documents.length === 0 ? <SkeletonScreen /> : errorMessage ? (
          <View style={{ paddingHorizontal: 20, flex: 1 }}><Card><Text style={styles.errorTitle}>Could not load documents</Text><Text style={styles.muted}>{errorMessage}</Text><Pressable style={styles.retryBtn} onPress={() => void fetchDocuments()}><Text style={styles.retryText}>Try again</Text></Pressable></Card></View>
        ) : (
          <FlatList data={filteredDocs} keyExtractor={(item) => String(item.id)} renderItem={renderItem} contentContainerStyle={styles.list} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchDocuments(true)} tintColor={AdminColors.primary} />}
            ListHeaderComponent={<View style={{ gap: 14, marginBottom: 4 }}>
              <View style={styles.row}><StatCard label="OCR Success" value={`${analytics.successRate}%`} icon="scan-outline" color={AdminColors.success} bg={AdminColors.successSoft} /><StatCard label="Storage" value={fmtBytes(analytics.totalBytes)} icon="cloud-outline" color={AdminColors.primary} bg={AdminColors.primarySoft} /></View>
              <Card title="OCR pipeline" subtitle="Processing status"><BreakdownList segments={[{ label: "Completed", value: analytics.completed, color: AdminColors.success }, { label: "Pending", value: analytics.pending, color: AdminColors.warning }, { label: "Failed/Other", value: analytics.failed + analytics.unknown, color: AdminColors.danger }]} /><View style={{ marginTop: 12, gap: 6 }}><View style={styles.progressRow}><Text style={styles.progressLabel}>Completion rate</Text><Text style={styles.progressPct}>{analytics.successRate}%</Text></View><ProgressBar value={analytics.successRate} color={AdminColors.success} /></View><View style={styles.insight}><Ionicons name="sparkles-outline" size={14} color={AdminColors.primary} /><Text style={styles.insightText}>{analytics.prediction}</Text></View></Card>

              <Card title="Categories" subtitle="Filter by document category (with totals)">
                <View style={styles.catGrid}>
                  <Pressable style={[styles.catChip, categoryFilter === "all" && styles.catChipActive]} onPress={() => setCategoryFilter("all")}><Text style={[styles.catChipLabel, categoryFilter === "all" && styles.catChipLabelActive]}>All</Text><View style={[styles.catCount, categoryFilter === "all" && styles.catCountActive]}><Text style={[styles.catCountText, categoryFilter === "all" && styles.catCountTextActive]}>{documents.length}</Text></View></Pressable>
                  {categories.map(([cat, count]) => (<Pressable key={cat} style={[styles.catChip, categoryFilter === cat && styles.catChipActive]} onPress={() => setCategoryFilter(cat)}><Text style={[styles.catChipLabel, categoryFilter === cat && styles.catChipLabelActive]} numberOfLines={1}>{catLabel(cat)}</Text><View style={[styles.catCount, categoryFilter === cat && styles.catCountActive]}><Text style={[styles.catCountText, categoryFilter === cat && styles.catCountTextActive]}>{count}</Text></View></Pressable>))}
                </View>
                {!categories.length && <Text style={styles.muted}>No category data available from backend.</Text>}
              </Card>

              <View style={styles.searchWrap}><Ionicons name="search-outline" size={18} color={AdminColors.textMuted} /><TextInput style={styles.searchInput} placeholder="Search title, owner, category, status…" placeholderTextColor={AdminColors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />{!!searchQuery && <Pressable onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={AdminColors.textMuted} /></Pressable>}</View>
              <View style={styles.chips}>{ocrFilters.map((f) => (<Pressable key={f.key} style={[styles.chip, ocrFilter === f.key && styles.chipActive]} onPress={() => setOcrFilter(f.key)}><Text style={[styles.chipText, ocrFilter === f.key && styles.chipTextActive]}>{f.label}</Text></Pressable>))}</View>
              <View style={styles.sortRow}><Text style={styles.sectionMeta}>{filteredDocs.length} result{filteredDocs.length===1?"":"s"}{categoryFilter!=="all"?` · ${catLabel(categoryFilter)}`:""}</Text><View style={styles.sortBtns}>{([{k:"recent",l:"Recent"},{k:"name",l:"Name"},{k:"size",l:"Size"}] as const).map((s)=>(<Pressable key={s.k} onPress={()=>setSort(s.k)} style={[styles.sortChip, sort===s.k&&styles.sortChipActive]}><Text style={[styles.sortText, sort===s.k&&styles.sortTextActive]}>{s.l}</Text></Pressable>))}</View></View>
            </View>}
            ListEmptyComponent={<View style={styles.empty}><Ionicons name="folder-open-outline" size={40} color={AdminColors.textMuted} /><Text style={styles.muted}>No documents match filters.</Text></View>} />
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
            <Row label="Privacy-aware mode" hint="Mask owner emails and sensitive identifiers" value={ui.privacyMode} onChange={(v)=>setAdminUiSettings({ privacyMode: v })} />
            <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={16} color={AdminColors.primary} /><Text style={styles.noticeText}>Admins can monitor document metadata and processing status for operations. Document contents/files and user private data are not exposed in this admin view.</Text></View>
            <Pressable style={styles.signOutBtn} onPress={signOut}><Ionicons name="log-out-outline" size={18} color="#fff" /><Text style={styles.signOutText}>Sign out</Text></Pressable>
          </ScrollView>
        </Pressable></Pressable>
      </Modal>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}><Pressable style={styles.modalCard} onPress={() => {}}>
          {selected && <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>Document details</Text><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={22} color={AdminColors.text} /></Pressable></View>
            <Detail label="Title" value={selected.title || "—"} /><Detail label="File name" value={selected.fileName || "—"} />
            <Detail label="Category" value={catLabel(String((selected as any).category || "other"))} />
            <Detail label="Owner" value={ui.privacyMode ? maskEmail(selected.ownerEmail) : (selected.ownerEmail || "—")} />
            <Detail label="OCR status" value={String(selected.ocrStatus || "—")} /><Detail label="Size" value={fmtBytes(Number(selected.fileSize || 0))} />
            <Detail label="Document ID" value={String(selected.id)} /><Detail label="Created" value={(selected as any).createdAt ? new Date((selected as any).createdAt).toLocaleString() : "—"} />
            <Text style={styles.privacyNote}>File content/preview is restricted. Admins see operational metadata only.</Text>
            <Pressable style={[styles.modalBtn, styles.modalBtnSecondary, { marginTop: 12 }]} onPress={() => setSelected(null)}><Text style={styles.modalBtnSecondaryText}>Close</Text></Pressable>
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
  sortRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}, sortBtns:{flexDirection:"row",gap:6}, sortChip:{paddingHorizontal:10,paddingVertical:6,borderRadius:8,backgroundColor:AdminColors.surfaceAlt}, sortChipActive:{backgroundColor:AdminColors.primarySoft}, sortText:{fontSize:11,fontWeight:"600",color:AdminColors.textSecondary}, sortTextActive:{color:AdminColors.primary}, sectionMeta:{fontSize:12,color:AdminColors.textMuted,fontWeight:"600",flex:1},
  docCard:{flexDirection:"row",alignItems:"center",gap:12,backgroundColor:AdminColors.surface,borderWidth:1,borderColor:AdminColors.border,borderRadius:AdminRadii.lg,padding:14},
  iconBox:{width:42,height:42,borderRadius:12,backgroundColor:AdminColors.primarySoft,alignItems:"center",justifyContent:"center"}, docTitle:{fontSize:15,fontWeight:"700",color:AdminColors.text}, docMeta:{fontSize:12,color:AdminColors.textSecondary,marginTop:2},
  progressRow:{flexDirection:"row",justifyContent:"space-between"}, progressLabel:{fontSize:12,color:AdminColors.textSecondary}, progressPct:{fontSize:12,fontWeight:"700",color:AdminColors.text},
  insight:{flexDirection:"row",gap:8,marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:AdminColors.border}, insightText:{flex:1,fontSize:13,color:AdminColors.textSecondary,lineHeight:18}, empty:{alignItems:"center",paddingVertical:40,gap:8},
  catGrid:{flexDirection:"row",flexWrap:"wrap",gap:8}, catChip:{flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:10,paddingVertical:8,borderRadius:12,backgroundColor:AdminColors.surfaceAlt,borderWidth:1,borderColor:AdminColors.border,maxWidth:"100%"}, catChipActive:{backgroundColor:AdminColors.primarySoft,borderColor:"#BFDBFE"}, catChipLabel:{fontSize:12,fontWeight:"600",color:AdminColors.textSecondary,maxWidth:140}, catChipLabelActive:{color:AdminColors.primaryDark}, catCount:{minWidth:22,height:22,borderRadius:11,backgroundColor:AdminColors.surface,alignItems:"center",justifyContent:"center",paddingHorizontal:6,borderWidth:1,borderColor:AdminColors.border}, catCountActive:{backgroundColor:AdminColors.primary,borderColor:AdminColors.primary}, catCountText:{fontSize:11,fontWeight:"700",color:AdminColors.text}, catCountTextActive:{color:"#fff"},
  modalOverlay:{flex:1,backgroundColor:"rgba(16,24,40,0.35)",justifyContent:"center",padding:20}, modalCard:{backgroundColor:AdminColors.surface,borderRadius:20,padding:18,maxHeight:"85%",borderWidth:1,borderColor:AdminColors.border},
  modalHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12}, modalTitle:{fontSize:18,fontWeight:"800",color:AdminColors.text},
  detailRow:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, detailLabel:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}, detailValue:{fontSize:14,color:AdminColors.text},
  modalBtn:{height:44,borderRadius:12,alignItems:"center",justifyContent:"center"}, modalBtnSecondary:{backgroundColor:AdminColors.surfaceAlt}, modalBtnSecondaryText:{fontWeight:"700",color:AdminColors.text},
  privacyNote:{fontSize:12,color:AdminColors.textSecondary,marginTop:12,lineHeight:17},
  groupTitle:{fontSize:13,fontWeight:"800",color:AdminColors.text,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}, settingRow:{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, settingLabel:{fontSize:14,fontWeight:"700",color:AdminColors.text}, settingHint:{fontSize:12,color:AdminColors.textSecondary,marginTop:2,lineHeight:17},
  infoRow:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:AdminColors.border}, infoLabel:{fontSize:11,fontWeight:"700",color:AdminColors.textMuted,textTransform:"uppercase",marginBottom:2}, infoValue:{fontSize:13,color:AdminColors.text},
  notice:{flexDirection:"row",gap:8,marginTop:12,padding:12,borderRadius:12,backgroundColor:AdminColors.primarySoft}, noticeText:{flex:1,fontSize:12,color:AdminColors.primaryDark,lineHeight:18},
  signOutBtn:{marginTop:18,height:46,borderRadius:12,backgroundColor:AdminColors.danger,flexDirection:"row",gap:8,alignItems:"center",justifyContent:"center"}, signOutText:{color:"#fff",fontWeight:"700",fontSize:14},
});
