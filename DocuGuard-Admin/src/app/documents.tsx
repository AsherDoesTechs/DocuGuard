
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminToken } from "../services/adminSession";

// Define Document Vault item type
type VaultDocument = {
  id: string | number;
  title: string;
  fileName: string;
  fileSize: number;
  ownerEmail: string;
  ocrStatus: "completed" | "pending" | "failed";
  createdAt: string;
};

export default function AdminDocumentsScreen() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const token = await getAdminToken();

      if (!token) {
        router.replace("/");
        return;
      }

      const API_BASE_URL =
        process.env.EXPO_PUBLIC_API_BASE_URL ??
        "https://docuguard-api-onoj.onrender.com";

      const response = await fetch(
        `${API_BASE_URL}/admin/documents`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );

      if (response.status === 401) {
        router.replace("/");
        throw new Error(
          "Session expired. Please sign in again.",
        );
      }

      if (!response.ok) {
        throw new Error(
          "Failed to load document audit records from the server.",
        );
      }

      const data = await response.json();

      const docList: VaultDocument[] = Array.isArray(data.documents)
        ? data.documents
        : Array.isArray(data)
          ? data
          : [];

      setDocuments(docList);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

useEffect(() => {
  // Initial API request; fetchDocuments manages loading and data state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  void fetchDocuments();
}, [fetchDocuments]);

  // Derive filtered documents instead of maintaining duplicate state.
  const filteredDocs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return documents;
    }

    return documents.filter((document) => {
      const title = document.title ?? "";
      const fileName = document.fileName ?? "";
      const ownerEmail = document.ownerEmail ?? "";

      return (
        title.toLowerCase().includes(query) ||
        fileName.toLowerCase().includes(query) ||
        ownerEmail.toLowerCase().includes(query)
      );
    });
  }, [documents, searchQuery]);

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 Bytes";
    }

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(k)),
      sizes.length - 1,
    );

    return (
      parseFloat((bytes / Math.pow(k, i)).toFixed(2)) +
      " " +
      sizes[i]
    );
  };

  const handleInspectDoc = (doc: VaultDocument) => {
    Alert.alert(
      "Document Details",
      `Title: ${doc.title || doc.fileName}\n` +
        `File: ${doc.fileName}\n` +
        `Owner: ${doc.ownerEmail}\n` +
        `OCR Status: ${doc.ocrStatus.toUpperCase()}\n` +
        `Size: ${formatFileSize(doc.fileSize)}`,
      [{ text: "Close" }],
    );
  };

  const renderItem = ({
    item,
  }: {
    item: VaultDocument;
  }) => {
    const isCompleted = item.ocrStatus === "completed";
    const isFailed = item.ocrStatus === "failed";

    return (
      <View style={styles.docCard}>
        <View style={styles.docInfo}>
          <View style={styles.iconBox}>
            <Ionicons
              name="document-text-outline"
              size={22}
              color="#204D91"
            />
          </View>

          <View style={styles.docDetails}>
            <Text
              style={styles.docTitle}
              numberOfLines={1}
            >
              {item.title || item.fileName}
            </Text>

            <Text style={styles.docOwner}>
              Owner: {item.ownerEmail}
            </Text>

            <View style={styles.metaRow}>
              <View
                style={[
                  styles.badge,
                  isCompleted
                    ? styles.badgeCompleted
                    : isFailed
                      ? styles.badgeFailed
                      : styles.badgePending,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    isCompleted
                      ? styles.badgeTextCompleted
                      : isFailed
                        ? styles.badgeTextFailed
                        : styles.badgeTextPending,
                  ]}
                >
                  OCR: {item.ocrStatus.toUpperCase()}
                </Text>
              </View>

              <Text style={styles.sizeText}>
                {formatFileSize(item.fileSize)}
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          style={styles.inspectButton}
          onPress={() => handleInspectDoc(item)}
          accessibilityRole="button"
          accessibilityLabel={`Inspect ${item.title || item.fileName}`}
        >
          <Ionicons
            name="ellipsis-vertical"
            size={18}
            color="#68778D"
          />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header & Search */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>
            Document Vault Audits
          </Text>

          <Text style={styles.subtitle}>
            Inspect uploaded files and Azure OCR processing status
          </Text>
        </View>

        <Pressable
          style={styles.refreshButton}
          onPress={() => void fetchDocuments()}
          accessibilityRole="button"
          accessibilityLabel="Refresh documents"
        >
          <Ionicons
            name="refresh-outline"
            size={18}
            color="#204D91"
          />

          <Text style={styles.refreshText}>
            Refresh
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons
          name="search-outline"
          size={20}
          color="#8A96A8"
          style={styles.searchIcon}
        />

        <TextInput
          style={styles.searchInput}
          placeholder="Search by title, filename, or owner email..."
          placeholderTextColor="#8A96A8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search documents"
          returnKeyType="search"
        />

        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => setSearchQuery("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons
              name="close-circle"
              size={18}
              color="#8A96A8"
            />
          </Pressable>
        )}
      </View>

      {/* Content Body */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator
            size="large"
            color="#204D91"
          />

          <Text style={styles.centerText}>
            Loading documents...
          </Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.errorContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={32}
            color="#9B2C2C"
          />

          <Text style={styles.errorTitle}>
            Could not load documents
          </Text>

          <Text style={styles.errorText}>
            {errorMessage}
          </Text>

          <Pressable
            style={styles.retryButton}
            onPress={() => void fetchDocuments()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading documents"
          >
            <Text style={styles.retryButtonText}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : filteredDocs.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons
            name="folder-open-outline"
            size={48}
            color="#A0AEC0"
          />

          <Text style={styles.centerText}>
            {searchQuery.trim()
              ? "No documents match your search."
              : "No documents found in the vault."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredDocs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#F3F6FB",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#172B4D",
  },
  subtitle: {
    fontSize: 13,
    color: "#68778D",
    marginTop: 2,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE4EF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#204D91",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE4EF",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#172B4D",
  },
  listContainer: {
    gap: 12,
  },
  docCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  docInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#EAF1FF",
    alignItems: "center",
    justifyContent: "center",
  },
  docDetails: {
    flex: 1,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#172B4D",
  },
  docOwner: {
    fontSize: 13,
    color: "#68778D",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeCompleted: {
    backgroundColor: "#DEF7EC",
  },
  badgePending: {
    backgroundColor: "#FEF3C7",
  },
  badgeFailed: {
    backgroundColor: "#FDE8E8",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  badgeTextCompleted: {
    color: "#03543F",
  },
  badgeTextPending: {
    color: "#92400E",
  },
  badgeTextFailed: {
    color: "#9B1C1C",
  },
  sizeText: {
    fontSize: 12,
    color: "#68778D",
  },
  inspectButton: {
    padding: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
  },
  centerText: {
    color: "#68778D",
    marginTop: 10,
    fontSize: 14,
    textAlign: "center",
  },
  errorContainer: {
    padding: 24,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    marginTop: 20,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#9B2C2C",
    marginTop: 10,
  },
  errorText: {
    fontSize: 13,
    color: "#68778D",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#204D91",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
});
