import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { DOCUMENT_CATEGORIES, COLORS, MOCK_DOCUMENTS } from "@/constants";

export default function EditDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const document = MOCK_DOCUMENTS.find((d) => d.id === id);

  if (!document) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Document not found</Text>
        </View>
      </SafeAreaView>
    );
  }

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
    initialValues: {
      title: document.title,
      category: document.category,
      issuer: document.issuer,
      documentNumber: document.documentNumber,
      issueDate: document.issueDate,
      expiryDate: document.expiryDate,
      notes: document.notes || "",
    },
    validate,
    onSubmit: async (values) => {
      console.log("Document updated:", values);
      router.back();
    },
  });

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
