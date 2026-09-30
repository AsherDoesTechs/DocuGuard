import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";

// If your alias fails, you can also change this to a relative path like "../../constants/documentTypes"
import { DOCUMENTS_BY_CATEGORY } from "../../constants/documentTypes";
import { Card, Input, Button } from "@/components/ui";
import { COLORS } from "@/constants";
import {
  getDocumentById,
  updateDocument,
  markDocumentSynced,
  updateDocumentSyncStatus,
} from "@/services/localDatabase";
import { api, API_BASE_URL } from "@/services/api";
import { documentUpdateSchema, validateSchema } from "@/shared/validation";

/* =========================================================
   TYPES
========================================================= */

type DocumentGroup =
  | "government"
  | "civil"
  | "legal"
  | "financial"
  | "education"
  | "employment"
  | "personal"
  | "other";

type SpecificDocumentItem = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  defaultIssuer: string;
  category: string;
};

type EditDocumentValues = {
  title: string;
  documentTypeId: string;
  documentGroup: DocumentGroup;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
  enableAlerts: boolean;

  status: string;
  processingStatus: string;
  riskScore: number;
  riskLevel: string;

  fileUrl: string | null;
  fileType: string | null;
  s3Key: string | null;
};

/* =========================================================
   CONSTANTS
========================================================= */

const GROUP_LABELS: Record<DocumentGroup, string> = {
  government: "Government",
  civil: "Civil",
  legal: "Legal",
  financial: "Financial",
  education: "Education",
  employment: "Employment",
  personal: "Personal",
  other: "Other",
};

const GROUP_ICONS: Record<DocumentGroup, keyof typeof Ionicons.glyphMap> = {
  government: "shield-checkmark-outline",
  civil: "people-outline",
  legal: "hammer-outline",
  financial: "wallet-outline",
  education: "school-outline",
  employment: "briefcase-outline",
  personal: "person-outline",
  other: "folder-outline",
};

const BACKEND_CATEGORIES = {
  IDENTIFICATION: "identification",
  FINANCIAL: "financial",
  MEDICAL: "medical",
  LEGAL: "legal",
  ACADEMIC: "academic",
  OTHER: "other",
} as const;

/* =========================================================
   HELPERS
========================================================= */

function formatCategoryForBackend(
  specificCategory: string,
  group: DocumentGroup,
): string {
  const category = specificCategory?.trim().toLowerCase() || "";

  if (
    [
      "passport",
      "government-id",
      "license",
      "prc-id",
      "sss-id",
      "philhealth-id",
      "tin-id",
      "postal-id",
      "senior-citizen-id",
      "voters-id",
      "barangay-id",
      "pwd-id",
      "sirb",
      "ofw-id",
    ].includes(category)
  ) {
    return BACKEND_CATEGORIES.IDENTIFICATION;
  }

  if (
    [
      "financial",
      "insurance",
      "bank",
      "bank-statement",
      "bank-certificate",
      "loan",
      "credit-card",
      "payment",
      "tax",
      "investment",
    ].includes(category)
  ) {
    return BACKEND_CATEGORIES.FINANCIAL;
  }

  if (["medical", "medical-record"].includes(category)) {
    return BACKEND_CATEGORIES.MEDICAL;
  }

  if (
    [
      "legal",
      "contract",
      "affidavit",
      "deed",
      "lease",
      "spa",
      "notarized",
      "court",
      "legal-notice",
      "demand-letter",
      "authorization-letter",
      "permit",
      "business-permit",
    ].includes(category)
  ) {
    return BACKEND_CATEGORIES.LEGAL;
  }

  if (
    [
      "education",
      "academic",
      "diploma",
      "transcript",
      "report-card",
      "training",
      "enrollment",
      "school-id",
      "graduation",
      "completion",
      "scholarship",
    ].includes(category)
  ) {
    return BACKEND_CATEGORIES.ACADEMIC;
  }

  switch (group) {
    case "government":
      return BACKEND_CATEGORIES.IDENTIFICATION;
    case "legal":
      return BACKEND_CATEGORIES.LEGAL;
    case "financial":
      return BACKEND_CATEGORIES.FINANCIAL;
    case "education":
      return BACKEND_CATEGORIES.ACADEMIC;
    case "civil":
    case "employment":
    case "personal":
    case "other":
    default:
      return BACKEND_CATEGORIES.OTHER;
  }
}

function normalizeDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  return String(value).split("T")[0];
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function getDaysUntilExpiry(expiryDate: string): number | null {
  if (!expiryDate || !isValidDate(expiryDate)) {
    return null;
  }
  const [year, month, day] = expiryDate.split("-").map(Number);
  const expiry = new Date(year, month - 1, day);
  const today = new Date();

  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  return Math.ceil(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function getExpiryMessage(expiryDate: string): string {
  if (!expiryDate) {
    return "No expiration date entered.";
  }
  if (!isValidDate(expiryDate)) {
    return "Enter a valid date using YYYY-MM-DD.";
  }
  const days = getDaysUntilExpiry(expiryDate);
  if (days === null) {
    return "Enter a valid expiration date.";
  }
  if (days < 0) {
    const amount = Math.abs(days);
    return `Expired ${amount} day${amount === 1 ? "" : "s"} ago.`;
  }
  if (days === 0) {
    return "Expires today.";
  }
  if (days <= 30) {
    return `Expires in ${days} day${days === 1 ? "" : "s"}.`;
  }
  return `Valid for approximately ${days} more days.`;
}

function findDocumentTypeById(id: string): {
  group: DocumentGroup;
  item: SpecificDocumentItem;
} | null {
  if (!id) {
    return null;
  }

  for (const [groupKey, items] of Object.entries(DOCUMENTS_BY_CATEGORY) as [
    DocumentGroup,
    SpecificDocumentItem[],
  ][]) {
    const group = groupKey;
    const item = items.find(
      (document: SpecificDocumentItem) => document.id === id,
    );

    if (item) {
      return { group, item };
    }
  }

  return null;
}

function findDocumentTypeByTitle(title: string): {
  group: DocumentGroup;
  item: SpecificDocumentItem;
} | null {
  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const [groupKey, items] of Object.entries(DOCUMENTS_BY_CATEGORY) as [
    DocumentGroup,
    SpecificDocumentItem[],
  ][]) {
    const group = groupKey;
    const item = items.find(
      (document: SpecificDocumentItem) =>
        document.title.trim().toLowerCase() === normalized,
    );

    if (item) {
      return { group, item };
    }
  }

  return null;
}

function inferGroupFromBackendCategory(category: string): DocumentGroup {
  switch (category?.trim().toLowerCase()) {
    case "identification":
      return "government";
    case "financial":
      return "financial";
    case "legal":
      return "legal";
    case "academic":
      return "education";
    case "medical":
      return "personal";
    default:
      return "other";
  }
}

/* =========================================================
   COMPONENT
========================================================= */

export default function EditDocumentScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
  }>();

  const router = useRouter();
  const documentId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [useLocalData, setUseLocalData] = useState(false);
  // Backend id for this document. The local row id is NOT valid against the API.
  const [cloudId, setCloudId] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DocumentGroup>("other");
  const [typeSearch, setTypeSearch] = useState("");
  const [showAllTypes, setShowAllTypes] = useState(false);

  const [touched, setTouched] = useState<
    Partial<Record<keyof EditDocumentValues, boolean>>
  >({});

  const [errors, setErrors] = useState<
    Partial<Record<keyof EditDocumentValues, string>>
  >({});

  const emptyValues = useMemo<EditDocumentValues>(
    () => ({
      title: "",
      documentTypeId: "",
      documentGroup: "other",
      category: BACKEND_CATEGORIES.OTHER,
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
    }),
    [],
  );

  const [values, setValues] = useState<EditDocumentValues>(emptyValues);
  const [initialData, setInitialData] =
    useState<EditDocumentValues>(emptyValues);

  const groups = useMemo(
    () => Object.keys(DOCUMENTS_BY_CATEGORY) as DocumentGroup[],
    [],
  );

  const availableTypes = useMemo(() => {
    const types =
      (DOCUMENTS_BY_CATEGORY[selectedGroup] as SpecificDocumentItem[]) || [];
    const query = typeSearch.trim().toLowerCase();
    let filtered = types;

    if (query) {
      filtered = types.filter(
        (item: SpecificDocumentItem) =>
          item.title.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query),
      );
    }

    if (query || showAllTypes) {
      return filtered;
    }

    return filtered.slice(0, 8);
  }, [selectedGroup, typeSearch, showAllTypes]);

  const selectedDocumentType = useMemo(
    () => findDocumentTypeById(values.documentTypeId),
    [values.documentTypeId],
  );

  const daysUntilExpiry = useMemo(
    () => getDaysUntilExpiry(values.expiryDate),
    [values.expiryDate],
  );

  const hasChanges = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialData),
    [values, initialData],
  );

  const updateValue = useCallback(
    <K extends keyof EditDocumentValues>(
      field: K,
      value: EditDocumentValues[K],
    ) => {
      setValues((current) => ({
        ...current,
        [field]: value,
      }));

      setTouched((current) => ({
        ...current,
        [field]: true,
      }));

      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    },
    [],
  );

  const handleSelectDocumentType = useCallback(
    (group: DocumentGroup, item: SpecificDocumentItem) => {
      const backendCategory = formatCategoryForBackend(item.category, group);

      setSelectedGroup(group);

      setValues((current) => ({
        ...current,
        documentTypeId: item.id,
        documentGroup: group,
        title: item.title,
        category: backendCategory,
        issuer: item.defaultIssuer || current.issuer || "",
      }));

      setErrors((current) => {
        const next = { ...current };
        delete next.title;
        delete next.category;
        delete next.issuer;
        return next;
      });

      setTouched((current) => ({
        ...current,
        title: true,
        category: true,
        issuer: true,
      }));

      setTypeSearch("");
    },
    [],
  );

  const fetchDocumentData = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      if (!documentId) {
        throw new Error("Document ID is missing.");
      }

      const numericId = Number(documentId);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid document ID.");
      }

      const localDocument = await getDocumentById(numericId);

      if (localDocument) {
        const title = localDocument.title || "";
        const backendCategory =
          localDocument.category || BACKEND_CATEGORIES.OTHER;

        const matchedType = findDocumentTypeByTitle(title);
        const group =
          matchedType?.group || inferGroupFromBackendCategory(backendCategory);

        const loadedValues: EditDocumentValues = {
          title,
          documentTypeId: matchedType?.item.id || "",
          documentGroup: group,
          category: backendCategory,
          issuer: localDocument.issuer || "",
          documentNumber: localDocument.documentNumber || "",
          issueDate: normalizeDate(localDocument.issueDate),
          expiryDate: normalizeDate(localDocument.expiryDate),
          notes: localDocument.notes || "",
          enableAlerts: localDocument.enableAlerts !== false,
          status: localDocument.status || "active",
          processingStatus: localDocument.processingStatus || "completed",
          riskScore: localDocument.riskScore || 0,
          riskLevel: localDocument.riskLevel || "Low",
          fileUrl: localDocument.fileUrl || null,
          fileType: localDocument.fileType || null,
          s3Key: localDocument.s3Key || null,
        };

        setValues(loadedValues);
        setInitialData(loadedValues);
        setSelectedGroup(group);
        setUseLocalData(true);
        setCloudId(
          typeof localDocument.cloudId === "number" ? localDocument.cloudId : null,
        );
        return;
      }

      const token = await SecureStore.getItemAsync("userToken");
      if (!token) {
        throw new Error("You are not authenticated.");
      }

      const response = await fetch(`${API_BASE_URL}/documents/${numericId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load document (${response.status}).`);
      }

      const result = await response.json();
      const data = result?.document || result?.data || result;
      setCloudId(typeof data?.id === "number" ? data.id : null);

      const title = data?.title || "";
      const backendCategory = data?.category || BACKEND_CATEGORIES.OTHER;
      const matchedType = findDocumentTypeByTitle(title);
      const group =
        matchedType?.group || inferGroupFromBackendCategory(backendCategory);

      const loadedValues: EditDocumentValues = {
        title,
        documentTypeId: matchedType?.item.id || "",
        documentGroup: group,
        category: backendCategory,
        issuer: data?.issuer || "",
        documentNumber: data?.documentNumber || "",
        issueDate: normalizeDate(data?.issueDate),
        expiryDate: normalizeDate(data?.expiryDate),
        notes: data?.notes || "",
        enableAlerts: data?.enableAlerts !== false,
        status: data?.status || "active",
        processingStatus: data?.processingStatus || "completed",
        riskScore: Number(data?.riskScore || 0),
        riskLevel: data?.riskLevel || "Low",
        fileUrl: data?.fileUrl || null,
        fileType: data?.fileType || null,
        s3Key: data?.s3Key || null,
      };

      setValues(loadedValues);
      setInitialData(loadedValues);
      setSelectedGroup(group);
      setUseLocalData(false);
    } catch (error: any) {
      console.error("Failed to load document:", error);
      setLoadError(error?.message || "Could not load document details.");
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchDocumentData();
  }, [fetchDocumentData]);

  const validateForm = useCallback(() => {
    const nextErrors: Partial<Record<keyof EditDocumentValues, string>> = {};
    const title = values.title.trim();
    const issuer = values.issuer.trim();
    const documentNumber = values.documentNumber.trim();

    if (!title) {
      nextErrors.title = "Document title is required.";
    }
    if (!values.documentTypeId) {
      nextErrors.category = "Please select a specific document type.";
    }
    if (!issuer) {
      nextErrors.issuer = "Issuer or organization is required.";
    }
    if (!documentNumber) {
      nextErrors.documentNumber = "Document number is required.";
    }
    if (!values.issueDate) {
      nextErrors.issueDate = "Issue date is required.";
    } else if (!isValidDate(values.issueDate)) {
      nextErrors.issueDate = "Use YYYY-MM-DD format.";
    }
    if (!values.expiryDate) {
      nextErrors.expiryDate = "Expiry date is required.";
    } else if (!isValidDate(values.expiryDate)) {
      nextErrors.expiryDate = "Use YYYY-MM-DD format.";
    }
    if (
      !nextErrors.issueDate &&
      !nextErrors.expiryDate &&
      values.issueDate > values.expiryDate
    ) {
      nextErrors.expiryDate = "Expiry date cannot be earlier than issue date.";
    }

    const numericId = Number(documentId);
    if (Number.isInteger(numericId) && numericId > 0) {
      const schemaPayload = {
        id: numericId,
        title,
        category: values.category,
        issuer,
        documentNumber: documentNumber.toUpperCase(),
        issueDate: values.issueDate,
        expiryDate: values.expiryDate,
        notes: values.notes.trim(),
        enableAlerts: values.enableAlerts,
        status: values.status,
        processingStatus: values.processingStatus,
        riskScore: values.riskScore,
        riskLevel: values.riskLevel,
        fileUrl: values.fileUrl,
        fileType: values.fileType,
        s3Key: values.s3Key,
      };

      try {
        const result = validateSchema(documentUpdateSchema, schemaPayload);
        if (!result.success && result.errors) {
          Object.assign(nextErrors, result.errors);
        }
      } catch (schemaError) {
        console.warn(
          "Shared document validation could not be applied:",
          schemaError,
        );
      }
    }

    setErrors(nextErrors);
    setTouched({
      title: true,
      category: true,
      issuer: true,
      documentNumber: true,
      issueDate: true,
      expiryDate: true,
      notes: true,
    });

    return Object.keys(nextErrors).length === 0;
  }, [documentId, values]);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }

    if (!validateForm()) {
      Alert.alert(
        "Check Your Information",
        "Please correct the highlighted fields before saving.",
      );
      return;
    }

    const numericId = Number(documentId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      Alert.alert("Error", "Invalid document ID.");
      return;
    }

    setIsSaving(true);
    const payload = {
      title: values.title.trim(),
      category: values.category,
      issuer: values.issuer.trim(),
      documentNumber: values.documentNumber.trim().toUpperCase(),
      issueDate: values.issueDate,
      expiryDate: values.expiryDate,
      notes: values.notes.trim(),
      enableAlerts: values.enableAlerts,
    };

    let localSaveSuccessful = false;
    let cloudSaveSuccessful = false;

    try {
      await updateDocument(numericId, payload);
      localSaveSuccessful = true;

      if (!useLocalData) {
        const token = await SecureStore.getItemAsync("userToken");
        if (!token) {
          throw new Error(
            "Changes were saved locally, but cloud synchronization could not start because you are not authenticated.",
          );
        }

        // The API addresses documents by their backend id. Without one there is
        // nothing to PUT; updateDocument already queued the change (needs_sync=1)
        // for syncToCloud to push on the next pass.
        if (cloudId) {
          await api.documents.update(cloudId, payload);
          // updateDocument() flagged the row needs_sync=1; the cloud write above
          // satisfied it, so clear the flag instead of leaving it pending forever.
          await markDocumentSynced(numericId);
          await updateDocumentSyncStatus(numericId, "synced");
          cloudSaveSuccessful = true;
        }
      }

      const savedValues: EditDocumentValues = {
        ...values,
        title: payload.title,
        category: payload.category,
        issuer: payload.issuer,
        documentNumber: payload.documentNumber,
        issueDate: payload.issueDate,
        expiryDate: payload.expiryDate,
        notes: payload.notes,
        enableAlerts: payload.enableAlerts,
      };

      setValues(savedValues);
      setInitialData(savedValues);
      setErrors({});
      setTouched({});

      if (cloudSaveSuccessful || useLocalData) {
        Alert.alert(
          "Changes Saved",
          useLocalData
            ? "Your document was updated on this device."
            : "Your document was updated successfully.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      } else if (localSaveSuccessful) {
        Alert.alert(
          "Saved Locally",
          "Your changes were saved on this device.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      }
    } catch (error: any) {
      console.error("Document update failed:", error);
      if (localSaveSuccessful) {
        Alert.alert(
          "Saved Locally",
          `Your changes were saved on this device, but cloud synchronization failed.\n\n${
            error?.message ||
            "Please try again when you have an internet connection."
          }`,
        );
      } else {
        Alert.alert(
          "Save Failed",
          error?.message || "Could not save your changes.",
        );
      }
    } finally {
      setIsSaving(false);
    }
  }, [cloudId, documentId, isSaving, router, useLocalData, validateForm, values]);

  const handleReset = useCallback(() => {
    if (!hasChanges) {
      return;
    }

    Alert.alert("Reset Changes?", "All unsaved changes will be discarded.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => {
          setValues(initialData);
          setSelectedGroup(initialData.documentGroup);
          setErrors({});
          setTouched({});
          setTypeSearch("");
          setShowAllTypes(false);
        },
      },
    ]);
  }, [hasChanges, initialData]);

  const handleBack = useCallback(() => {
    if (!hasChanges) {
      router.back();
      return;
    }

    Alert.alert(
      "Unsaved Changes",
      "You have changes that have not been saved. Leave this page?",
      [
        { text: "Stay", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ],
    );
  }, [hasChanges, router]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading document...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.errorContainer}>
          <View style={styles.errorIcon}>
            <Ionicons
              name="alert-circle-outline"
              size={42}
              color={COLORS.danger}
            />
          </View>
          <Text style={styles.errorTitle}>Could not load document</Text>
          <Text style={styles.errorMessage}>{loadError}</Text>
          <View style={styles.errorActions}>
            <Button title="Try Again" onPress={fetchDocumentData} />
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={27} color={COLORS.primary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Edit Document</Text>
            {hasChanges && (
              <View style={styles.unsavedBadge}>
                <View style={styles.unsavedDot} />
                <Text style={styles.unsavedText}>Unsaved changes</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={handleReset}
            disabled={!hasChanges}
            style={[
              styles.resetButton,
              !hasChanges && styles.resetButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Reset changes"
          >
            <Ionicons
              name="refresh-outline"
              size={21}
              color={hasChanges ? COLORS.primary : COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="document-text-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Document Type</Text>
                <Text style={styles.sectionSubtitle}>
                  Select the type that best matches this document.
                </Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>
              Document Group
              <Text style={styles.required}> *</Text>
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.groupList}
            >
              {groups.map((group) => {
                const active = selectedGroup === group;
                return (
                  <TouchableOpacity
                    key={group}
                    onPress={() => {
                      setSelectedGroup(group);
                      setTypeSearch("");
                      setShowAllTypes(false);
                    }}
                    style={[styles.groupChip, active && styles.groupChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Ionicons
                      name={GROUP_ICONS[group]}
                      size={17}
                      color={active ? "#FFFFFF" : COLORS.textSecondary}
                    />
                    <Text
                      style={[
                        styles.groupChipText,
                        active && styles.groupChipTextActive,
                      ]}
                    >
                      {GROUP_LABELS[group]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.searchContainer}>
              <Ionicons
                name="search-outline"
                size={19}
                color={COLORS.textSecondary}
              />
              <TextInput
                value={typeSearch}
                onChangeText={setTypeSearch}
                placeholder="Search document types..."
                placeholderTextColor={COLORS.textSecondary}
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {typeSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => setTypeSearch("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons
                    name="close-circle"
                    size={19}
                    color={COLORS.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.fieldLabel}>
              Specific Document Type
              <Text style={styles.required}> *</Text>
            </Text>

            <View style={styles.documentTypeList}>
              {availableTypes.length === 0 ? (
                <View style={styles.emptyTypes}>
                  <Ionicons
                    name="search-outline"
                    size={28}
                    color={COLORS.textSecondary}
                  />
                  <Text style={styles.emptyTypesText}>
                    No document types found.
                  </Text>
                </View>
              ) : (
                availableTypes.map((item: SpecificDocumentItem) => {
                  const active = values.documentTypeId === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() =>
                        handleSelectDocumentType(selectedGroup, item)
                      }
                      style={[
                        styles.documentTypeCard,
                        active && styles.documentTypeCardActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <View
                        style={[
                          styles.documentTypeIcon,
                          active && styles.documentTypeIconActive,
                        ]}
                      >
                        <Ionicons
                          name={item.icon}
                          size={22}
                          color={active ? "#FFFFFF" : COLORS.primary}
                        />
                      </View>
                      <View style={styles.documentTypeContent}>
                        <Text
                          style={[
                            styles.documentTypeTitle,
                            active && styles.documentTypeTitleActive,
                          ]}
                        >
                          {item.title}
                        </Text>
                        <Text
                          style={styles.documentTypeDescription}
                          numberOfLines={2}
                        >
                          {item.description}
                        </Text>
                      </View>
                      <Ionicons
                        name={active ? "checkmark-circle" : "chevron-forward"}
                        size={active ? 23 : 20}
                        color={active ? COLORS.primary : COLORS.textSecondary}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            {!typeSearch &&
              (
                (DOCUMENTS_BY_CATEGORY[
                  selectedGroup
                ] as SpecificDocumentItem[]) || []
              ).length > 8 && (
                <TouchableOpacity
                  onPress={() => setShowAllTypes((current) => !current)}
                  style={styles.showMoreButton}
                >
                  <Text style={styles.showMoreText}>
                    {showAllTypes
                      ? "Show Less"
                      : `Show All ${
                          (
                            (DOCUMENTS_BY_CATEGORY[
                              selectedGroup
                            ] as SpecificDocumentItem[]) || []
                          ).length
                        } Types`}
                  </Text>
                  <Ionicons
                    name={showAllTypes ? "chevron-up" : "chevron-down"}
                    size={17}
                    color={COLORS.primary}
                  />
                </TouchableOpacity>
              )}

            {touched.category && errors.category && (
              <Text style={styles.errorText}>{errors.category}</Text>
            )}
          </Card>

          {selectedDocumentType && (
            <Card>
              <View style={styles.selectedSummary}>
                <View style={styles.selectedSummaryIcon}>
                  <Ionicons
                    name={selectedDocumentType.item.icon}
                    size={25}
                    color={COLORS.primary}
                  />
                </View>
                <View style={styles.selectedSummaryContent}>
                  <Text style={styles.selectedSummaryLabel}>
                    SELECTED DOCUMENT TYPE
                  </Text>
                  <Text style={styles.selectedSummaryTitle}>
                    {selectedDocumentType.item.title}
                  </Text>
                  <Text style={styles.selectedSummaryDescription}>
                    {selectedDocumentType.item.description}
                  </Text>
                </View>
              </View>

              <View style={styles.metadataRow}>
                <View style={styles.metadataItem}>
                  <Text style={styles.metadataLabel}>GROUP</Text>
                  <Text style={styles.metadataValue}>
                    {GROUP_LABELS[selectedDocumentType.group]}
                  </Text>
                </View>
                <View style={styles.metadataItem}>
                  <Text style={styles.metadataLabel}>CATEGORY</Text>
                  <Text style={styles.metadataValue}>{values.category}</Text>
                </View>
              </View>
            </Card>
          )}

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Document Information</Text>
                <Text style={styles.sectionSubtitle}>
                  Review and update the document details.
                </Text>
              </View>
            </View>

            {/* Using type assertions (as any) here allows custom input props without editing global InputProps */}
            {React.createElement(Input as any, {
              label: "Document Title",
              placeholder: "Document title",
              value: values.title,
              onChangeText: (text: string) => updateValue("title", text),
              onBlur: () =>
                setTouched((current) => ({ ...current, title: true })),
              error: touched.title ? errors.title : undefined,
              maxLength: 120,
              accessibilityLabel: "Document title",
            })}

            <View style={styles.characterCounter}>
              <Text style={styles.characterCounterText}>
                {values.title.length}/120
              </Text>
            </View>

            {React.createElement(Input as any, {
              label: "Issuer / Organization",
              placeholder: "e.g. Department of Foreign Affairs",
              value: values.issuer,
              onChangeText: (text: string) => updateValue("issuer", text),
              onBlur: () =>
                setTouched((current) => ({ ...current, issuer: true })),
              error: touched.issuer ? errors.issuer : undefined,
              maxLength: 150,
              accessibilityLabel: "Issuer or organization",
            })}

            {selectedDocumentType?.item.defaultIssuer && (
              <View style={styles.defaultIssuerHint}>
                <Ionicons
                  name="sparkles-outline"
                  size={15}
                  color={COLORS.primary}
                />
                <Text style={styles.defaultIssuerText}>
                  Suggested issuer: {selectedDocumentType.item.defaultIssuer}
                </Text>
              </View>
            )}

            {React.createElement(Input as any, {
              label: "Document Number",
              placeholder: "Enter document number",
              value: values.documentNumber,
              onChangeText: (text: string) =>
                updateValue("documentNumber", text.toUpperCase()),
              onBlur: () =>
                setTouched((current) => ({ ...current, documentNumber: true })),
              error: touched.documentNumber ? errors.documentNumber : undefined,
              autoCapitalize: "characters",
              maxLength: 100,
              accessibilityLabel: "Document number",
            })}

            <Text style={styles.inputHint}>
              Document numbers are automatically converted to uppercase.
            </Text>
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Important Dates</Text>
                <Text style={styles.sectionSubtitle}>
                  Use YYYY-MM-DD format.
                </Text>
              </View>
            </View>

            {React.createElement(Input as any, {
              label: "Issue Date",
              placeholder: "YYYY-MM-DD",
              value: values.issueDate,
              onChangeText: (text: string) =>
                updateValue(
                  "issueDate",
                  text.replace(/[^0-9-]/g, "").slice(0, 10),
                ),
              onBlur: () =>
                setTouched((current) => ({ ...current, issueDate: true })),
              error: touched.issueDate ? errors.issueDate : undefined,
              keyboardType: "numbers-and-punctuation",
              maxLength: 10,
              accessibilityLabel: "Issue date",
            })}

            {React.createElement(Input as any, {
              label: "Expiry Date",
              placeholder: "YYYY-MM-DD",
              value: values.expiryDate,
              onChangeText: (text: string) =>
                updateValue(
                  "expiryDate",
                  text.replace(/[^0-9-]/g, "").slice(0, 10),
                ),
              onBlur: () =>
                setTouched((current) => ({ ...current, expiryDate: true })),
              error: touched.expiryDate ? errors.expiryDate : undefined,
              keyboardType: "numbers-and-punctuation",
              maxLength: 10,
              accessibilityLabel: "Expiry date",
            })}

            <View
              style={[
                styles.expiryPreview,
                daysUntilExpiry !== null &&
                  daysUntilExpiry < 0 &&
                  styles.expiryPreviewExpired,
                daysUntilExpiry !== null &&
                  daysUntilExpiry >= 0 &&
                  daysUntilExpiry <= 30 &&
                  styles.expiryPreviewWarning,
              ]}
            >
              <Ionicons
                name={
                  daysUntilExpiry !== null && daysUntilExpiry < 0
                    ? "alert-circle-outline"
                    : daysUntilExpiry !== null && daysUntilExpiry <= 30
                      ? "warning-outline"
                      : "checkmark-circle-outline"
                }
                size={20}
                color={
                  daysUntilExpiry !== null && daysUntilExpiry < 0
                    ? COLORS.danger
                    : daysUntilExpiry !== null && daysUntilExpiry <= 30
                      ? "#B7791F"
                      : COLORS.primary
                }
              />
              <View style={styles.expiryPreviewContent}>
                <Text style={styles.expiryPreviewTitle}>Expiration Status</Text>
                <Text style={styles.expiryPreviewMessage}>
                  {getExpiryMessage(values.expiryDate)}
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons
                  name="notifications-outline"
                  size={21}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>Expiration Alerts</Text>
                <Text style={styles.settingDescription}>
                  Receive reminders before this document expires.
                </Text>
              </View>
              <Switch
                value={values.enableAlerts}
                onValueChange={(value) => updateValue("enableAlerts", value)}
                trackColor={{
                  false: COLORS.border,
                  true: COLORS.primary,
                }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Enable expiration alerts"
              />
            </View>
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="document-text-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Notes</Text>
                <Text style={styles.sectionSubtitle}>
                  Add optional information about this document.
                </Text>
              </View>
            </View>

            <TextInput
              value={values.notes}
              onChangeText={(text) => updateValue("notes", text)}
              onBlur={() =>
                setTouched((current) => ({ ...current, notes: true }))
              }
              placeholder="Add additional notes..."
              placeholderTextColor={COLORS.textSecondary}
              multiline
              numberOfLines={5}
              maxLength={1000}
              textAlignVertical="top"
              style={styles.notesInput}
              accessibilityLabel="Document notes"
            />

            <View style={styles.characterCounter}>
              <Text style={styles.characterCounterText}>
                {values.notes.length}/1000
              </Text>
            </View>
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Document Status</Text>
                <Text style={styles.sectionSubtitle}>
                  System information for this document.
                </Text>
              </View>
            </View>

            <View style={styles.statusGrid}>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>STATUS</Text>
                <Text style={styles.statusValue}>{values.status}</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>PROCESSING</Text>
                <Text style={styles.statusValue}>
                  {values.processingStatus}
                </Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.statusLabel}>RISK</Text>
                <Text style={styles.statusValue}>{values.riskLevel}</Text>
              </View>
            </View>
          </Card>

          <View style={styles.saveSection}>
            {React.createElement(Button as any, {
              title: isSaving ? "Saving Changes..." : "Save Changes",
              onPress: handleSave,
              loading: isSaving,
              disabled: isSaving || !hasChanges,
            })}

            {!hasChanges && (
              <View style={styles.noChangesMessage}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={17}
                  color={COLORS.textSecondary}
                />
                <Text style={styles.noChangesText}>No changes to save</Text>
              </View>
            )}

            {hasChanges && (
              <Text style={styles.saveHint}>
                Review your changes before saving.
              </Text>
            )}
          </View>

          <View style={styles.dataSourceContainer}>
            <Ionicons
              name={useLocalData ? "phone-portrait-outline" : "cloud-outline"}
              size={16}
              color={COLORS.textSecondary}
            />
            <Text style={styles.dataSourceText}>
              {useLocalData
                ? "Editing local document data"
                : "Editing cloud document data"}
            </Text>
          </View>

          <View style={styles.bottomSpacing} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardContainer: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, color: COLORS.textSecondary },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  errorIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    marginBottom: 18,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 8,
  },
  errorMessage: {
    maxWidth: 340,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  errorActions: { width: "100%", maxWidth: 320, marginTop: 24, gap: 12 },
  secondaryButton: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  unsavedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  unsavedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#D97706",
  },
  unsavedText: { fontSize: 11, fontWeight: "600", color: "#D97706" },
  resetButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  resetButtonDisabled: { opacity: 0.45 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    marginRight: 11,
  },
  sectionHeaderText: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 9,
  },
  required: { color: COLORS.danger },
  groupList: { gap: 8, paddingBottom: 5 },
  groupChip: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  groupChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  groupChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  groupChipTextActive: { color: "#FFFFFF" },
  searchContainer: {
    height: 46,
    marginTop: 15,
    marginBottom: 17,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    height: "100%",
    marginHorizontal: 8,
    fontSize: 14,
    color: COLORS.text,
  },
  documentTypeList: { gap: 9 },
  documentTypeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#FFFFFF",
  },
  documentTypeCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(37, 99, 235, 0.05)",
  },
  documentTypeIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    marginRight: 11,
  },
  documentTypeIconActive: { backgroundColor: COLORS.primary },
  documentTypeContent: { flex: 1, marginRight: 8 },
  documentTypeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 3,
  },
  documentTypeTitleActive: { color: COLORS.primary },
  documentTypeDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  emptyTypes: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  emptyTypesText: { fontSize: 13, color: COLORS.textSecondary, marginTop: 8 },
  showMoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 13,
  },
  showMoreText: { fontSize: 13, fontWeight: "600", color: COLORS.primary },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.danger,
    marginTop: 7,
  },
  selectedSummary: { flexDirection: "row", alignItems: "flex-start" },
  selectedSummaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    marginRight: 12,
  },
  selectedSummaryContent: { flex: 1 },
  selectedSummaryLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    color: COLORS.textSecondary,
    marginBottom: 3,
  },
  selectedSummaryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 3,
  },
  selectedSummaryDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textSecondary,
  },
  metadataRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 15,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  metadataItem: { flex: 1 },
  metadataLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    color: COLORS.textSecondary,
    marginBottom: 3,
  },
  metadataValue: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.text,
    textTransform: "capitalize",
  },
  characterCounter: {
    alignItems: "flex-end",
    marginTop: -10,
    marginBottom: 12,
  },
  characterCounterText: { fontSize: 10, color: COLORS.textSecondary },
  defaultIssuerHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: -5,
    marginBottom: 13,
  },
  defaultIssuerText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textSecondary,
  },
  inputHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: -7,
    marginBottom: 11,
  },
  expiryPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 11,
    backgroundColor: "rgba(37, 99, 235, 0.06)",
    marginTop: 3,
  },
  expiryPreviewWarning: { backgroundColor: "rgba(217, 119, 6, 0.08)" },
  expiryPreviewExpired: { backgroundColor: "rgba(220, 38, 38, 0.08)" },
  expiryPreviewContent: { flex: 1, marginLeft: 9 },
  expiryPreviewTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 2,
  },
  expiryPreviewMessage: { fontSize: 12, color: COLORS.textSecondary },
  settingRow: { flexDirection: "row", alignItems: "center" },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    marginRight: 11,
  },
  settingContent: { flex: 1, marginRight: 10 },
  settingTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  settingDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  notesInput: {
    minHeight: 125,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },
  statusGrid: { flexDirection: "row", gap: 8 },
  statusItem: {
    flex: 1,
    padding: 10,
    borderRadius: 9,
    backgroundColor: "rgba(0, 0, 0, 0.025)",
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.text,
    textTransform: "capitalize",
  },
  saveSection: { marginTop: 5 },
  noChangesMessage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 10,
  },
  noChangesText: { fontSize: 12, color: COLORS.textSecondary },
  saveHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 9,
  },
  dataSourceContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 18,
  },
  dataSourceText: { fontSize: 11, color: COLORS.textSecondary },
  bottomSpacing: { height: 20 },
});
