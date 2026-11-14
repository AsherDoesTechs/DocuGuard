import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useColors } from "@/context/ThemeContext";
import { api } from "@/services/api";
import { getDocumentById, type LocalDocument } from "@/services/localDatabase";

function isImageType(fileType?: string | null, uri?: string | null) {
  const t = (fileType || "").toLowerCase();
  if (t.startsWith("image/") || t.includes("png") || t.includes("jpg") || t.includes("jpeg")) return true;
  const u = (uri || "").toLowerCase();
  return u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg");
}

export default function DocumentViewerScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const docId = Array.isArray(id) ? id[0] : id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<LocalDocument | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!docId) throw new Error("Missing document ID.");
        const numericId = Number(docId);
        if (!Number.isInteger(numericId)) throw new Error("Invalid document ID.");
        const doc = await getDocumentById(numericId);
        if (!doc) throw new Error("Document not found.");
        if (!mounted) return;
        setDocument(doc);

        const localUri =
          doc.fileUrl &&
          (doc.fileUrl.startsWith("file://") || doc.fileUrl.startsWith("content://"))
            ? doc.fileUrl
            : null;
        if (localUri) {
          const info = await FileSystem.getInfoAsync(localUri);
          if (info.exists) {
            setFileUri(localUri);
            return;
          }
        }

        if (doc.fileUrl && /^https?:\/\//i.test(doc.fileUrl)) {
          setFileUri(doc.fileUrl);
          return;
        }

        const ref = doc.cloudId ?? doc.id;
        if (ref != null) {
          try {
            const res = await api.client.get(`/documents/${ref}/file-url`);
            const url = res?.data?.fileUrl;
            if (typeof url === "string" && url) {
              setFileUri(url);
              return;
            }
          } catch {}
        }

        throw new Error("No file available to view for this document.");
      } catch (e: any) {
        if (mounted) setError(e?.message || "Could not open document file.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [docId]);

  const canRenderImage = isImageType(document?.fileType, fileUri);

  const handleOpenExternal = async () => {
    if (!fileUri) return;
    try {
      if (Platform.OS !== "web") {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare && (fileUri.startsWith("file://") || fileUri.startsWith("content://"))) {
          await Sharing.shareAsync(fileUri);
          return;
        }
      }
      await Linking.openURL(fileUri);
    } catch {
      setError("Could not open this file in an external viewer.");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {document?.title || "Document Viewer"}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Loading file...</Text>
        </View>
      ) : error || !fileUri ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={42} color={colors.error} />
          <Text style={styles.errorText}>{error || "No file available."}</Text>
        </View>
      ) : canRenderImage ? (
        <ScrollView
          style={styles.viewer}
          contentContainerStyle={styles.imageContainer}
          maximumZoomScale={4}
          minimumZoomScale={1}
          showsVerticalScrollIndicator={false}
        >
          <Image source={{ uri: fileUri }} style={styles.image} resizeMode="contain" />
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={48} color={colors.primary} />
          <Text style={styles.muted}>This file type cannot be previewed in-app.</Text>
          <Text style={styles.mutedSmall}>{document?.fileType || "Unknown file type"}</Text>
          <TouchableOpacity style={styles.button} onPress={handleOpenExternal} accessibilityRole="button">
            <Ionicons name="open-outline" size={18} color={colors.buttonPrimaryText} />
            <Text style={styles.buttonText}>Open File</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text, marginHorizontal: 8 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
    muted: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
    mutedSmall: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
    errorText: { fontSize: 14, color: colors.error, textAlign: "center" },
    viewer: { flex: 1 },
    imageContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 16 },
    image: { width: "100%", height: 600, backgroundColor: colors.surface },
    button: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 10,
    },
    buttonText: { color: colors.buttonPrimaryText, fontWeight: "600", fontSize: 14 },
  });
