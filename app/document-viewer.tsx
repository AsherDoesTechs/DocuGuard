import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  if (t.startsWith("image/")) return true;
  if (
    t.includes("png") ||
    t.includes("jpg") ||
    t.includes("jpeg") ||
    t.includes("webp") ||
    t.includes("heic") ||
    t.includes("heif") ||
    t.includes("gif") ||
    t.includes("bmp")
  ) {
    return true;
  }
  const u = (uri || "").toLowerCase();
  return /\.(png|jpe?g|webp|heic|heif|gif|bmp)(\?|#|$)/i.test(u);
}

function inferExtension(fileType?: string | null, uri?: string | null) {
  const t = (fileType || "").toLowerCase();
  if (t.includes("pdf")) return "pdf";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic")) return "heic";
  if (t.includes("heif")) return "heif";
  if (t.includes("gif")) return "gif";
  if (t.includes("bmp")) return "bmp";
  if (t.includes("jpeg") || t.includes("jpg") || t.includes("image")) return "jpg";
  const match = (uri || "").toLowerCase().match(/\.(pdf|png|jpe?g|webp|heic|heif|gif|bmp)(\?|#|$)/i);
  if (!match) return "bin";
  return match[1] === "jpeg" ? "jpg" : match[1];
}

function inferMimeType(fileType?: string | null, uri?: string | null) {
  const t = (fileType || "").toLowerCase().trim();
  if (t.includes("/")) return t;
  const ext = inferExtension(fileType, uri);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  if (ext === "jpg") return "image/jpeg";
  return "application/octet-stream";
}

function isPdfType(fileType?: string | null, uri?: string | null) {
  const t = (fileType || "").toLowerCase();
  if (t.includes("pdf")) return true;
  const u = (uri || "").toLowerCase();
  return /\.pdf(\?|#|$)/i.test(u);
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
  const [pageUris, setPageUris] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

  const fetchFreshRemoteUri = useCallback(async (doc: LocalDocument) => {
    const ref = doc.cloudId ?? doc.id;
    if (ref == null) return null;
    try {
      const res = await api.client.get(`/documents/${ref}/file-url`);
      const url = res?.data?.fileUrl || res?.data?.file_url;
      return typeof url === "string" && url.trim() ? url.trim() : null;
    } catch {
      return null;
    }
  }, []);

  const resolveInitialUri = useCallback(
    async (doc: LocalDocument): Promise<string> => {
      const localUri =
        doc.fileUrl &&
        (doc.fileUrl.startsWith("file://") || doc.fileUrl.startsWith("content://"))
          ? doc.fileUrl
          : null;
      if (localUri) {
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists) return localUri;
      }

      if (doc.fileUrl && /^https?:\/\//i.test(doc.fileUrl)) {
        return doc.fileUrl;
      }

      const remote = await fetchFreshRemoteUri(doc);
      if (remote) return remote;

      throw new Error("No file available to view for this document.");
    },
    [fetchFreshRemoteUri],
  );

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

        const pages = Array.isArray((doc as any).pageImages)
          ? ((doc as any).pageImages as string[]).filter(
              (u) => typeof u === "string" && u.length > 0,
            )
          : [];
        if (pages.length > 1) {
          if (mounted) {
            setPageUris(pages);
            setFileUri(pages[0]);
          }
        } else {
          const uri = await resolveInitialUri(doc);
          if (mounted) setFileUri(uri);
        }
      } catch (e: any) {
        if (mounted) setError(e?.message || "Could not open document file.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [docId, resolveInitialUri]);

  const isMultiPage = pageUris.length > 1;
  const canRenderImage =
    isMultiPage || isImageType(document?.fileType, fileUri);
  const isPdf =
    !isMultiPage && isPdfType(document?.fileType, fileUri || document?.fileUrl || null);

  const handleOpenExternal = async () => {
    if (!fileUri || !document) return;
    setError(null);
    try {
      let localUri = fileUri;

      // Remote files: download to cache so external apps can access reliably.
      if (/^https?:\/\//i.test(localUri)) {
        const fresh = await fetchFreshRemoteUri(document);
        const source = fresh || localUri;
        const ext = inferExtension(document.fileType, source);
        const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (!baseDir) throw new Error("No storage available");
        const target = `${baseDir}open_${document.id ?? document.cloudId ?? "file"}_${Date.now()}.${ext}`;
        const result = await FileSystem.downloadAsync(source, target);
        if (result.status < 200 || result.status >= 300 || !result.uri) {
          // Fallback: try opening remote URL directly (e.g. in browser/PDF viewer)
          const canOpenRemote = await Linking.canOpenURL(source);
          if (canOpenRemote) {
            await Linking.openURL(source);
            return;
          }
          throw new Error("Download failed");
        }
        localUri = result.uri;
      }

      if (localUri.startsWith("file://")) {
        const info = await FileSystem.getInfoAsync(localUri);
        if (!info.exists) {
          const fresh = await fetchFreshRemoteUri(document);
          if (fresh) {
            setFileUri(fresh);
            localUri = fresh;
          } else {
            throw new Error("File missing");
          }
        }
      }

      const mimeType = inferMimeType(document.fileType, localUri);

      if (Platform.OS === "android" && localUri.startsWith("file://")) {
        let contentUri = localUri;
        try {
          contentUri = await FileSystem.getContentUriAsync(localUri);
        } catch {
          // keep file://; sharing may still work
        }
        if (/^(content:|https?:)/i.test(contentUri)) {
          try {
            const canOpen = await Linking.canOpenURL(contentUri);
            if (canOpen) {
              await Linking.openURL(contentUri);
              return;
            }
          } catch {
            // fall through to share
          }
        }
      }

      if (Platform.OS !== "web" && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(localUri, {
          mimeType,
          dialogTitle: "Open with",
          UTI: mimeType,
        } as any);
        return;
      }

      if (/^(https?:|content:)/i.test(localUri)) {
        await Linking.openURL(localUri);
        return;
      }

      const canOpen = await Linking.canOpenURL(localUri);
      if (canOpen) {
        await Linking.openURL(localUri);
        return;
      }

      throw new Error("No handler available");
    } catch {
      setError("Could not open this file in an external viewer.");
    }
  };

  const handleImageError = async () => {
    if (!document || retrying) return;
    setRetrying(true);
    try {
      const freshRemote = await fetchFreshRemoteUri(document);
      const candidate = freshRemote || fileUri;
      if (candidate && /^https?:\/\//i.test(candidate)) {
        const ext = inferExtension(document.fileType, candidate);
        const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (baseDir) {
          const target = `${baseDir}doc_view_${document.id ?? document.cloudId ?? "file"}_${Date.now()}.${ext}`;
          const result = await FileSystem.downloadAsync(candidate, target);
          if (result.status >= 200 && result.status < 300 && result.uri) {
            const info = await FileSystem.getInfoAsync(result.uri);
            if (info.exists) {
              setError(null);
              setFileUri(result.uri);
              return;
            }
          }
        }
        if (freshRemote && freshRemote !== fileUri) {
          setError(null);
          setFileUri(freshRemote);
          return;
        }
      }
      setError("Could not load this image file.");
    } finally {
      setRetrying(false);
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
          {fileUri ? (
            <TouchableOpacity style={styles.button} onPress={handleOpenExternal} accessibilityRole="button">
              <Ionicons name="open-outline" size={18} color={colors.buttonPrimaryText} />
              <Text style={styles.buttonText}>Open with</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : canRenderImage ? (
        <ScrollView
          style={styles.viewer}
          contentContainerStyle={styles.imageContainer}
          maximumZoomScale={4}
          minimumZoomScale={1}
          showsVerticalScrollIndicator={false}
        >
          {isMultiPage ? (
            <>
              <Text style={styles.pageCountText}>
                {pageUris.length} pages
              </Text>
              {pageUris.map((uri, idx) => (
                <View key={`${uri}-${idx}`} style={styles.pageBlock}>
                  <Text style={styles.pageLabel}>Page {idx + 1}</Text>
                  <Image
                    source={{ uri }}
                    style={styles.image}
                    resizeMode="contain"
                    onError={() => {
                      if (idx === 0) handleImageError();
                    }}
                  />
                </View>
              ))}
            </>
          ) : (
            <>
              <Image
                key={fileUri || "image"}
                source={{ uri: fileUri as string }}
                style={styles.image}
                resizeMode="contain"
                onError={handleImageError}
              />
              {retrying ? (
                <View style={styles.retryOverlay}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.mutedSmall}>Retrying image...</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : isPdf ? (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={56} color={colors.primary} />
          <Text style={styles.muted}>PDF document</Text>
          <Text style={styles.mutedSmall} numberOfLines={2}>
            {document?.title || "Open this file to view its contents."}
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleOpenExternal} accessibilityRole="button">
            <Ionicons name="open-outline" size={18} color={colors.buttonPrimaryText} />
            <Text style={styles.buttonText}>Open PDF</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={48} color={colors.primary} />
          <Text style={styles.muted}>This file type cannot be previewed in-app.</Text>
          <Text style={styles.mutedSmall}>{document?.fileType || "Unknown file type"}</Text>
          <TouchableOpacity style={styles.button} onPress={handleOpenExternal} accessibilityRole="button">
            <Ionicons name="open-outline" size={18} color={colors.buttonPrimaryText} />
            <Text style={styles.buttonText}>Open with</Text>
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
    imageContainer: { flexGrow: 1, alignItems: "center", justifyContent: "flex-start", padding: 16, gap: 12 },
    image: { width: "100%", height: 600, backgroundColor: colors.surface },
    pageBlock: { width: "100%", alignItems: "center", marginBottom: 16 },
    pageLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginBottom: 6, alignSelf: "flex-start" },
    pageCountText: { fontSize: 13, fontWeight: "700", color: colors.primary, marginBottom: 8, alignSelf: "flex-start" },
    retryOverlay: { marginTop: 12, alignItems: "center", gap: 6 },
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
