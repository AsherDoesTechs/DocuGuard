import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useColors } from "@/context/ThemeContext";
import { EmptyState } from "@/components/ui";
import { getTrashedDocuments, restoreDocumentFromTrash, hardDeleteDocument, LocalDocument } from "@/services/localDatabase";
import { feedbackService } from "@/services/feedbackService";
import { cancelDocumentNotifications } from "@/services/notificationScheduler";

export default function TrashScreen() {
  const colors = useColors();
  const router = useRouter();
  const [docs, setDocs] = useState<LocalDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTrashedDocuments();
      setDocs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const handleRestore = async (doc: LocalDocument) => {
    try {
      await restoreDocumentFromTrash(doc.id as number);
      feedbackService.success("Document restored");
      await load();
    } catch (e) {
      feedbackService.error("Failed to restore document");
    }
  };

  const handleDeletePermanently = async (doc: LocalDocument) => {
    Alert.alert("Delete Permanently", "This cannot be undone. Delete this document permanently?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await cancelDocumentNotifications(doc.id as number);
          await hardDeleteDocument(doc.id as number);
          feedbackService.success("Document permanently deleted");
          await load();
        } catch (e) {
          feedbackService.error("Failed to delete document");
        }
      }}
    ]);
  };

  const renderItem = ({ item }: { item: LocalDocument }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Ionicons name="trash-outline" size={20} color={colors.error} />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, { borderColor: colors.border }]} onPress={() => handleRestore(item)}>
          <Ionicons name="refresh-outline" size={16} color={colors.primary} />
          <Text style={[styles.btnText, { color: colors.primary }]}>Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { borderColor: colors.error }]} onPress={() => handleDeletePermanently(item)}>
          <Ionicons name="trash" size={16} color={colors.error} />
          <Text style={[styles.btnText, { color: colors.error }]}>Delete Permanently</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Trash</Text>
        <View style={{ width: 24 }} />
      </View>
      {loading ? (
        <View style={styles.center}><Text style={{ color: colors.textSecondary }}>Loading...</Text></View>
      ) : docs.length === 0 ? (
        <EmptyState title="Trash is empty" message="Deleted documents appear here" illustration="documents" />
      ) : (
        <FlatList data={docs} keyExtractor={(item) => String(item.id)} renderItem={renderItem} contentContainerStyle={styles.list} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  btnText: { fontSize: 13, fontWeight: "600" },
});
