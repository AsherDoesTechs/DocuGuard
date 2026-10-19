import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Card, StatusBadge, EmptyState } from "../../components/ui";
import SearchBar from "@/components/ui/SearchBar";
import { COLORS as BASE_COLORS, DOCUMENT_CATEGORIES } from "../../constants";
import { useTheme } from "@/context/ThemeContext";
import { formatShortDate, classifyExpiration } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";

import {
  getAllDocuments,
  getExpiredDocuments,
  getDashboardSummary,
  updateDocumentStatus,
  type LocalDocument,
  type DocumentDashboardSummary,
} from "../../services/localDatabase";

import { cancelDocumentNotifications } from "../../services/notificationScheduler";

export default function DocumentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const COLORS = useMemo(
    () =>
      ({
        ...BASE_COLORS,
        background: colors.background,
        surface: colors.surface,
        primary: colors.primary,
        primaryDark: colors.primaryDark,
        primaryLight: colors.primaryLight,
        text: colors.text,
        textSecondary: colors.textSecondary,
        textMuted: colors.textMuted,
        success: colors.success,
        warning: colors.warning,
        warningLight: colors.warningLight,
        danger: colors.error,
        border: colors.border,
        inputBackground: colors.inputBackground,
        inputBorder: colors.inputBorder,
        overlay: colors.modalOverlay,
      }) as typeof BASE_COLORS,
    [colors],
  );

  const styles = useMemo(() => createStyles(COLORS), [COLORS]);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);

  const [documents, setDocuments] = useState<LocalDocument[]>([]);
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
          await cancelDocumentNotifications(doc.id);
        }
      }

      const localDocs = await getAllDocuments();
      setDocuments(localDocs);

      const summary = await getDashboardSummary();
      setDashboardSummary(summary);
    } catch (err: unknown) {
      console.error("Failed to fetch documents:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  /**
   * Refresh without resetting the whole screen to its initial
   * loading state. RefreshableContainer manages the refresh indicator.
   */
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

  /**
   * Apply search, category, and expiration-status filters together.
   */
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return documents.filter((doc) => {
      const matchesSearch =
        !query ||
        doc.title?.toLowerCase().includes(query) ||
        doc.issuer?.toLowerCase().includes(query) ||
        doc.documentNumber?.toLowerCase().includes(query);

      const matchesCategory =
        selectedCategory === "all" || doc.category === selectedCategory;

      const expiration = classifyExpiration(doc.expiryDate);

      const matchesStatus =
        selectedStatus === "all" || expiration === selectedStatus;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [documents, search, selectedCategory, selectedStatus]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedCategory !== "all" ||
    selectedStatus !== "all";

  const pendingSyncCount = documents.filter((doc) => doc.needsSync).length;

  const maskDocumentNumber = (num?: string) => {
    if (!num || num.length <= 4) return "••••";
    return `••••${num.slice(-4)}`;
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
  }, []);

  const openAddDocument = useCallback(() => {
    router.push("/add-document" as any);
  }, [router]);

  const getSyncIcon = (doc: LocalDocument) => {
    // A failed sync must take priority over needsSync.
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

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open sync"
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
          </View>

          <Text style={styles.subtitle}>
            {filtered.length} {filtered.length === 1 ? "document" : "documents"}
            {" • "}
            {pendingSyncCount} pending sync
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <SearchBar
            placeholder="Search title, issuer, or document ID"
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
          <ActivityIndicator
            size="large"
            color={COLORS.primary}
            style={styles.loadingIndicator}
          />
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
                    : "Your vault is empty"
                }
                message={
                  hasActiveFilters
                    ? "Try another search or clear your filters to see more documents."
                    : "Add your first document to start building your secure vault."
                }
                actionLabel={
                  hasActiveFilters ? "Clear filters" : "Add document"
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
              filtered.map((doc: LocalDocument) => {
                const syncIcon = getSyncIcon(doc);

                return (
                  <TouchableOpacity
                    key={doc.id ?? doc.documentNumber}
                    accessibilityRole="button"
                    accessibilityLabel={`Open document ${doc.title || "Untitled Document"}`}
                    activeOpacity={0.75}
                    onPress={() =>
                      router.push(`/document-details/${String(doc.id)}` as any)
                    }
                  >
                    <Card style={styles.docCard}>
                      <View style={styles.docCardContent}>
                        <View style={styles.docInfo}>
                          <View style={styles.titleRow}>
                            <Ionicons
                              name="document-text-outline"
                              size={18}
                              color={COLORS.primary}
                              style={styles.documentIcon}
                            />

                            <Text style={styles.docTitle} numberOfLines={1}>
                              {doc.title || "Untitled Document"}
                            </Text>
                          </View>

                          <Text style={styles.docIssuer} numberOfLines={2}>
                            Issuing Agency: {doc.issuer || "Unknown"}
                          </Text>

                          <View style={styles.docMeta}>
                            <Text style={styles.docNumber}>
                              ID: {maskDocumentNumber(doc.documentNumber)}
                            </Text>

                            <View
                              style={styles.syncStatus}
                              accessibilityLabel={syncIcon.label}
                            >
                              <Ionicons
                                name={syncIcon.name}
                                size={14}
                                color={syncIcon.color}
                              />
                              <Text
                                style={[
                                  styles.syncStatusText,
                                  { color: syncIcon.color },
                                ]}
                                numberOfLines={1}
                              >
                                {syncIcon.label}
                              </Text>
                            </View>

                            <View style={styles.docDate}>
                              <Ionicons
                                name="calendar-outline"
                                size={14}
                                color={COLORS.textSecondary}
                              />

                              <Text style={styles.docDateText}>
                                Expires {formatShortDate(doc.expiryDate)}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <StatusBadge status={doc.status} />
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })
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
        <Ionicons name="add" size={24} color="#FFFFFF" />
        <Text style={styles.floatingButtonText}>Add Document</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const createStyles = (COLORS: typeof BASE_COLORS) =>
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

    loadingIndicator: {
      marginTop: 40,
    },

    docsList: {
      gap: 12,
    },

    docCard: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: COLORS.surface,
    },

    docCardContent: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 8,
    },

    titleRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    documentIcon: {
      marginRight: 6,
    },

    docInfo: {
      flex: 1,
      minWidth: 0,
      marginRight: 4,
    },

    docTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: COLORS.text,
      flex: 1,
    },

    docIssuer: {
      fontSize: 13,
      color: COLORS.textSecondary,
      marginTop: 4,
    },

    docMeta: {
      marginTop: 8,
      gap: 8,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
    },

    docNumber: {
      fontSize: 12,
      color: COLORS.textSecondary,
      fontWeight: "500",
    },

    syncStatus: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      maxWidth: "100%",
    },

    syncStatusText: {
      fontSize: 11,
      fontWeight: "500",
      flexShrink: 1,
    },

    docDate: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },

    docDateText: {
      fontSize: 12,
      color: COLORS.textSecondary,
    },

    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },

    modalBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: COLORS.overlay || "rgba(0, 0, 0, 0.55)",
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
      shadowColor: "#000000",
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
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 5,
      zIndex: 10,
      gap: 6,
    },

    floatingButtonText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "600",
    },
  });
