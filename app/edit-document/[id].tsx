import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  DeviceEventEmitter,
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
import * as DocumentPicker from "expo-document-picker";

import { DOCUMENTS_BY_CATEGORY } from "../../constants/documentTypes";
import { recordAuditLog } from "@/services/auditService";
import { Card, Input, Button, TagsInput, DocumentScanner as DocumentScannerComponent } from "@/components/ui";
import { useColors } from "@/context/ThemeContext";
import {
  getDocumentById,
  updateDocument,
  markDocumentSyncedWithCloud,
} from "@/services/localDatabase";
import { api, API_BASE_URL } from "@/services/api";
import { documentUpdateSchema, validateSchema } from "@/shared/validation";
import { canonicalizeServerRevision } from "@/shared/sync/syncPolicy";
import {
  buildUploadFileName,
  needsStorageUpload,
  validateUploadFile,
} from "@/shared/sync/documentFileUpload";
import {
  scheduleRemindersForDocument,
  cancelDocumentNotifications,
} from "@/services/notificationScheduler";
import { LocalDocument } from "@/types/offline";
import {
  feedbackService,
  useFeedbackService,
} from "@/services/feedbackService";

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
  expiryDate: string | null;
  notes: string;
  tags: string[];
  enableAlerts: boolean;
  status: string;
  processingStatus: string;
  riskScore: number | null;
  riskLevel: string | null;
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

function getDaysUntilExpiry(expiryDate: string | null): number | null {
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

  for (const [group, items] of Object.entries(DOCUMENTS_BY_CATEGORY) as [
    DocumentGroup,
    SpecificDocumentItem[],
  ][]) {
    const item = items.find((document) => document.id === id);

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

  for (const [group, items] of Object.entries(DOCUMENTS_BY_CATEGORY) as [
    DocumentGroup,
    SpecificDocumentItem[],
  ][]) {
    const item = items.find(
      (document) => document.title.trim().toLowerCase() === normalized,
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
  useFeedbackService();

  const documentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [noExpirationDate, setNoExpirationDate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [useLocalData, setUseLocalData] = useState(false);
  const [cloudId, setCloudId] = useState<number | null>(null);
  /**
   * The server revision of the document when this device last saw it.
   */
  const [serverRevision, setServerRevision] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DocumentGroup>("other");
  const [typeSearch, setTypeSearch] = useState("");
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [replacementFile, setReplacementFile] = useState<{
    uri: string;
    name: string;
    size?: number;
    mimeType?: string;
  } | null>(null);

  // Synchronous guard against rapid repeated save taps.
  const saveInProgress = useRef(false);

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
      expiryDate: null,
      notes: "",
      tags: [],
      enableAlerts: true,
      status: "active",
      processingStatus: "completed",
      riskScore: null,
      riskLevel: null,
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
        (item) =>
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
    () => JSON.stringify(values) !== JSON.stringify(initialData) || replacementFile != null,
    [values, initialData, replacementFile],
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

  const uploadReplacementFile = useCallback(
    async (file: { uri: string; name: string; size?: number; mimeType?: string }) => {
      const mimeType = file.mimeType || "application/octet-stream";
      const invalid = validateUploadFile({ fileType: mimeType, size: file.size });
      if (invalid) {
        throw new Error(invalid);
      }

      if (!needsStorageUpload({ s3Key: null, fileUrl: null })) {
        return { s3Key: null as string | null, fileUrl: file.uri, fileType: mimeType };
      }

      const uploadData = await api.documents.getUploadUrl(buildUploadFileName(file), mimeType);
      if (!uploadData?.uploadUrl) {
        throw new Error("The server did not return an upload URL for the file.");
      }

      await api.documents.uploadToS3(uploadData.uploadUrl, file.uri, mimeType);
      const s3Key = String(uploadData.storagePath || (uploadData as any).s3Key || "").trim();
      if (!s3Key) {
        throw new Error("The file was uploaded, but the server did not return a storage key.");
      }

      return { s3Key, fileUrl: file.uri, fileType: mimeType };
    },
    [],
  );

  const handlePickReplacementFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setReplacementFile({
        uri: asset.uri,
        name: asset.name || "replacement-file",
        size: asset.size,
        mimeType: asset.mimeType || undefined,
      });
    } catch (error) {
      console.error("Replacement file pick failed:", error);
      await feedbackService.alert({
        title: "File Selection Failed",
        message: "Could not select the replacement file.",
        type: "error",
      });
    }
  }, []);

  const handleScanReplacement = useCallback(() => {
    setScannerVisible(true);
  }, []);

  const handleReplacementScanSuccess = useCallback((data: any) => {
    const uri = data?.images?.[0]?.uri;
    if (!uri) return;
    setReplacementFile({
      uri,
      name: `scan-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
    });
    setScannerVisible(false);
  }, []);

  const fetchDocumentData = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    console.log("=== [EditDocument: FETCH START] ===");
    console.log("Target Document ID Param:", documentId);

    try {
      if (!documentId) {
        throw new Error("Document ID is missing.");
      }

      const numericId = Number(documentId);

      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new Error("Invalid document ID.");
      }

      const localDocument = await getDocumentById(numericId);
      console.log(
        "Local Database Document Lookup Result:",
        JSON.stringify(localDocument, null, 2),
      );

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
          tags: localDocument.tags || [],
          enableAlerts: localDocument.enableAlerts !== false,
          status: localDocument.status || "active",
          processingStatus: localDocument.processingStatus || "completed",
          riskScore: localDocument.riskScore ?? null,
          riskLevel: localDocument.riskLevel ?? null,
          fileUrl: localDocument.fileUrl || null,
          fileType: localDocument.fileType || null,
          s3Key: localDocument.s3Key || null,
        };

        setValues(loadedValues);
        setInitialData(loadedValues);
        setNoExpirationDate(!loadedValues.expiryDate);
        setSelectedGroup(group);
        setUseLocalData(true);
        setCloudId(
          typeof localDocument.cloudId === "number"
            ? localDocument.cloudId
            : null,
        );
        setServerRevision(localDocument.serverUpdatedAt ?? null);
        console.log("=== [EditDocument: FETCH SUCCESS (LOCAL)] ===");
        return;
      }

      const token = await SecureStore.getItemAsync("userToken");

      if (!token) {
        throw new Error("You are not authenticated.");
      }

      console.log(
        `Fetching from cloud API endpoint: ${API_BASE_URL}/documents/${numericId}`,
      );
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
      console.log(
        "Cloud Document Payload Received:",
        JSON.stringify(data, null, 2),
      );

      setCloudId(typeof data?.id === "number" ? data.id : null);
      setServerRevision(data?.updatedAt ?? null);

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
        tags: Array.isArray(data?.tags) ? data.tags : [],
        enableAlerts: data?.enableAlerts !== false,
        status: data?.status || "active",
        processingStatus: data?.processingStatus || "completed",
        riskScore: data?.riskScore != null ? Number(data.riskScore) : null,
        riskLevel: data?.riskLevel ?? null,
        fileUrl: data?.fileUrl || null,
        fileType: data?.fileType || null,
        s3Key: data?.s3Key || null,
      };

      setValues(loadedValues);
      setInitialData(loadedValues);
      setNoExpirationDate(!loadedValues.expiryDate);
      setSelectedGroup(group);
      setUseLocalData(false);
      console.log("=== [EditDocument: FETCH SUCCESS (CLOUD)] ===");
    } catch (error: unknown) {
      console.error("=== [EditDocument: FETCH ERROR] ===", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load document details.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void fetchDocumentData();
  }, [fetchDocumentData]);

  const validateForm = useCallback(() => {
    const nextErrors: Partial<Record<keyof EditDocumentValues, string>> = {};

    const changed = <K extends keyof EditDocumentValues>(field: K) =>
      values[field] !== initialData[field];

    if (changed("title") && !values.title.trim()) {
      nextErrors.title = "Document title cannot be empty.";
    }

    if (changed("issuer") && !values.issuer.trim()) {
      nextErrors.issuer = "Issuer cannot be empty.";
    }

    if (changed("documentNumber") && !values.documentNumber.trim()) {
      nextErrors.documentNumber = "Document number cannot be empty.";
    }

    if (changed("issueDate")) {
      if (!values.issueDate || !isValidDate(values.issueDate)) {
        nextErrors.issueDate = "Enter a valid issue date using YYYY-MM-DD.";
      }
    }

    const expiryDate = values.expiryDate;
    if (changed("expiryDate") && expiryDate && expiryDate.trim()) {
      if (!isValidDate(expiryDate)) {
        nextErrors.expiryDate = "Enter a valid expiry date using YYYY-MM-DD.";
      }
    }

    const issueDateValid = !!values.issueDate && isValidDate(values.issueDate);
    const expiryDateValid = !!expiryDate && isValidDate(expiryDate);

    if (
      issueDateValid &&
      expiryDateValid &&
      expiryDate &&
      values.issueDate > expiryDate &&
      (changed("issueDate") || changed("expiryDate"))
    ) {
      nextErrors.expiryDate = "Expiry date cannot be earlier than issue date.";
    }

    if (values.notes.length > 1000) {
      nextErrors.notes = "Notes cannot exceed 1000 characters.";
    }

    const numericId = Number(documentId);

    if (Number.isInteger(numericId) && numericId > 0) {
      const schemaPayload: Record<string, unknown> = {
        id: numericId,
      };

      if (changed("title")) {
        schemaPayload.title = values.title.trim();
      }

      if (changed("category")) {
        schemaPayload.category = values.category;
      }

      if (changed("issuer")) {
        schemaPayload.issuer = values.issuer.trim();
      }

      if (changed("documentNumber")) {
        schemaPayload.documentNumber = values.documentNumber
          .trim()
          .toUpperCase();
      }

      if (changed("issueDate")) {
        schemaPayload.issueDate = values.issueDate;
      }

      if (
        changed("expiryDate") &&
        values.expiryDate &&
        values.expiryDate.trim()
      ) {
        schemaPayload.expiryDate = values.expiryDate;
      }

      if (changed("notes")) {
        schemaPayload.notes = values.notes.trim();
      }

      if (changed("enableAlerts")) {
        schemaPayload.enableAlerts = values.enableAlerts;
      }

      try {
        const result = validateSchema(documentUpdateSchema, schemaPayload);

        if (!result.success && result.errors) {
          Object.assign(nextErrors, result.errors);
        }
      } catch (error) {
        console.warn("Document validation failed:", error);
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
  }, [documentId, values, initialData]);

  const handleSave = useCallback(async () => {
    if (saveInProgress.current || isSaving) {
      console.log(
        "=== [EditDocument: SAVE BLOCKED] Save already in progress ===",
      );
      return;
    }

    console.log("=== [EditDocument: SAVE INITIATED] ===");

    if (!validateForm()) {
      console.log(
        "=== [EditDocument: SAVE VALIDATION FAILED] ===",
        JSON.stringify(errors),
      );
      await feedbackService.alert({
        title: "Check Your Information",
        message: "Please correct the highlighted fields before saving.",
        type: "warning",
      });
      return;
    }

    const numericId = Number(documentId);

    if (!Number.isInteger(numericId) || numericId <= 0) {
      console.error(
        "=== [EditDocument: SAVE ERROR] Invalid numeric ID:",
        documentId,
      );
      await feedbackService.alert({
        title: "Error",
        message: "Invalid document ID.",
        type: "error",
      });
      return;
    }

    type UpdatePayload = Partial<LocalDocument> & { baseUpdatedAt?: string };

    const payload: UpdatePayload = {};

    if (values.title !== initialData.title) {
      payload.title = values.title.trim();
    }

    if (values.category !== initialData.category) {
      payload.category = values.category;
    }

    if (values.issuer !== initialData.issuer) {
      payload.issuer = values.issuer.trim();
    }

    if (values.documentNumber !== initialData.documentNumber) {
      payload.documentNumber = values.documentNumber.trim().toUpperCase();
    }

    if (values.issueDate !== initialData.issueDate) {
      payload.issueDate = values.issueDate;
    }

    if (values.expiryDate !== initialData.expiryDate) {
      payload.expiryDate = values.expiryDate === "" ? null : values.expiryDate;
    }

    if (values.notes !== initialData.notes) {
      payload.notes = values.notes.trim();
    }

    if (JSON.stringify(values.tags) !== JSON.stringify(initialData.tags)) {
      payload.tags = values.tags;
    }

    if (values.enableAlerts !== initialData.enableAlerts) {
      payload.enableAlerts = values.enableAlerts;
    }

    if (replacementFile) {
      try {
        const uploaded = await uploadReplacementFile(replacementFile);
        payload.fileUrl = uploaded.fileUrl;
        payload.fileType = uploaded.fileType ?? values.fileType ?? undefined;
        payload.s3Key = uploaded.s3Key ?? undefined;
        payload.processingStatus = "completed";
      } catch (error) {
        console.error("Replacement file upload failed:", error);
        await feedbackService.alert({
          title: "File Replace Failed",
          message:
            error instanceof Error
              ? error.message
              : "Could not upload the replacement file.",
          type: "error",
        });
        return;
      }
    }

    const baseRevision = canonicalizeServerRevision(serverRevision);

    if (baseRevision) {
      (payload as { baseUpdatedAt?: string }).baseUpdatedAt = baseRevision;
    }

    console.log(
      "Constructed Update Payload:",
      JSON.stringify(payload, null, 2),
    );

    if (Object.keys(payload).length === 0) {
      console.log("=== [EditDocument: NO CHANGES DETECTED] ===");
      await feedbackService.alert({
        title: "No Changes",
        message: "There are no changes to save.",
        type: "info",
      });
      return;
    }

    saveInProgress.current = true;
    setIsSaving(true);

    let localSaveSuccessful = false;
    let cloudSaveSuccessful = false;

    try {
      console.log(`Executing local database update for ID: ${numericId}`);
      await updateDocument(numericId, payload);
      localSaveSuccessful = true;
      console.log("Local database update completed successfully.");

      // Record MODIFY audit log
      await recordAuditLog(values.documentNumber || String(numericId), "MODIFY", {
        message: `Updated "${values.title || "document"}"`,
      });

      if (cloudId !== null) {
        const token = await SecureStore.getItemAsync("userToken");

        if (!token) {
          throw new Error(
            "Changes were saved locally, but cloud synchronization could not start because you are not authenticated.",
          );
        }

        console.log(`Executing cloud API update for cloud ID: ${cloudId}`);
        const cloudResponse = await api.documents.update(cloudId, payload);
        console.log(
          "Cloud update response received:",
          JSON.stringify(cloudResponse, null, 2),
        );

        const writtenRevision = canonicalizeServerRevision(
          cloudResponse?.document?.updatedAt,
        );

        await markDocumentSyncedWithCloud(numericId, cloudId, writtenRevision);

        setServerRevision(writtenRevision);
        cloudSaveSuccessful = true;
        console.log("Cloud sync status marked successfully.");
      }

      const savedValues: EditDocumentValues = {
        ...values,
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.category !== undefined ? { category: payload.category } : {}),
        ...(payload.issuer !== undefined ? { issuer: payload.issuer } : {}),
        ...(payload.documentNumber !== undefined
          ? { documentNumber: payload.documentNumber }
          : {}),
        ...(payload.issueDate !== undefined ? { issueDate: payload.issueDate } : {}),
        ...(payload.expiryDate !== undefined
          ? { expiryDate: payload.expiryDate ?? null }
          : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
        ...(payload.enableAlerts !== undefined
          ? { enableAlerts: payload.enableAlerts }
          : {}),
        ...(payload.fileUrl !== undefined
          ? { fileUrl: payload.fileUrl ?? null }
          : {}),
        ...(payload.fileType !== undefined
          ? { fileType: payload.fileType ?? null }
          : {}),
        ...(payload.s3Key !== undefined ? { s3Key: payload.s3Key ?? null } : {}),
        ...(payload.processingStatus !== undefined
          ? { processingStatus: payload.processingStatus }
          : {}),
      };

      setValues(savedValues);
      setInitialData(savedValues);
      setNoExpirationDate(!savedValues.expiryDate);
      setReplacementFile(null);
      setErrors({});
      setTouched({});

      // ðŸ”” EMIT THE EVENT HERE SO HOMESCREEN REFRESHES STATS IN REAL TIME
      DeviceEventEmitter.emit("documentVaultChanged");

      console.log("=== [EditDocument: SAVE SUCCESSFUL] ===");

      if (cloudSaveSuccessful) {
        await feedbackService.confirm({
          title: "Changes Saved",
          message:
            "Your document was updated on this device and synchronized to your cloud vault.",
          confirmText: "OK",
          onConfirm: () => router.back(),
          onCancel: () => {},
        });
      } else if (localSaveSuccessful) {
        await feedbackService.confirm({
          title: "Saved Locally",
          message: "Your changes were saved on this device.",
          confirmText: "OK",
          onConfirm: () => router.back(),
          onCancel: () => {},
        });
      }
    } catch (error: unknown) {
      console.error("=== [EditDocument: SAVE ERROR CAUGHT] ===", error);

      const message =
        error instanceof Error
          ? error.message
          : "Please try again when you have an internet connection.";

      const status =
        (error as { response?: { status?: number } })?.response?.status ??
        undefined;

      if (status === 409) {
        await feedbackService.alert({
          title: "Changed on Another Device",
          message:
            "This document was changed somewhere else since you opened it, " +
            "so your change was not uploaded.\n\n" +
            "Your change is saved on this device. Open the document again to " +
            "see the version in your cloud vault and reapply your change if " +
            "you still want it.",
          type: "warning",
        });
      } else if (localSaveSuccessful) {
        await feedbackService.alert({
          title: "Saved Locally",
          message:
            "Your changes were saved on this device, but cloud synchronization failed.\n\n" +
            message,
          type: "warning",
        });
      } else {
        await feedbackService.alert({
          title: "Save Failed",
          message,
          type: "error",
        });
      }
    } finally {
      saveInProgress.current = false;
      setIsSaving(false);
      console.log("=== [EditDocument: SAVE FINALLY BLOCK] ===");
    }
  }, [
    cloudId,
    documentId,
    initialData,
    isSaving,
    replacementFile,
    router,
    serverRevision,
    uploadReplacementFile,
    useLocalData,
    validateForm,
    values,
    errors,
  ]);

  const handleReset = useCallback(async () => {
    if (!hasChanges) {
      return;
    }

    await feedbackService.confirm({
      title: "Reset Changes?",
      message: "All unsaved changes will be discarded.",
      confirmText: "Reset",
      cancelText: "Cancel",
      destructive: true,
      onConfirm: () => {
        setValues(initialData);
        setNoExpirationDate(!initialData.expiryDate);
        setSelectedGroup(initialData.documentGroup);
        setErrors({});
        setTouched({});
        setTypeSearch("");
        setShowAllTypes(false);
        setReplacementFile(null);
      },
      onCancel: () => {},
    });
  }, [hasChanges, initialData]);

  const handleBack = useCallback(async () => {
    if (!hasChanges) {
      router.back();
      return;
    }

    await feedbackService.confirm({
      title: "Unsaved Changes",
      message: "You have changes that have not been saved. Leave this page?",
      confirmText: "Discard",
      cancelText: "Stay",
      destructive: true,
      onConfirm: () => router.back(),
      onCancel: () => {},
    });
  }, [hasChanges, router]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
              color={colors.error}
            />
          </View>

          <Text style={styles.errorTitle}>Could not load document</Text>
          <Text style={styles.errorMessage}>{loadError}</Text>

          <View style={styles.errorActions}>
            <Button title="Try Again" onPress={fetchDocumentData} />

            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.secondaryButton}
              accessibilityRole="button"
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
            <Ionicons name="chevron-back" size={27} color={colors.primary} />
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
              color={hasChanges ? colors.primary : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {/* LOCKED DOCUMENT TYPE SECTION (VIEW ONLY) */}
          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="document-text-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>

              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Document Type</Text>
                <Text style={styles.sectionSubtitle}>
                  Document category and type cannot be changed.
                </Text>
              </View>
            </View>

            {selectedDocumentType ? (
              <View style={styles.selectedSummary}>
                <View style={styles.selectedSummaryIcon}>
                  <Ionicons
                    name={selectedDocumentType.item.icon}
                    size={25}
                    color={colors.primary}
                  />
                </View>

                <View style={styles.selectedSummaryContent}>
                  <Text style={styles.selectedSummaryLabel}>
                    ASSIGNED DOCUMENT TYPE
                  </Text>
                  <Text style={styles.selectedSummaryTitle}>
                    {selectedDocumentType.item.title}
                  </Text>
                  <Text style={styles.selectedSummaryDescription}>
                    {selectedDocumentType.item.description}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.emptyTypes}>
                <Text style={styles.emptyTypesText}>
                  {GROUP_LABELS[selectedGroup] || selectedGroup}
                </Text>
              </View>
            )}

            <View style={styles.metadataRow}>
              <View style={styles.metadataItem}>
                <Text style={styles.metadataLabel}>GROUP</Text>
                <Text style={styles.metadataValue}>
                  {GROUP_LABELS[selectedGroup] || selectedGroup}
                </Text>
              </View>

              <View style={styles.metadataItem}>
                <Text style={styles.metadataLabel}>CATEGORY</Text>
                <Text style={styles.metadataValue}>{values.category}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>

              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Document Information</Text>
                <Text style={styles.sectionSubtitle}>
                  Review and update the document details.
                </Text>
              </View>
            </View>

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
                  color={colors.primary}
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
                setTouched((current) => ({
                  ...current,
                  documentNumber: true,
                })),
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
                  color={colors.primary}
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
                setTouched((current) => ({
                  ...current,
                  issueDate: true,
                })),
              error: touched.issueDate ? errors.issueDate : undefined,
              keyboardType: "numbers-and-punctuation",
              maxLength: 10,
              accessibilityLabel: "Issue date",
            })}

            <View style={styles.noExpiryContainer}>
              <TouchableOpacity
                style={[
                  styles.noExpiryOption,
                  noExpirationDate && styles.noExpiryOptionActive,
                ]}
                onPress={() => {
                  const nextValue = !noExpirationDate;

                  setNoExpirationDate(nextValue);

                  if (nextValue) {
                    updateValue("expiryDate", "");
                  } else {
                    setErrors((current) => {
                      const next = { ...current };
                      delete next.expiryDate;
                      return next;
                    });
                  }
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: noExpirationDate }}
                accessibilityLabel="No expiration date"
              >
                <Ionicons
                  name={
                    noExpirationDate ? "checkmark-circle" : "ellipse-outline"
                  }
                  size={21}
                  color={
                    noExpirationDate ? colors.primary : colors.textSecondary
                  }
                />

                <View style={styles.noExpiryTextContainer}>
                  <Text style={styles.noExpiryTitle}>No expiration date</Text>
                  <Text style={styles.noExpiryDescription}>
                    This document does not expire.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {!noExpirationDate && (
              <View>
                {React.createElement(Input as any, {
                  label: "Expiry Date (Optional)",
                  placeholder: "YYYY-MM-DD",
                  value: values.expiryDate,
                  onChangeText: (text: string) => {
                    updateValue(
                      "expiryDate",
                      text.replace(/[^0-9-]/g, "").slice(0, 10),
                    );
                  },
                  onBlur: () =>
                    setTouched((current) => ({
                      ...current,
                      expiryDate: true,
                    })),
                  error: touched.expiryDate ? errors.expiryDate : undefined,
                  keyboardType: "numbers-and-punctuation",
                  maxLength: 10,
                  accessibilityLabel: "Optional expiry date",
                })}
              </View>
            )}

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
                    ? colors.error
                    : daysUntilExpiry !== null && daysUntilExpiry <= 30
                      ? colors.warning
                      : colors.primary
                }
              />

              <View style={styles.expiryPreviewContent}>
                <Text style={styles.expiryPreviewTitle}>Expiration Status</Text>
                <Text style={styles.expiryPreviewMessage}>
                  {getExpiryMessage(values.expiryDate || "")}
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
                  color={colors.primary}
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
                  false: colors.border,
                  true: colors.primary,
                }}
                thumbColor={colors.switchThumb}
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
                  color={colors.primary}
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
                setTouched((current) => ({
                  ...current,
                  notes: true,
                }))
              }
              placeholder="Add additional notes..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={5}
              maxLength={1000}
              textAlignVertical="top"
              style={styles.notesInput}
              accessibilityLabel="Document notes"
            />

            {touched.notes && errors.notes && (
              <Text style={styles.errorText}>{errors.notes}</Text>
            )}

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
                  name="pricetags-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>

              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Tags</Text>
                <Text style={styles.sectionSubtitle}>
                  Add tags to organize and filter this document.
                </Text>
              </View>
            </View>

            <TagsInput
              initialTags={values.tags}
              onTagsChange={(tags) => updateValue("tags", tags)}
              placeholder="Add tags (press enter or comma)"
            />
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="document-attach-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>
            </View>

            <Text style={styles.fileMetaText}>
              Current: {values.fileType || "Unknown type"}
              {values.s3Key ? " • Cloud file linked" : values.fileUrl ? " • Local file available" : " • No file attached"}
            </Text>

            {replacementFile ? (
              <View style={styles.replacementBox}>
                <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
                <Text style={styles.replacementText} numberOfLines={1}>
                  Replacement: {replacementFile.name}
                </Text>
                <TouchableOpacity onPress={() => setReplacementFile(null)} accessibilityRole="button" accessibilityLabel="Remove replacement file">
                  <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.fileActionsRow}>
              <TouchableOpacity
                style={styles.fileActionButton}
                onPress={handlePickReplacementFile}
                accessibilityRole="button"
              >
                <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
                <Text style={styles.fileActionText}>Pick File</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.fileActionButton}
                onPress={handleScanReplacement}
                accessibilityRole="button"
              >
                <Ionicons name="scan-outline" size={18} color={colors.primary} />
                <Text style={styles.fileActionText}>Scan</Text>
              </TouchableOpacity>
            </View>
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={colors.primary}
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
                <Text style={styles.statusValue}>
                  {values.riskLevel ?? "Not assessed"}
                </Text>
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
                  color={colors.textSecondary}
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
              color={colors.textSecondary}
            />

            <Text style={styles.dataSourceText}>
              {useLocalData
                ? "Editing local document data"
                : "Editing cloud document data"}
            </Text>
          </View>

          <View style={styles.bottomSpacing} />
        </ScrollView>

        {scannerVisible && (
          <DocumentScannerComponent
            visible={scannerVisible}
            onScanSuccess={handleReplacementScanSuccess}
            onClose={() => setScannerVisible(false)}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
========================================================= */

const createStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  keyboardContainer: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, color: colors.textSecondary },

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
    color: colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  errorMessage: {
    maxWidth: 340,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: "center",
  },
  errorActions: {
    width: "100%",
    maxWidth: 320,
    marginTop: 24,
    gap: 12,
  },
  secondaryButton: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },

  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
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
    backgroundColor: colors.warning,
  },
  unsavedText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.warning,
  },
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 9,
  },
  required: { color: colors.error },

  groupList: { gap: 8, paddingBottom: 5 },
  groupChip: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  groupChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  groupChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  groupChipTextActive: { color: colors.buttonPrimaryText },

  searchContainer: {
    height: 46,
    marginTop: 15,
    marginBottom: 17,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    height: "100%",
    marginHorizontal: 8,
    fontSize: 14,
    color: colors.text,
  },

  documentTypeList: { gap: 9 },
  documentTypeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  documentTypeCardActive: {
    borderColor: colors.primary,
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
  documentTypeIconActive: { backgroundColor: colors.primary },
  documentTypeContent: { flex: 1, marginRight: 8 },
  documentTypeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 3,
  },
  documentTypeTitleActive: { color: colors.primary },
  documentTypeDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  emptyTypes: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  emptyTypesText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
  },
  showMoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 13,
  },
  showMoreText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.error,
    marginTop: 7,
  },

  selectedSummary: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
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
    color: colors.textSecondary,
    marginBottom: 3,
  },
  selectedSummaryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 3,
  },
  selectedSummaryDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  metadataRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 15,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metadataItem: { flex: 1 },
  metadataLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    color: colors.textSecondary,
    marginBottom: 3,
  },
  metadataValue: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    textTransform: "capitalize",
  },

  characterCounter: {
    alignItems: "flex-end",
    marginTop: -10,
    marginBottom: 12,
  },
  characterCounterText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
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
    color: colors.textSecondary,
  },
  inputHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: -7,
    marginBottom: 11,
  },

  noExpiryContainer: {
    marginBottom: 14,
  },
  noExpiryOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    backgroundColor: colors.surface,
  },
  noExpiryOptionActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(37, 99, 235, 0.06)",
  },
  noExpiryTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  noExpiryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  noExpiryDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 3,
  },

  expiryPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 11,
    backgroundColor: "rgba(37, 99, 235, 0.06)",
    marginTop: 3,
  },
  expiryPreviewWarning: {
    backgroundColor: "rgba(217, 119, 6, 0.08)",
  },
  expiryPreviewExpired: {
    backgroundColor: "rgba(220, 38, 38, 0.08)",
  },
  expiryPreviewContent: { flex: 1, marginLeft: 9 },
  expiryPreviewTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 2,
  },
  expiryPreviewMessage: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    marginRight: 11,
  },
  settingContent: {
    flex: 1,
    marginRight: 10,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  settingDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },

  fileMetaText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  replacementBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(37, 99, 235, 0.06)",
    marginBottom: 10,
  },
  replacementText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  fileActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  fileActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fileActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },

  notesInput: {
    minHeight: 125,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },

  statusGrid: {
    flexDirection: "row",
    gap: 8,
  },
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
    color: colors.textSecondary,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
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
  noChangesText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  saveHint: {
    fontSize: 11,
    color: colors.textSecondary,
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
  dataSourceText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  bottomSpacing: { height: 20 },
});
