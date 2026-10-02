import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Image,
  ActivityIndicator,
  Modal,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import * as DocumentPicker from "expo-document-picker";

import { COLORS } from "@/constants";
import { DocumentScannerComponent } from "@/components/ui/DocumentScanner";
import { extractDocumentData } from "../utils/ocr";
import {
  createDocument,
  logDocumentAction,
  LocalDocument,
} from "../services/localDatabase";
import { formatCategoryForBackend } from "@/utils/categories";
import { scheduleRemindersForDocument } from "@/services/notificationScheduler";

// Import categories and specific document data from your constants file
import {
  CategoryItem,
  SpecificDocumentItem,
  LEGAL_CATEGORIES,
  NON_LEGAL_CATEGORIES,
  DOCUMENTS_BY_CATEGORY,
} from "@/constants/documentTypes";

const MAX_TITLE_LENGTH = 100;
const MAX_ISSUER_LENGTH = 150;
const MAX_DOCUMENT_NUMBER_LENGTH = 50;
const MAX_NOTES_LENGTH = 1000;

const STEPS = ["Type", "Category", "Document", "Scan", "Review"] as const;

interface ExtractedData {
  title: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  category: string;
  /** OCR field completeness. Not a risk or authenticity verdict. */
  confidence: number;
}

interface SelectedFileItem {
  name: string;
  uri: string;
  size: number;
  mimeType?: string;
}

function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync("userToken");
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").slice(0, maxLength);
}

function sanitizeDocumentNumber(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, "")
    .slice(0, MAX_DOCUMENT_NUMBER_LENGTH);
}

function getFileTypeLabel(mimeType?: string): string {
  if (!mimeType) return "FILE";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) {
    return mimeType.split("/")[1]?.toUpperCase() || "IMAGE";
  }
  return "FILE";
}

function normalizeExtractedData(extracted: any): ExtractedData {
  const confidence = Number.isFinite(extracted?.confidence)
    ? Math.max(0, Math.min(100, Math.round(extracted.confidence)))
    : 0;

  return {
    title: sanitizeText(extracted?.title || "", MAX_TITLE_LENGTH),
    issuer: sanitizeText(extracted?.issuer || "", MAX_ISSUER_LENGTH),
    documentNumber: sanitizeDocumentNumber(extracted?.documentNumber || ""),
    issueDate: extracted?.issueDate || "",
    expiryDate: extracted?.expiryDate || "",
    category: extracted?.category || "other",
    confidence,
  };
}

interface FieldProps {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  keyboardType?:
    | "default"
    | "number-pad"
    | "decimal-pad"
    | "numeric"
    | "email-address"
    | "phone-pad";
}

function Field({
  label,
  value,
  placeholder,
  required = false,
  onChangeText,
  multiline = false,
  keyboardType = "default",
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="sentences"
        autoCorrect={false}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline ? styles.multilineInput : null]}
      />
    </View>
  );
}

function StepHeader({ step }: { step: number }) {
  return (
    <View style={styles.stepHeader}>
      <Text style={styles.stepLabel}>
        STEP {step + 1} OF {STEPS.length}
      </Text>
      <Text style={styles.stepTitle}>{STEPS[step]}</Text>
      <View style={styles.progressRow}>
        {STEPS.map((item, index) => (
          <View
            key={item}
            style={[
              styles.progressSegment,
              index <= step ? styles.progressSegmentActive : null,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function AddDocumentScreen() {
  const router = useRouter();

  const [step, setStep] = useState<number>(0);

  const [documentType, setDocumentType] = useState<
    "legal" | "non-legal" | null
  >(null);
  const [category, setCategory] = useState<CategoryItem | null>(null);
  const [specificDocument, setSpecificDocument] =
    useState<SpecificDocumentItem | null>(null);

  const [title, setTitle] = useState<string>("");
  const [documentNumber, setDocumentNumber] = useState<string>("");
  const [issuer, setIssuer] = useState<string>("");
  const [issueDate, setIssueDate] = useState<string>("");
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [reminderIntervals, setReminderIntervals] = useState<number[]>([30]);
  const [enableAlerts, setEnableAlerts] = useState<boolean>(true);

  const [selectedFile, setSelectedFile] = useState<SelectedFileItem | null>(
    null,
  );
  const [scannerVisible, setScannerVisible] = useState<boolean>(false);

  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(
    null,
  );
  const [ocrUploadMeta, setOcrUploadMeta] = useState<{
    fileUrl?: string;
    s3Key?: string;
    storagePath?: string;
    documentId?: string | number;
  } | null>(null);
  const [datePicker, setDatePicker] = useState<
    "issueDate" | "expiryDate" | null
  >(null);
  const [saving, setSaving] = useState<boolean>(false);

  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: "success" | "warning" | "error";
  }>({
    visible: false,
    message: "",
    type: "success",
  });

  const categories = useMemo(() => {
    if (documentType === "legal") return LEGAL_CATEGORIES;
    if (documentType === "non-legal") return NON_LEGAL_CATEGORIES;
    return [];
  }, [documentType]);

  const specificDocuments = useMemo(() => {
    if (!category) return [];
    return DOCUMENTS_BY_CATEGORY[category.id] || [];
  }, [category]);

  useEffect(() => {
    if (specificDocument) {
      if (!title) setTitle(specificDocument.title);
      if (specificDocument.defaultIssuer && !issuer) {
        setIssuer(specificDocument.defaultIssuer);
      }
    }
  }, [specificDocument]);

  function showToast(
    message: string,
    type: "success" | "warning" | "error" = "success",
  ) {
    setToast({ visible: true, message, type });
  }

  function selectDocumentType(type: "legal" | "non-legal") {
    setDocumentType(type);
    setCategory(null);
    setSpecificDocument(null);
    setTimeout(() => setStep(1), 150);
  }

  function selectCategory(item: CategoryItem) {
    setCategory(item);
    setSpecificDocument(null);
    setTimeout(() => setStep(2), 150);
  }

  function selectSpecificDocument(item: SpecificDocumentItem) {
    setSpecificDocument(item);
    setTitle(item.title);
    if (item.defaultIssuer) {
      setIssuer(item.defaultIssuer);
    }
    setTimeout(() => setStep(3), 150);
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setSelectedFile({
        name: asset.name,
        uri: asset.uri,
        size: asset.size || 0,
        mimeType: asset.mimeType ?? undefined,
      });

      setStep(4);
      showToast("Document uploaded. Ready for review.", "success");
    } catch (error) {
      Alert.alert(
        "Upload Error",
        "Could not select the document. Please try again.",
      );
    }
  }

  const processScan = async (uri: string, mimeType = "image/jpeg") => {
    setOcrLoading(true);

    try {
      const raw = await extractDocumentData(uri);

      const extracted = normalizeExtractedData(raw);
      setExtractedData(extracted);
      setOcrUploadMeta({
        fileUrl: raw?.fileUrl,
        s3Key: raw?.s3Key,
        storagePath: raw?.storagePath,
        documentId: raw?.documentId,
      });

      if (extracted.title) {
        setTitle(extracted.title);
      }

      if (extracted.documentNumber) {
        setDocumentNumber(extracted.documentNumber);
      }

      if (extracted.issuer) {
        setIssuer(extracted.issuer);
      }

      if (extracted.issueDate) {
        setIssueDate(extracted.issueDate);
      }

      if (extracted.expiryDate) {
        setExpiryDate(extracted.expiryDate);
      }

      setStep(4);

      showToast(
        `Document scanned successfully (${extracted.confidence}% extraction completeness)`,
        "success",
      );
    } catch (error: any) {
      console.error("Document OCR error:", error);

      showToast(
        error?.message || "The document could not be processed.",
        "warning",
      );

      setStep(4);
    } finally {
      setOcrLoading(false);
    }
  };

  async function handleScanSuccess(data: {
    images: Array<{ uri: string }> | { uri: string };
  }) {
    setScannerVisible(false);
    const imageArray = Array.isArray(data.images) ? data.images : [data.images];
    const firstImage = imageArray[0];

    if (!firstImage) {
      return;
    }

    setSelectedFile({
      name:
        imageArray.length > 1
          ? `Scanned Document (${imageArray.length} pages)`
          : "Scanned Document",
      uri: firstImage.uri,
      size: 0,
      mimeType: "image/jpeg",
    });

    // The OCR pipeline and the document model are single-page today, so only the
    // first page is extracted. Tell the user rather than silently dropping the
    // rest of the capture.
    if (imageArray.length > 1) {
      showToast(
        `Only the first of ${imageArray.length} scanned pages was processed. Multi-page storage is not supported yet.`,
        "warning",
      );
    }

    await processScan(firstImage.uri);
  }

  function openDatePicker(field: "issueDate" | "expiryDate") {
    setDatePicker(field);
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === "dismissed" || !selectedDate) {
      setDatePicker(null);
      return;
    }

    const value = formatDate(selectedDate);
    if (datePicker === "issueDate") setIssueDate(value);
    if (datePicker === "expiryDate") setExpiryDate(value);

    if (Platform.OS === "android") {
      setDatePicker(null);
    }
  }

  function validateInformation(): boolean {
    if (!title.trim()) {
      Alert.alert("Missing Information", "Please enter the document name.");
      return false;
    }
    if (!documentNumber.trim()) {
      Alert.alert("Missing Information", "Please enter the document number.");
      return false;
    }
    if (!issuer.trim()) {
      Alert.alert("Missing Information", "Please enter the issuing agency.");
      return false;
    }
    if (!issueDate) {
      Alert.alert("Missing Information", "Please select the issue date.");
      return false;
    }
    if (!expiryDate) {
      Alert.alert("Missing Information", "Please select the expiration date.");
      return false;
    }
    return true;
  }

  async function saveDocument() {
    if (!validateInformation()) {
      return;
    }

    setSaving(true);

    try {
      const token = await getStoredToken();
      const hasFile = !!selectedFile;

      let fileUrl: string | undefined;
      let s3Key: string | undefined;

      if (ocrUploadMeta?.fileUrl) {
        fileUrl = ocrUploadMeta.fileUrl;
        s3Key = ocrUploadMeta.s3Key || ocrUploadMeta.storagePath;
      }

      const payload: Partial<LocalDocument> = {
        title: title.trim(),
        category: formatCategoryForBackend(
          specificDocument?.category || category?.id || "other",
        ),
        issuer: issuer.trim(),
        documentNumber: documentNumber.trim().toUpperCase(),
        issueDate,
        expiryDate,
        notes: notes.trim(),
        status: "active",
        enableAlerts: enableAlerts,
        reminderIntervalDays: reminderIntervals[0] || 7,
        reminderIntervals: reminderIntervals,
        processingStatus: hasFile ? "processing" : "completed",
        needsSync: !!token,
        syncStatus: token ? "pending" : "local",
        fileUrl: fileUrl || selectedFile?.uri,
        fileType: selectedFile?.mimeType ?? undefined,
        s3Key,
      };

      const localId = await createDocument(payload);

      await logDocumentAction(localId, "created", payload);

      if (enableAlerts && expiryDate) {
        await scheduleRemindersForDocument({
          ...payload,
          id: localId,
        } as LocalDocument);
      }

      setSaving(false);

      Alert.alert(
        "Document Added",
        `${title} has been successfully added to your document vault.`,
        [
          {
            text: "View Documents",
            onPress: () => router.replace("/(tabs)/documents"),
          },
        ],
      );
    } catch (error) {
      setSaving(false);
      const message =
        error instanceof Error ? error.message : "Could not save the document.";
      Alert.alert("Save Failed", message);
    }
  }

  function goBackStep() {
    if (step === 0) {
      router.back();
      return;
    }
    setStep((current) => current - 1);
  }

  function renderTypeStep() {
    return (
      <View>
        <Text style={styles.questionTitle}>What type of document is this?</Text>
        <Text style={styles.questionSubtitle}>
          Start by choosing whether the document is legal or non-legal.
        </Text>

        <TouchableOpacity
          style={styles.largeChoice}
          onPress={() => selectDocumentType("legal")}
        >
          <View style={styles.choiceIcon}>
            <Ionicons
              name="shield-checkmark-outline"
              size={30}
              color={COLORS.primary}
            />
          </View>
          <View style={styles.choiceContent}>
            <Text style={styles.choiceTitle}>Legal Document</Text>
            <Text style={styles.choiceDescription}>
              Government IDs, certificates, contracts, permits and other legal
              records.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={22}
            color={COLORS.textSecondary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.largeChoice}
          onPress={() => selectDocumentType("non-legal")}
        >
          <View style={styles.choiceIcon}>
            <Ionicons
              name="folder-open-outline"
              size={30}
              color={COLORS.primary}
            />
          </View>
          <View style={styles.choiceContent}>
            <Text style={styles.choiceTitle}>Non-Legal Document</Text>
            <Text style={styles.choiceDescription}>
              Education, employment, personal and other useful documents.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={22}
            color={COLORS.textSecondary}
          />
        </TouchableOpacity>
      </View>
    );
  }

  function renderCategoryStep() {
    return (
      <View>
        <Text style={styles.questionTitle}>Select a category</Text>
        <Text style={styles.questionSubtitle}>
          Choose the category that best describes your document.
        </Text>

        {categories.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.categoryCard}
            onPress={() => selectCategory(item)}
          >
            <View style={styles.categoryIcon}>
              <Ionicons name={item.icon} size={25} color={COLORS.primary} />
            </View>
            <View style={styles.choiceContent}>
              <Text style={styles.choiceTitle}>{item.title}</Text>
              <Text style={styles.choiceDescription}>{item.description}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={22}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderSpecificDocumentStep() {
    return (
      <View>
        <Text style={styles.questionTitle}>Select your document</Text>
        <Text style={styles.questionSubtitle}>
          Choose the specific document you want to add.
        </Text>

        {specificDocuments.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.documentChoice}
            onPress={() => selectSpecificDocument(item)}
          >
            <View style={styles.documentChoiceIcon}>
              <Ionicons name={item.icon} size={24} color={COLORS.primary} />
            </View>
            <View style={styles.choiceContent}>
              <Text style={styles.choiceTitle}>{item.title}</Text>
              <Text style={styles.choiceDescription}>{item.description}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={22}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderScanStep() {
    return (
      <View>
        <Text style={styles.questionTitle}>Scan or Upload</Text>
        <Text style={styles.questionSubtitle}>
          Scan the document with your camera or upload an existing PDF or image.
        </Text>

        {ocrLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Extracting document data...</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.scanOption}
              onPress={() => setScannerVisible(true)}
            >
              <View style={styles.scanIcon}>
                <Ionicons
                  name="camera-outline"
                  size={34}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.choiceContent}>
                <Text style={styles.choiceTitle}>Scan Document</Text>
                <Text style={styles.choiceDescription}>
                  Use your camera to capture the document.
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={22}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity style={styles.scanOption} onPress={pickDocument}>
              <View style={styles.scanIcon}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={34}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.choiceContent}>
                <Text style={styles.choiceTitle}>Upload File</Text>
                <Text style={styles.choiceDescription}>
                  Select a PDF or image from your device.
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={22}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={() => setStep(4)}
            >
              <Text style={styles.skipButtonText}>
                Continue without scanning
              </Text>
            </TouchableOpacity>
          </>
        )}

        {selectedFile ? (
          <View style={styles.filePreview}>
            <Ionicons
              name={
                selectedFile.mimeType === "application/pdf"
                  ? "document-text-outline"
                  : "image-outline"
              }
              size={25}
              color={COLORS.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>
                {selectedFile.name}
              </Text>
              <Text style={styles.fileType}>
                {getFileTypeLabel(selectedFile.mimeType)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedFile(null)}>
              <Ionicons name="close-circle" size={23} color={COLORS.danger} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }

  function renderReviewStep() {
    return (
      <View>
        <Text style={styles.questionTitle}>Review & Edit Information</Text>
        <Text style={styles.questionSubtitle}>
          Check or update the document details before saving.
        </Text>

        {selectedFile?.uri && selectedFile.mimeType?.startsWith("image/") ? (
          <View style={styles.previewCard}>
            <Image
              source={{ uri: selectedFile.uri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          </View>
        ) : null}

        {extractedData ? (
          <View style={styles.extractionCard}>
            <View style={styles.extractionHeader}>
              <Ionicons name="sparkles" size={20} color={COLORS.primary} />
              <Text style={styles.extractionTitle}>Automatic Extraction</Text>
            </View>
            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>Extraction confidence</Text>
              <Text style={styles.confidenceValue}>
                {extractedData.confidence}%
              </Text>
            </View>
          </View>
        ) : null}

        <Field
          label="Document Name"
          value={title}
          placeholder="e.g. Philippine Passport"
          required
          onChangeText={(value) =>
            setTitle(sanitizeText(value, MAX_TITLE_LENGTH))
          }
        />

        <Field
          label="Document Number"
          value={documentNumber}
          placeholder="e.g. P1234567"
          required
          onChangeText={(value) =>
            setDocumentNumber(sanitizeDocumentNumber(value))
          }
        />

        <Field
          label="Issuing Agency"
          value={issuer}
          placeholder="e.g. Department of Foreign Affairs"
          required
          onChangeText={(value) =>
            setIssuer(sanitizeText(value, MAX_ISSUER_LENGTH))
          }
        />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            Issue Date
            <Text style={styles.required}> *</Text>
          </Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => openDatePicker("issueDate")}
          >
            <Ionicons
              name="calendar-outline"
              size={22}
              color={COLORS.primary}
            />
            <Text style={issueDate ? styles.dateText : styles.datePlaceholder}>
              {issueDate || "Select issue date"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#999" />
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            Expiration Date
            <Text style={styles.required}> *</Text>
          </Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => openDatePicker("expiryDate")}
          >
            <Ionicons
              name="calendar-outline"
              size={22}
              color={COLORS.primary}
            />
            <Text style={expiryDate ? styles.dateText : styles.datePlaceholder}>
              {expiryDate || "Select expiration date"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#999" />
          </TouchableOpacity>
        </View>

        <Field
          label="Notes"
          value={notes}
          placeholder="Optional notes"
          multiline
          onChangeText={(value) => setNotes(value.slice(0, MAX_NOTES_LENGTH))}
        />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Alerts & Reminders</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Enable expiration alerts</Text>
            <TouchableOpacity
              style={[
                styles.toggleSwitch,
                enableAlerts && styles.toggleSwitchActive,
              ]}
              onPress={() => setEnableAlerts(!enableAlerts)}
            >
              <View
                style={[
                  styles.toggleKnob,
                  enableAlerts && styles.toggleKnobActive,
                ]}
              />
            </TouchableOpacity>
          </View>
        </View>

        {enableAlerts && (
          <View style={styles.reminderContainer}>
            <Text style={styles.reminderTitle}>
              Remind me before expiration:
            </Text>
            {[7, 14, 30, 60, 90].map((days) => (
              <TouchableOpacity
                key={days}
                style={styles.reminderOption}
                onPress={() => {
                  if (reminderIntervals.includes(days)) {
                    setReminderIntervals(
                      reminderIntervals.filter((d) => d !== days),
                    );
                  } else {
                    setReminderIntervals(
                      [...reminderIntervals, days].sort((a, b) => a - b),
                    );
                  }
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.checkbox,
                    reminderIntervals.includes(days) && styles.checkboxChecked,
                  ]}
                >
                  {reminderIntervals.includes(days) && (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  )}
                </View>
                <Text style={styles.reminderOptionText}>
                  {days} day{days !== 1 ? "s" : ""} before
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, saving && { opacity: 0.7 }]}
          onPress={saveDocument}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>Save Document</Text>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={goBackStep}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <StepHeader step={step} />
        </View>

        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={true}
          showsVerticalScrollIndicator={false}
        >
          {step === 0 && renderTypeStep()}
          {step === 1 && renderCategoryStep()}
          {step === 2 && renderSpecificDocumentStep()}
          {step === 3 && renderScanStep()}
          {step === 4 && renderReviewStep()}
        </ScrollView>
      </KeyboardAvoidingView>

      {scannerVisible && (
        <DocumentScannerComponent
          visible={scannerVisible}
          onScanSuccess={(data) => {
            if (data.images && data.images.length > 0) {
              handleScanSuccess(data);
            }
          }}
          onClose={() => setScannerVisible(false)}
        />
      )}

      {datePicker && (
        <DateTimePicker
          value={
            parseDate(datePicker === "issueDate" ? issueDate : expiryDate) ||
            new Date()
          }
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backButton: {
    padding: 4,
  },
  stepHeader: {
    paddingHorizontal: 20,
    marginBottom: 16,
    flex: 1,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: "row",
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    backgroundColor: "#E5E7EB",
    borderRadius: 2,
  },
  progressSegmentActive: {
    backgroundColor: COLORS.primary,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  questionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 6,
  },
  questionSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  largeChoice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  choiceIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  choiceContent: {
    flex: 1,
  },
  choiceTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 4,
  },
  choiceDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  categoryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  documentChoice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  documentChoiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  switchLabel: {
    fontSize: 15,
    color: COLORS.text,
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#E5E7EB",
    padding: 2,
  },
  toggleSwitchActive: {
    backgroundColor: COLORS.primary,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  toggleKnobActive: {
    transform: [{ translateX: 20 }],
  },
  reminderContainer: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 6,
  },
  reminderTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  reminderOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  reminderOptionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 6,
  },
  required: {
    color: COLORS.danger,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
    color: COLORS.text,
    fontSize: 15,
  },
  multilineInput: {
    height: 100,
    paddingTop: 12,
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
  },
  dateText: {
    flex: 1,
    marginLeft: 10,
    color: COLORS.text,
    fontSize: 15,
  },
  datePlaceholder: {
    flex: 1,
    marginLeft: 10,
    color: "#9CA3AF",
    fontSize: 15,
  },
  primaryButton: {
    flexDirection: "row",
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    gap: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  scanOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  scanIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 8,
  },
  skipButtonText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  loadingContainer: {
    paddingVertical: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  filePreview: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
    gap: 12,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
  },
  fileType: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  previewCard: {
    height: 180,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 16,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  extractionCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  extractionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  extractionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  confidenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  confidenceLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  confidenceValue: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
});
