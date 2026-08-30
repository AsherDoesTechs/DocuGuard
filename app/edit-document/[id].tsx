import { API_BASE_URL } from "../../services/api";
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { DOCUMENT_CATEGORIES, COLORS } from "@/constants";
import { formatCategoryForBackend } from "@/DocuGuard-Server/utils/categories";

interface DocumentValues {
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
}

export default function EditDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [initialData, setInitialData] = useState<DocumentValues>({
    title: "",
    category: "other",
    issuer: "",
    documentNumber: "",
    issueDate: "",
    expiryDate: "",
    notes: "",
  });

  useEffect(() => {
    fetchDocumentData();
  }, [id]);

  const fetchDocumentData = async () => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await fetch(`${API_BASE_URL}/documents/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Failed to fetch document");
      const data = await res.json();

      setInitialData({
        title: data.title || "",
        category: data.category || "other",
        issuer: data.issuer || "",
        documentNumber: data.documentNumber || "",
        issueDate: data.issueDate ? data.issueDate.split("T")[0] : "",
        expiryDate: data.expiryDate ? data.expiryDate.split("T")[0] : "",
        notes: data.notes || "",
      });
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Could not load document details for editing.");
    } finally {
      setIsLoading(false);
    }
  };

  const validate = (values: any) => {
    const errors: Record<string, string> = {};
    if (!values.title) errors.title = "Document title is required";
    if (!values.issuer) errors.issuer = "Issuer is required";
    if (!values.documentNumber)
      errors.documentNumber = "Document number is required";
    if (!values.issueDate) errors.issueDate = "Issue date is required";
    if (!values.expiryDate) errors.expiryDate = "Expiry date is required";
    return errors;
  };

  const form = useForm({
    initialValues: initialData,
    validate,
    onSubmit: async (values) => {
      try {
        const token = await AsyncStorage.getItem("userToken");
        const payload = {
          ...values,
          category: formatCategoryForBackend(values.category),
        };
        const res = await fetch(`${API_BASE_URL}/documents/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to update document");
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
        <View style={styles.errorContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
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
          <Input
            label="Document Title"
            placeholder="e.g., US Passport"
            value={form.values.title}
            onChangeText={form.handleChange("title")}
            onBlur={form.handleBlur("title")}
            error={form.touched.title ? form.errors.title : undefined}
          />

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              Category <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.categorySelect}>
              {Object.entries(DOCUMENT_CATEGORIES).map(([key, value]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => form.handleChange("category")(key)}
                  style={[
                    styles.categoryOption,
                    form.values.category === key && styles.categoryOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryOptionText,
                      form.values.category === key &&
                        styles.categoryOptionTextActive,
                    ]}
                  >
                    {value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Input
            label="Issuer/Organization"
            placeholder="e.g., US State Department"
            value={form.values.issuer}
            onChangeText={form.handleChange("issuer")}
            onBlur={form.handleBlur("issuer")}
            error={form.touched.issuer ? form.errors.issuer : undefined}
          />

          <Input
            label="Document Number"
            placeholder="e.g., N12345678"
            value={form.values.documentNumber}
            onChangeText={form.handleChange("documentNumber")}
            onBlur={form.handleBlur("documentNumber")}
            error={
              form.touched.documentNumber
                ? form.errors.documentNumber
                : undefined
            }
          />

          <Input
            label="Issue Date"
            placeholder="YYYY-MM-DD"
            value={form.values.issueDate}
            onChangeText={form.handleChange("issueDate")}
            onBlur={form.handleBlur("issueDate")}
            error={form.touched.issueDate ? form.errors.issueDate : undefined}
          />

          <Input
            label="Expiry Date"
            placeholder="YYYY-MM-DD"
            value={form.values.expiryDate}
            onChangeText={form.handleChange("expiryDate")}
            onBlur={form.handleBlur("expiryDate")}
            error={form.touched.expiryDate ? form.errors.expiryDate : undefined}
          />

          <Input
            label="Notes"
            placeholder="Add any additional notes..."
            value={form.values.notes}
            onChangeText={form.handleChange("notes")}
            onBlur={form.handleBlur("notes")}
          />

          <View style={{ marginTop: 16 }}>
            <Button
              title="Save Changes"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: COLORS.text,
  },
  required: {
    color: COLORS.danger,
  },
  categorySelect: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#fff",
  },
  categoryOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryOptionText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.text,
  },
  categoryOptionTextActive: {
    color: "#fff",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    color: COLORS.text,
  },
});
