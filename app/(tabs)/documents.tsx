import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Input, Card, StatusBadge } from "../../components/ui";
import { COLORS, DOCUMENT_CATEGORIES } from "../../constants";
import { formatShortDate } from "../../utils";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import {
  getAllDocuments,
  getExpiredDocuments,
  updateDocumentStatus,
  LocalDocument,
} from "../../services/localDatabase";
import { cancelDocumentNotifications } from "../../services/notificationScheduler";

export default function DocumentsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Real data states
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // Function to fetch documents from local database (cleaned up single-pass fetch)
  const fetchDocuments = async () => {
    try {
      const expiredDocs = await getExpiredDocuments();
      for (const doc of expiredDocs) {
        if (doc.status !== "expired") {
          await updateDocumentStatus(doc.id!, "expired");
          await cancelDocumentNotifications(doc.id!);
        }
      }

      const localDocs = await getAllDocuments();
      setDocuments(localDocs);
    } catch (err: any) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleDataReload = async () => {
    setLoading(true);
    await fetchDocuments();
  };

  const categories = ["all", ...Object.keys(DOCUMENT_CATEGORIES)];

  const filtered = documents.filter((doc) => {
    const matchesSearch =
      doc.title?.toLowerCase().includes(search.toLowerCase()) ||
      doc.issuer?.toLowerCase().includes(search.toLowerCase()) ||
      doc.documentNumber?.toLowerCase().includes(search.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" || doc.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Mask sensitive document numbers on the list view for security
  const maskDocumentNumber = (num?: string) => {
    if (!num) return "••••";
    if (num.length <= 4) return "••••";
    return "••••" + num.slice(-4);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Documents</Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/sync")}
              style={styles.syncButton}
            >
              <Ionicons name="cloud-upload" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            {filtered.length} documents • Offline Mode
          </Text>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={20}
            color={COLORS.textSecondary}
            style={styles.searchIcon}
          />
          <Input
            placeholder="Search by title, issuer, or ID..."
            value={search}
            onChangeText={(text) => setSearch(text)}
            style={{ paddingLeft: 35 }}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
        >
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              onPress={() => setSelectedCategory(cat)}
              style={[
                styles.categoryChip,
                selectedCategory === cat && styles.categoryChipActive,
              ]}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === cat && styles.categoryChipTextActive,
                ]}
              >
                {cat === "all"
                  ? "All"
                  : DOCUMENT_CATEGORIES[
                      cat as keyof typeof DOCUMENT_CATEGORIES
                    ] || cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator
            size="large"
            color={COLORS.primary}
            style={{ marginTop: 40 }}
          />
        ) : (
          <View style={styles.docsList}>
            {filtered.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>📄</Text>
                <Text style={styles.emptyTitle}>No Documents Found</Text>
                <Text style={styles.emptyText}>
                  {search || selectedCategory !== "all"
                    ? "Try changing your search or removing filters."
                    : "Add your first document to start building your secure vault profile."}
                </Text>
              </View>
            ) : (
              filtered.map((doc: LocalDocument) => (
                <TouchableOpacity
                  key={doc.id}
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
                            style={{ marginRight: 6 }}
                          />
                          <Text style={styles.docTitle} numberOfLines={1}>
                            {doc.title}
                          </Text>
                        </View>
                        <Text style={styles.docIssuer}>
                          Issuing Agency: {doc.issuer || "Unknown"}
                        </Text>
                        <View style={styles.docMeta}>
                          <Text style={styles.docNumber}>
                            ID: {maskDocumentNumber(doc.documentNumber)}
                          </Text>
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
              ))
            )}
          </View>
        )}
      </RefreshableContainer>

      {/* Floating Action Button for Adding Documents */}
      <TouchableOpacity
        style={styles.floatingAddButton}
        onPress={() => router.push("/add-document" as any)}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={styles.floatingButtonText}>Add Document</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: 20 },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary },
  syncButton: {
    padding: 8,
    backgroundColor: COLORS.primary + "15",
    borderRadius: 8,
  },
  searchContainer: { position: "relative", marginBottom: 16 },
  searchIcon: { position: "absolute", left: 12, top: 16, zIndex: 10 },
  categoryScroll: { marginBottom: 20 },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#fff",
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryChipText: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  categoryChipTextActive: { color: "#fff" },
  docsList: { gap: 12 },
  docCard: { paddingHorizontal: 12, paddingVertical: 12 },
  docCardContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  docInfo: { flex: 1, marginRight: 12 },
  docTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text, flex: 1 },
  docIssuer: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  docMeta: { marginTop: 8, gap: 4 },
  docNumber: { fontSize: 12, color: COLORS.textSecondary, fontWeight: "500" },
  docDate: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  docDateText: { fontSize: 12, color: COLORS.textSecondary },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyText: {
    textAlign: "center",
    color: COLORS.textSecondary,
    fontSize: 14,
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    zIndex: 10,
    gap: 6,
  },
  floatingButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
