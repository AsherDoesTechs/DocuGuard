import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Input, Card, StatusBadge } from "../../components/ui";
import { MOCK_DOCUMENTS, COLORS, DOCUMENT_CATEGORIES } from "../../constants";
import { formatShortDate } from "../../utils";
import { AppDocument } from "../../types";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";

export default function DocumentsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const handleDataReload = async () => {
    console.log("Refreshing data...");
    // Add your fetch logic
  };

  const categories = ["all", ...Object.keys(DOCUMENT_CATEGORIES)];

  const filtered = MOCK_DOCUMENTS.filter((doc: AppDocument) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.issuer.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      selectedCategory === "all" || doc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <Text style={styles.title}>Documents</Text>
            </View>
            <Text style={styles.subtitle}>{filtered.length} documents</Text>
          </View>

          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color={COLORS.textSecondary}
              style={styles.searchIcon}
            />
            <Input
              placeholder="Search documents..."
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
                      ]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.docsList}>
            {filtered.map((doc: AppDocument) => (
              <TouchableOpacity
                key={doc.id}
                onPress={() => router.push(`/document-details/${doc.id}`)}
              >
                <Card style={styles.docCard}>
                  <View style={styles.docCardContent}>
                    <View style={styles.docInfo}>
                      <Text style={styles.docTitle}>{doc.title}</Text>
                      <Text style={styles.docIssuer}>{doc.issuer}</Text>
                      <View style={styles.docMeta}>
                        <Text style={styles.docNumber}>
                          ID: {doc.documentNumber}
                        </Text>
                        <View style={styles.docDate}>
                          <Ionicons
                            name="calendar"
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
            ))}
          </View>
        </ScrollView>
        <TouchableOpacity
          style={styles.floatingAddButton}
          onPress={() => router.push("/add-document")}
        >
          <Ionicons name="add-circle" size={70} color={COLORS.primary} />
        </TouchableOpacity>
      </RefreshableContainer>
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
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary },
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
  floatingAddButton: {
    position: "absolute",
    bottom: 20, // Adjust based on your tab bar height
    right: 20,
    zIndex: 10, // Ensures it sits on top of everything
    backgroundColor: "#fff", // Optional: white background to make it pop
    borderRadius: 28, // Half of the icon size for a perfect circle
    elevation: 5, // Shadow for Android
    shadowColor: "#000", // Shadow for iOS
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
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
  docInfo: { flex: 1, marginRight: 12 },
  docTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  docIssuer: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  docMeta: { marginTop: 8, gap: 6 },
  docNumber: { fontSize: 12, color: COLORS.textSecondary },
  docDate: { flexDirection: "row", alignItems: "center", gap: 4 },
  docDateText: { fontSize: 12, color: COLORS.textSecondary },
});
