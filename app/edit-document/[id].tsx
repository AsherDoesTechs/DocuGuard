import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { DOCUMENT_CATEGORIES, COLORS } from "@/constants";
import { formatCategoryForBackend } from "@/DocuGuard-Server/utils/categories";
import {
  getDocumentById,
  updateDocument,
  LocalDocument,
} from "../../services/localDatabase";
import * as SecureStore from "expo-secure-store";
import { api } from "../../services/api";
import { documentUpdateSchema, type DocumentUpdateInput, validateSchema } from "@/shared/validation";

type EditDocumentValues = Omit<DocumentUpdateInput, "id"> & {
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
};

export default function EditDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [initialData, setInitialData] = useState<EditDocumentValues>({
    title: "", 
    category: "other", 
    issuer: "", 
    documentNumber: "", 
    issueDate: "", 
    expiryDate: "", 
    notes: "",
    enableAlerts: true,
    status: "active",
    processingStatus: "completed",
    riskScore: 0,
    riskLevel: "Low",
    fileUrl: null,
    fileType: null,
    s3Key: null,
  });
  const [useLocalData, setUseLocalData] = useState(false);

  useEffect(() => {
    fetchDocumentData();
  }, [id]);

  const fetchDocumentData = async () => {
    try {
      const docId = parseInt(id as string, 10);
      if (isNaN(docId)) {
        throw new Error("Invalid document ID");
      }

      const localDoc = await getDocumentById(docId);
      if (localDoc) {
        setInitialData({
          title: localDoc.title || "",
          category: (localDoc.category || "other") as "identification" | "financial" | "medical" | "legal" | "academic" | "other",
          issuer: localDoc.issuer || "",
          documentNumber: localDoc.documentNumber || "",
          issueDate: localDoc.issueDate ? localDoc.issueDate.split("T")[0] : "",
          expiryDate: localDoc.expiryDate ? localDoc.expiryDate.split("T")[0] : "",
          notes: localDoc.notes || "",
        });
        setUseLocalData(true);
        setIsLoading(false);
        return;
      }

      const token = await SecureStore.getItemAsync("userToken");
      if (token) {
        const res = await fetch(`${(await import("../../services/api")).API_BASE_URL}/documents/${docId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to fetch document");
        const data = await res.json();
        setInitialData({
          title: data.title || "", category: data.category || "other", issuer: data.issuer || "",
          documentNumber: data.documentNumber || "", issueDate: data.issueDate ? data.issueDate.split("T")[0] : "",
          expiryDate: data.expiryDate ? data.expiryDate.split("T")[0] : "", notes: data.notes || "",
        });
        setUseLocalData(false);
      } else {
        throw new Error("No authentication token");
      }
    } catch (error: any) {
      console.error(error);
      Alert.alert("Error", "Could not load document details for editing.");
    } finally {
      setIsLoading(false);
    }
  };

  const validate = (values: EditDocumentValues): Partial<Record<keyof EditDocumentValues, string>> => {
    const docId = parseInt(id as string, 10);
    const valuesWithId = { ...values, id: docId } as DocumentUpdateInput;
    const result = validateSchema(documentUpdateSchema, valuesWithId);
    if (result.success) {
      return {};
    }
    return result.errors as Partial<Record<keyof EditDocumentValues, string>>;
  };

  const form = useForm<EditDocumentValues>({
    initialValues: initialData,
    validate,
    onSubmit: async (values) => {
      try {
        const docId = parseInt(id as string, 10);
        if (isNaN(docId)) throw new Error("Invalid document ID");

        await updateDocument(docId, {
          title: values.title.trim(), category: values.category, issuer: values.issuer.trim(),
          documentNumber: values.documentNumber.trim().toUpperCase(), issueDate: values.issueDate,
          expiryDate: values.expiryDate, notes: values.notes?.trim() || "",
        });

        if (!useLocalData) {
          const token = await SecureStore.getItemAsync("userToken");
          if (token) {
            try {
              const { API_BASE_URL } = await import("../../services/api");
              const res = await fetch(`${API_BASE_URL}/documents/${docId}`, {
                method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  title: values.title.trim(), category: values.category, issuer: values.issuer.trim(),
                  documentNumber: values.documentNumber.trim().toUpperCase(), issueDate: values.issueDate,
                  expiryDate: values.expiryDate, notes: values.notes?.trim() || "",
                }),
              });
              if (!res.ok) throw new Error("Failed to update document");
            } catch (syncErr) { console.warn("Could not sync to cloud:", syncErr); }
          }
        }
        Alert.alert("Success", "Document updated securely.");
        router.back();
      } catch (err: any) {
        Alert.alert("Error", err.message || "Could not save changes.");
      }
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading document...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Document</Text>
          <View style={{ width: 28 }} />
        </View>
        <Card>
          <Input label="Document Title" placeholder="e.g., US Passport" value={form.values.title} onChangeText={form.handleChange("title")} onBlur={form.handleBlur("title")} error={form.touched.title ? form.errors.title : undefined} />
          <View style={styles.formGroup}>
            <Text style={styles.label}>Category <Text style={styles.required}>*</Text></Text>
            <View style={styles.categorySelect}>
              {Object.entries(DOCUMENT_CATEGORIES).map(([key, value]) => (
                <TouchableOpacity key={key} onPress={() => form.handleChange("category")(key)} style={[styles.categoryOption, form.values.category === key && styles.categoryOptionActive]}>
                  <Text style={[styles.categoryOptionText, form.values.category === key && styles.categoryOptionTextActive]}>{value}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Input label="Issuer/Organization" placeholder="e.g., US State Department" value={form.values.issuer} onChangeText={form.handleChange("issuer")} onBlur={form.handleBlur("issuer")} error={form.touched.issuer ? form.errors.issuer : undefined} />
          <Input label="Document Number" placeholder="e.g., N12345678" value={form.values.documentNumber} onChangeText={form.handleChange("documentNumber")} onBlur={form.handleBlur("documentNumber")} error={form.touched.documentNumber ? form.errors.documentNumber : undefined} />
          <Input label="Issue Date" placeholder="YYYY-MM-DD" value={form.values.issueDate} onChangeText={form.handleChange("issueDate")} onBlur={form.handleBlur("issueDate")} error={form.touched.issueDate ? form.errors.issueDate : undefined} />
          <Input label="Expiry Date" placeholder="YYYY-MM-DD" value={form.values.expiryDate} onChangeText={form.handleChange("expiryDate")} onBlur={form.handleBlur("expiryDate")} error={form.touched.expiryDate ? form.errors.expiryDate : undefined} />
          <Input label="Notes" placeholder="Add any additional notes..." value={form.values.notes} onChangeText={form.handleChange("notes")} onBlur={form.handleBlur("notes")} />
          <View style={{ marginTop: 16 }}>
            <Button
              title="Save Changes"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
              feedbackType="success"
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: COLORS.textSecondary },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8, color: COLORS.text },
  required: { color: COLORS.danger },
  categorySelect: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryOption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#fff" },
  categoryOptionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  categoryOptionText: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  categoryOptionTextActive: { color: "#fff" },
});
