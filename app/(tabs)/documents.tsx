import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  Platform,
  UIManager,
  DeviceEventEmitter,
} from "react-native";
import { LayoutAnimation } from "react-native";
import { api } from "../../services/api";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Card, StatusBadge, EmptyState, TagFilter } from "../../components/ui";
import SearchBar from "@/components/ui/SearchBar";
import { DOCUMENT_CATEGORIES } from "../../constants";
import { useTheme } from "@/context/ThemeContext";
import { formatShortDate, classifyExpiration } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import { DocumentsSkeleton } from "@/components/ui/Skeleton";

import {
  getAllDocuments,
  getExpiredDocuments,
  getDashboardSummary,
  updateDocumentStatus,
  hardDeleteDocument,
  moveDocumentToTrash,
  restoreDocumentFromTrash,
  archiveDocument,
  getTrashedDocuments,
  getArchivedDocuments,
  getAllTags,
  type LocalDocument,
  type DocumentDashboardSummary,
} from "../../services/localDatabase";
import { pullDocumentsFromCloud } from "@/services/syncService";
import { cancelExpiringSoonNotifications } from "../../services/notificationScheduler";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Normalize category/status values from local DB and cloud sync.
 * Stored documents may contain either category keys or display labels
 * (including apostrophe/spacing/case differences).
 */
const normalizeFilterValue = (value?: unknown): string =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[’‘`]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const categoryMatches = (
  category: unknown,
  selectedCategory: string,
  title?: unknown,
): boolean => {
  if (!selectedCategory) return true;
  const normalizedSelected = normalizeFilterValue(selectedCategory);
  if (normalizedSelected === "all" || normalizedSelected === "all categories")
    return true;

  const storedCategory = normalizeFilterValue(category);
  const storedTitle = normalizeFilterValue(title);

  const selectedKey = normalizeFilterValue(selectedCategory);
  const selectedLabel = normalizeFilterValue(
    DOCUMENT_CATEGORIES[selectedCategory as keyof typeof DOCUMENT_CATEGORIES],
  );

  if (storedCategory === selectedKey || storedCategory === selectedLabel)
    return true;
  const normalizedSelectedKeyLabel = normalizeFilterValue(
    DOCUMENT_CATEGORIES[normalizedSelected as keyof typeof DOCUMENT_CATEGORIES],
  );
  if (
    normalizedSelectedKeyLabel !== "" &&
    storedCategory === normalizedSelectedKeyLabel
  ) {
    return true;
  }

  if (selectedLabel && storedTitle && storedTitle.includes(selectedLabel)) {
    return true;
  }
  if (
    normalizedSelectedKeyLabel &&
    storedTitle &&
    storedTitle.includes(normalizedSelectedKeyLabel)
  ) {
    return true;
  }
  if (
    selectedKey &&
    selectedKey !== "all" &&
    storedTitle &&
    storedTitle.includes(selectedKey)
  ) {
    return true;
  }

  return false;
};

const statusMatches = (
  expiryDate: unknown,
  selectedStatus: string,
): boolean => {
  if (selectedStatus === "all") return true;
  if (typeof expiryDate !== "string" || !expiryDate.trim()) return false;

  const status = normalizeFilterValue(classifyExpiration(expiryDate));
  const selected = normalizeFilterValue(selectedStatus);

  if (selected === "expiring" || selected === "expiring soon") {
    return status === "expiring" || status === "expiring soon";
  }
  if (selected === "expired") return status === "expired";
  if (selected === "valid") return status === "valid";

  return status === selected;
};

interface DocumentItemProps {
  doc: LocalDocument;
  COLORS: any;
  viewMode: "active" | "archived" | "trash";
  onPress: (id: string | number) => void;
  maskNumber: (num?: string) => string;
  getSyncIcon: (doc: LocalDocument) => {
    name: any;
    color: string;
    label: string;
  };
  onArchiveToggle?: (id: number, archive: boolean) => void;
  onMoveToTrash?: (id: number) => void;
  onRestore?: (id: number) => void;
  onPermanentDelete?: (id: number) => void;
}

const DocumentItem = React.memo(
  ({
    doc,
    COLORS,
    viewMode,
    onPress,
    maskNumber,
    getSyncIcon,
    onArchiveToggle,
    onMoveToTrash,
    onRestore,
    onPermanentDelete,
  }: DocumentItemProps) => {
    const syncIcon = getSyncIcon(doc);
    const localId = typeof doc.id === "number" ? doc.id : null;

    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open document ${doc.title || "Untitled Document"}`}
        activeOpacity={0.75}
        onPress={() => onPress(doc.id ?? doc.documentNumber ?? "")}
      >
        <Card
          style={{
            paddingHorizontal: 12,
            paddingVertical: 12,
            backgroundColor: COLORS.surface,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <View style={{ flex: 1, minWidth: 0, marginRight: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="document-text-outline"
                  size={18}
                  color={COLORS.primary}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: COLORS.text,
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {doc.title || "Untitled Document"}
                </Text>
              </View>

              <Text
                style={{
                  fontSize: 13,
                  color: COLORS.textSecondary,
                  marginTop: 4,
                }}
                numberOfLines={2}
              >
                Issuing Agency: {doc.issuer || "Unknown"}
              </Text>

              <View
                style={{
                  marginTop: 8,
                  gap: 8,
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: COLORS.textSecondary,
                    fontWeight: "500",
                  }}
                >
                  ID: {maskNumber(doc.documentNumber)}
                </Text>

                {viewMode !== "trash" ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      maxWidth: "100%",
                    }}
                    accessibilityLabel={syncIcon.label}
                  >
                    <Ionicons
                      name={syncIcon.name}
                      size={14}
                      color={syncIcon.color}
                    />
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "500",
                        color: syncIcon.color,
                        flexShrink: 1,
                      }}
                      numberOfLines={1}
                    >
                      {syncIcon.label}
                    </Text>
                  </View>
                ) : null}

                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={14}
                    color={COLORS.textSecondary}
                  />
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    Expires {formatShortDate(doc.expiryDate)}
                  </Text>
                </View>
              </View>

              {Array.isArray(doc.tags) && doc.tags.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {doc.tags.slice(0, 4).map((tag) => (
                    <View
                      key={tag}
                      style={{
                        backgroundColor: COLORS.primaryLight,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 10,
                      }}
                    >
                      <Text style={{ fontSize: 11, color: COLORS.primary, fontWeight: "500" }}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {localId != null ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {viewMode === "active" ? (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Archive ${doc.title || "document"}`}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onArchiveToggle?.(localId, true);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: COLORS.border,
                          backgroundColor: COLORS.background,
                        }}
                      >
                        <Ionicons name="archive-outline" size={14} color={COLORS.textSecondary} />
                        <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: "600" }}>
                          Archive
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${doc.title || "document"} to trash`}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onMoveToTrash?.(localId);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: COLORS.error,
                          backgroundColor: COLORS.background,
                        }}
                      >
                        <Ionicons name="trash-outline" size={14} color={COLORS.error} />
                        <Text style={{ fontSize: 12, color: COLORS.error, fontWeight: "600" }}>
                          Trash
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  {viewMode === "archived" ? (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Unarchive ${doc.title || "document"}`}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onArchiveToggle?.(localId, false);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: COLORS.primary,
                          backgroundColor: COLORS.background,
                        }}
                      >
                        <Ionicons name="arrow-up-circle-outline" size={14} color={COLORS.primary} />
                        <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: "600" }}>
                          Unarchive
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${doc.title || "document"} to trash`}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onMoveToTrash?.(localId);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: COLORS.error,
                          backgroundColor: COLORS.background,
                        }}
                      >
                        <Ionicons name="trash-outline" size={14} color={COLORS.error} />
                        <Text style={{ fontSize: 12, color: COLORS.error, fontWeight: "600" }}>
                          Trash
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  {viewMode === "trash" ? (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Restore ${doc.title || "document"}`}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onRestore?.(localId);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: COLORS.primary,
                          backgroundColor: COLORS.background,
                        }}
                      >
                        <Ionicons name="refresh-outline" size={14} color={COLORS.primary} />
                        <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: "600" }}>
                          Restore
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${doc.title || "document"} permanently`}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onPermanentDelete?.(localId);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: COLORS.error,
                          backgroundColor: COLORS.background,
                        }}
                      >
                        <Ionicons name="trash" size={14} color={COLORS.error} />
                        <Text style={{ fontSize: 12, color: COLORS.error, fontWeight: "600" }}>
                          Delete permanently
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>

            <StatusBadge status={doc.status} />
          </View>
        </Card>
      </TouchableOpacity>
    );
  },
);

export default function DocumentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const COLORS = useMemo(
    () => ({
      ...colors,
      danger: colors.error,
      overlay: colors.modalOverlay,
      shadow: colors.shadow,
      buttonPrimaryText: colors.buttonPrimaryText,
    }),
    [colors],
  );

  const handleOpenDocument = useCallback(
    (id: string | number) => {
      router.push(`/document-details/${String(id)}` as any);
    },
    [router],
  );

  const styles = useMemo(() => createStyles(COLORS), [COLORS]);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [ocrSearchIds, setOcrSearchIds] = useState<Set<number> | null>(null);
  const [viewMode, setViewMode] = useState<"active" | "archived" | "trash">("active");

  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [archivedDocs, setArchivedDocs] = useState<LocalDocument[]>([]);
  const [trashedDocs, setTrashedDocs] = useState<LocalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [dashboardSummary, setDashboardSummary] =
    useState<DocumentDashboardSummary | null>(null);

  /**
   * Load local documents, update expired-document statuses,
   * and cancel notifications for documents that have expired.
   */
  const fetchDocuments = useCallback(async () => {
    try {
      setLoadError(false);

      const expiredDocs = await getExpiredDocuments();
      for (const doc of expiredDocs) {
        if (doc.status !== "expired" && doc.id != null) {
          await updateDocumentStatus(doc.id, "expired");
          await cancelExpiringSoonNotifications(doc.id);
        }
      }

      const [localDocs, localArchived, localTrashed, summary, tags] = await Promise.all([
        getAllDocuments(),
        getArchivedDocuments(),
        getTrashedDocuments(),
        getDashboardSummary(),
        getAllTags(),
      ]);
      setDocuments(localDocs);
      setArchivedDocs(localArchived);
      setTrashedDocs(localTrashed);
      setDashboardSummary(summary);
      setAllTags(tags);
    } catch (err: unknown) {
      console.error("Failed to fetch local documents:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }

    try {
      await pullDocumentsFromCloud();

      const refreshedExpiredDocs = await getExpiredDocuments();
      for (const doc of refreshedExpiredDocs) {
        if (doc.status !== "expired" && doc.id != null) {
          await updateDocumentStatus(doc.id, "expired");
          await cancelExpiringSoonNotifications(doc.id);
        }
      }

      const [refreshedDocs, refreshedArchived, refreshedTrashed, refreshedSummary, refreshedTags] =
        await Promise.all([
          getAllDocuments(),
          getArchivedDocuments(),
          getTrashedDocuments(),
          getDashboardSummary(),
          getAllTags(),
        ]);
      setDocuments(refreshedDocs);
      setArchivedDocs(refreshedArchived);
      setTrashedDocs(refreshedTrashed);
      setDashboardSummary(refreshedSummary);
      setAllTags(refreshedTags);
    } catch (cloudError) {
      console.warn(
        "Background cloud document pull failed; continuing with local documents:",
        cloudError,
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchDocuments();
    }, [fetchDocuments]),
  );

  // Real-time listener for document updates across the app
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "documentVaultChanged",
      () => {
        void fetchDocuments();
      },
    );
    return () => {
      subscription.remove();
    };
  }, [fetchDocuments]);

  const handleDeleteDocument = async (documentId: number) => {
    const previousDocuments = [...documents];

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));

    try {
      await hardDeleteDocument(documentId);
      await api.documents.delete(documentId);
      // Emit event so other screens/listeners update in real-time
      DeviceEventEmitter.emit("documentVaultChanged");
    } catch (error) {
      console.error(
        "[Documents] Deletion failed, rolling back UI state:",
        error,
      );

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setDocuments(previousDocuments);
    }
  };

  const handleArchiveDocument = async (documentId: number, archive: boolean) => {
    try {
      await archiveDocument(documentId, archive);
      DeviceEventEmitter.emit("documentVaultChanged");
    } catch (error) {
      console.error("Failed to archive document:", error);
    }
  };

  const handleMoveToTrash = async (documentId: number) => {
    try {
      await moveDocumentToTrash(documentId);
      DeviceEventEmitter.emit("documentVaultChanged");
    } catch (error) {
      console.error("Failed to move document to trash:", error);
    }
  };

  const handleRestoreDocument = async (documentId: number) => {
    try {
      await restoreDocumentFromTrash(documentId);
      DeviceEventEmitter.emit("documentVaultChanged");
    } catch (error) {
      console.error("Failed to restore document:", error);
    }
  };

  const handlePermanentDelete = async (documentId: number) => {
    try {
      await hardDeleteDocument(documentId);
      try {
        await api.documents.delete(documentId);
      } catch {
        // local permanent delete already applied; cloud tombstone may sync later
      }
      DeviceEventEmitter.emit("documentVaultChanged");
    } catch (error) {
      console.error("Failed to permanently delete document:", error);
    }
  };

  const handleDataReload = useCallback(async () => {
    await fetchDocuments();
  }, [fetchDocuments]);

  const categories = useMemo(
    () => ["all", ...Object.keys(DOCUMENT_CATEGORIES)],
    [],
  );

  const statusFilters = useMemo(
    () => [
      { value: "all", label: "All Statuses" },
      { value: "valid", label: "Valid" },
      { value: "expiring", label: "Expiring Soon" },
      { value: "expired", label: "Expired" },
    ],
    [],
  );

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setOcrSearchIds(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.documents.searchDocuments(q);
        if (!cancelled) {
          const ids = new Set<number>((res?.results || []).map((r: any) => Number(r?.id)).filter((n: number) => Number.isFinite(n)));
          setOcrSearchIds(ids);
        }
      } catch { if (!cancelled) setOcrSearchIds(null); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  const filtered = useMemo(() => {
    const query = normalizeFilterValue(search);
    const base: LocalDocument[] = viewMode === "archived" ? archivedDocs : viewMode === "trash" ? trashedDocs : documents;
    const selectedTagSet = selectedTags.map((t) => normalizeFilterValue(t));
    return base.filter((doc: LocalDocument) => {
      const title = normalizeFilterValue(doc.title);
      const issuer = normalizeFilterValue(doc.issuer);
      const documentNumber = normalizeFilterValue(doc.documentNumber);
      const tags = Array.isArray(doc.tags) ? doc.tags.map((t) => normalizeFilterValue(t)) : [];
      const matchesSearch =
        !query ||
        title.includes(query) ||
        issuer.includes(query) ||
        documentNumber.includes(query) ||
        tags.some((t) => t.includes(query)) ||
        (ocrSearchIds ? ocrSearchIds.has(Number(doc.id)) : false);
      const matchesCategory = categoryMatches(doc.category, selectedCategory, doc.title);
      const matchesStatus = statusMatches(doc.expiryDate, selectedStatus);
      const matchesTags =
        selectedTagSet.length === 0 ||
        selectedTagSet.every((tag) => tags.includes(tag));
      return matchesSearch && matchesCategory && matchesStatus && matchesTags;
    });
  }, [documents, archivedDocs, trashedDocs, viewMode, search, selectedCategory, selectedStatus, selectedTags, ocrSearchIds]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedCategory !== "all" ||
    selectedStatus !== "all" ||
    selectedTags.length > 0;

  const pendingSyncCount = documents.filter((doc) => doc.needsSync).length;

  const maskDocumentNumber = (num?: string) => {
    if (!num || num.length <= 4) return "â€¢â€¢â€¢â€¢";
    return `â€¢â€¢â€¢â€¢${num.slice(-4)}`;
  };

  const currentCategoryLabel =
    selectedCategory === "all"
      ? "All Categories"
      : DOCUMENT_CATEGORIES[
          selectedCategory as keyof typeof DOCUMENT_CATEGORIES
        ] || selectedCategory;

  const currentStatusLabel =
    statusFilters.find((item) => item.value === selectedStatus)?.label ||
    "All Statuses";

  const clearFilters = useCallback(() => {
    setSearch("");
    setSelectedCategory("all");
    setSelectedStatus("all");
    setSelectedTags([]);
  }, []);

  const openAddDocument = useCallback(() => {
    router.push("/add-document" as any);
  }, [router]);

  const getSyncIcon = (doc: LocalDocument) => {
    if (doc.syncStatus === "failed") {
      return {
        name: "alert-circle-outline" as const,
        color: COLORS.danger,
        label: "Sync failed",
      };
    }

    if (doc.needsSync || doc.syncStatus === "pending") {
      return {
        name: "cloud-upload-outline" as const,
        color: COLORS.warning,
        label: "Waiting to sync",
      };
    }

    if (doc.syncStatus === "synced") {
      return {
        name: "cloud-done-outline" as const,
        color: COLORS.success,
        label: "Synced",
      };
    }

    return {
      name: "phone-portrait-outline" as const,
      color: COLORS.textSecondary,
      label: "Stored locally",
    };
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Documents</Text>

            <View style={styles.headerActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Sync documents with cloud"
                onPress={() => router.push("/(tabs)/sync")}
                style={styles.syncButton}
                activeOpacity={0.75}
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Import documents from cloud"
                onPress={() => router.push("/(tabs)/import" as any)}
                style={styles.importButton}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="cloud-download-outline"
                  size={20}
                  color={colors.buttonPrimaryText}
                />
                <Text style={styles.importButtonText}>Import</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.subtitle}>
            {viewMode === "active"
              ? "Active"
              : viewMode === "archived"
                ? "Archived"
                : "Trash"}
            : {filtered.length} {filtered.length === 1 ? "document" : "documents"}
            {viewMode === "active" ? ` • ${pendingSyncCount} pending sync` : ""}
          </Text>

          <View style={styles.viewModeRow}>
            {(["active", "archived", "trash"] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.viewModeChip,
                  viewMode === mode && styles.viewModeChipActive,
                ]}
                onPress={() => setViewMode(mode)}
                accessibilityRole="button"
                accessibilityState={{ selected: viewMode === mode }}
              >
                <Text
                  style={[
                    styles.viewModeChipText,
                    viewMode === mode && styles.viewModeChipTextActive,
                  ]}
                >
                  {mode === "active"
                    ? "Active"
                    : mode === "archived"
                      ? "Archived"
                      : "Trash"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <SearchBar
            placeholder="Search title, issuer, ID, or document text"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Category and status filters */}
        <View style={styles.filtersRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Category filter: ${currentCategoryLabel}`}
            accessibilityState={{
              selected: selectedCategory !== "all",
            }}
            style={styles.dropdownButton}
            onPress={() => setCategoryModalVisible(true)}
            activeOpacity={0.75}
          >
            <View style={styles.dropdownButtonContent}>
              <Ionicons name="grid-outline" size={16} color={COLORS.primary} />

              <Text style={styles.dropdownButtonText} numberOfLines={1}>
                {currentCategoryLabel}
              </Text>
            </View>

            <Ionicons
              name="chevron-down"
              size={16}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Status filter: ${currentStatusLabel}`}
            accessibilityState={{
              selected: selectedStatus !== "all",
            }}
            style={styles.dropdownButton}
            onPress={() => setStatusModalVisible(true)}
            activeOpacity={0.75}
          >
            <View style={styles.dropdownButtonContent}>
              <Ionicons
                name="filter-outline"
                size={16}
                color={COLORS.primary}
              />

              <Text style={styles.dropdownButtonText} numberOfLines={1}>
                {currentStatusLabel}
              </Text>
            </View>

            <Ionicons
              name="chevron-down"
              size={16}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {allTags.length > 0 ? (
          <View style={styles.tagFilterContainer}>
            <TagFilter
              selectedTags={selectedTags}
              allTags={allTags}
              onTagToggle={(tag) =>
                setSelectedTags((prev) =>
                  prev.includes(tag)
                    ? prev.filter((t) => t !== tag)
                    : [...prev, tag],
                )
              }
            />
          </View>
        ) : null}

        {/* Clear filters */}
        {hasActiveFilters && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            onPress={clearFilters}
            style={styles.clearFiltersButton}
            activeOpacity={0.75}
          >
            <Ionicons
              name="close-circle-outline"
              size={16}
              color={COLORS.primary}
            />
            <Text style={styles.clearFiltersText}>Clear filters</Text>
          </TouchableOpacity>
        )}

        {/* Initial loading and error states */}
        {loading ? (
          <DocumentsSkeleton />
        ) : loadError && documents.length === 0 ? (
          <EmptyState
            illustration="documents"
            title="Couldn't load documents"
            message="Something went wrong while loading your vault. Pull down to refresh and try again."
            actionLabel="Try again"
            onAction={handleDataReload}
            actionIcon="refresh"
          />
        ) : (
          <View style={styles.docsList}>
            {filtered.length === 0 ? (
              <EmptyState
                illustration={hasActiveFilters ? "search" : "documents"}
                title={
                  hasActiveFilters
                    ? "No matching documents"
                    : viewMode === "archived" ? "No archived documents" : viewMode === "trash" ? "Trash is empty" : "Your vault is empty"
                }
                message={
                  hasActiveFilters
                    ? "Try another search or clear your filters to see more documents."
                    : viewMode === "archived"
                      ? "Archived documents appear here."
                      : viewMode === "trash"
                        ? "Deleted documents can be restored or permanently removed from Trash."
                        : "Add your first document to start building your secure vault."
                }
                actionLabel={
                  hasActiveFilters ? "Clear filters" : viewMode === "active" ? "Add document" : undefined
                }
                onAction={() => {
                  if (hasActiveFilters) {
                    clearFilters();
                  } else {
                    openAddDocument();
                  }
                }}
                actionIcon={hasActiveFilters ? "close-circle-outline" : "add"}
              />
            ) : (
              filtered.map((doc: LocalDocument) => (
                <DocumentItem
                  key={doc.id ?? doc.documentNumber}
                  doc={doc}
                  COLORS={COLORS}
                  viewMode={viewMode}
                  onPress={handleOpenDocument}
                  maskNumber={maskDocumentNumber}
                  getSyncIcon={getSyncIcon}
                  onArchiveToggle={handleArchiveDocument}
                  onMoveToTrash={handleMoveToTrash}
                  onRestore={handleRestoreDocument}
                  onPermanentDelete={handlePermanentDelete}
                />
              ))
            )}
          </View>
        )}
      </RefreshableContainer>

      {/* Category selection modal */}
      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Close category selection"
            onPress={() => setCategoryModalVisible(false)}
          />

          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Category</Text>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setCategoryModalVisible(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={categories}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const label =
                  item === "all"
                    ? "All Categories"
                    : DOCUMENT_CATEGORIES[
                        item as keyof typeof DOCUMENT_CATEGORIES
                      ] || item;

                const isSelected = selectedCategory === item;

                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.modalItem,
                      isSelected && styles.modalItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedCategory(item);
                      setCategoryModalVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalItemText,
                        isSelected && styles.modalItemTextSelected,
                      ]}
                    >
                      {label}
                    </Text>

                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={COLORS.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Status selection modal */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setStatusModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Close status selection"
            onPress={() => setStatusModalVisible(false)}
          />

          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Status</Text>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setStatusModalVisible(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={statusFilters}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selectedStatus === item.value;

                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.modalItem,
                      isSelected && styles.modalItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedStatus(item.value);
                      setStatusModalVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalItemText,
                        isSelected && styles.modalItemTextSelected,
                      ]}
                    >
                      {item.label}
                    </Text>

                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={COLORS.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Floating Add Document button */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Add document"
        activeOpacity={0.85}
        style={styles.floatingAddButton}
        onPress={openAddDocument}
      >
        <Ionicons name="add" size={24} color={colors.buttonPrimaryText} />
        <Text style={styles.floatingButtonText}>Add Document</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const createStyles = (COLORS: any) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: COLORS.background,
    },

    content: {
      flexGrow: 1,
      padding: 16,
      paddingBottom: 110,
      backgroundColor: COLORS.background,
    },

    header: {
      marginBottom: 20,
    },

    headerTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4,
    },

    title: {
      fontSize: 28,
      fontWeight: "700",
      color: COLORS.text,
    },

    subtitle: {
      fontSize: 14,
      color: COLORS.textSecondary,
    },

    syncButton: {
      padding: 10,
      backgroundColor: COLORS.primaryLight,
      borderRadius: 10,
    },

    viewModeRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 12,
    },
    viewModeChip: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surface,
    },
    viewModeChipActive: {
      backgroundColor: COLORS.primaryLight,
      borderColor: COLORS.primary,
    },
    viewModeChipText: {
      fontSize: 13,
      fontWeight: "600",
      color: COLORS.textSecondary,
    },
    viewModeChipTextActive: {
      color: COLORS.primary,
    },
    searchContainer: {
      marginBottom: 16,
    },

    filtersRow: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 16,
    },

    dropdownButton: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: COLORS.surface,
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },

    dropdownButtonContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
      minWidth: 0,
      marginRight: 8,
    },

    dropdownButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: COLORS.text,
      flex: 1,
    },

    clearFiltersButton: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 6,
      paddingVertical: 4,
      marginBottom: 16,
    },

    clearFiltersText: {
      fontSize: 13,
      fontWeight: "600",
      color: COLORS.primary,
    },

    docsList: {
      gap: 12,
    },

    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    importButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: COLORS.primary,
      borderRadius: 10,
    },

    importButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: COLORS.buttonPrimaryText,
    },

    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },

    modalBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: COLORS.overlay,
    },

    modalContent: {
      backgroundColor: COLORS.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: COLORS.border,
      width: "100%",
      maxWidth: 440,
      maxHeight: "60%",
      padding: 20,
      elevation: 8,
      shadowColor: COLORS.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      overflow: "hidden",
    },

    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },

    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: COLORS.text,
    },

    modalCloseButton: {
      padding: 4,
    },

    modalItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      paddingHorizontal: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: COLORS.border,
      borderRadius: 8,
    },

    modalItemSelected: {
      backgroundColor: COLORS.primaryLight,
    },

    modalItemText: {
      fontSize: 14,
      color: COLORS.text,
      flex: 1,
    },

    modalItemTextSelected: {
      fontWeight: "600",
      color: COLORS.primary,
    },

    tagFilterContainer: {
      marginBottom: 12,
    },

    floatingAddButton: {
      position: "absolute",
      bottom: 24,
      right: 20,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: COLORS.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 28,
      elevation: 6,
      shadowColor: COLORS.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 5,
      zIndex: 10,
      gap: 6,
    },

    floatingButtonText: {
      color: COLORS.buttonPrimaryText,
      fontSize: 15,
      fontWeight: "600",
    },
  });
