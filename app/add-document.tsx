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
import { createDocument, logDocumentAction } from "../services/localDatabase";
import { formatCategoryForBackend } from "@/DocuGuard-Server/utils/categories";

const MAX_TITLE_LENGTH = 100;
const MAX_ISSUER_LENGTH = 150;
const MAX_DOCUMENT_NUMBER_LENGTH = 50;
const MAX_NOTES_LENGTH = 1000;

const STEPS = [
  "Type",
  "Category",
  "Document",
  "Information",
  "Scan",
  "Review",
] as const;

interface CategoryItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

interface SpecificDocumentItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  defaultIssuer: string;
  category: string;
}

interface ExtractedData {
  title: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  category: string;
  confidence: number;
  authenticity: "real" | "replica" | "fake";
  authenticityScore: number;
  authenticityReason: string;
}

interface SelectedFileItem {
  name: string;
  uri: string;
  size: number;
  mimeType?: string;
}

const LEGAL_CATEGORIES: CategoryItem[] = [
  {
    id: "government",
    title: "Government Identification",
    description: "Passports, national IDs, driver's licenses and similar IDs",
    icon: "card-outline",
  },
  {
    id: "civil",
    title: "Civil Documents",
    description: "Birth, marriage and other civil certificates",
    icon: "document-text-outline",
  },
  {
    id: "legal",
    title: "Legal Documents",
    description: "Contracts, affidavits, permits and legal records",
    icon: "briefcase-outline",
  },
  {
    id: "financial",
    title: "Financial / Insurance",
    description: "Insurance policies and financial documents",
    icon: "wallet-outline",
  },
];

const NON_LEGAL_CATEGORIES: CategoryItem[] = [
  {
    id: "education",
    title: "Education",
    description: "Diplomas, transcripts and certificates",
    icon: "school-outline",
  },
  {
    id: "employment",
    title: "Employment",
    description: "Employment records, certificates and IDs",
    icon: "business-outline",
  },
  {
    id: "personal",
    title: "Personal Documents",
    description: "Personal records and other documents",
    icon: "person-outline",
  },
  {
    id: "other",
    title: "Other",
    description: "Other useful documents",
    icon: "folder-outline",
  },
];

const DOCUMENTS_BY_CATEGORY: Record<string, SpecificDocumentItem[]> = {
  government: [
    {
      id: "philippine-passport",
      title: "Philippine Passport",
      description: "Passport issued by the Department of Foreign Affairs",
      icon: "airplane-outline",
      defaultIssuer: "Department of Foreign Affairs",
      category: "passport",
    },
    {
      id: "national-id",
      title: "Philippine National ID",
      description: "PhilSys National ID",
      icon: "card-outline",
      defaultIssuer: "Philippine Statistics Authority",
      category: "government-id",
    },
    {
      id: "drivers-license",
      title: "Driver's License",
      description: "License issued by the Land Transportation Office",
      icon: "car-outline",
      defaultIssuer: "Land Transportation Office",
      category: "license",
    },
    {
      id: "prc-id",
      title: "PRC ID",
      description: "Professional identification card",
      icon: "briefcase-outline",
      defaultIssuer: "Professional Regulation Commission",
      category: "government-id",
    },
  ],
  civil: [
    {
      id: "birth-certificate",
      title: "Birth Certificate",
      description: "Certificate of live birth",
      icon: "document-text-outline",
      defaultIssuer: "Philippine Statistics Authority",
      category: "certificate",
    },
    {
      id: "marriage-certificate",
      title: "Marriage Certificate",
      description: "Certificate of marriage",
      icon: "heart-outline",
      defaultIssuer: "Philippine Statistics Authority",
      category: "certificate",
    },
  ],
  legal: [
    {
      id: "contract",
      title: "Contract",
      description: "Legal agreement or contract",
      icon: "document-text-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "affidavit",
      title: "Affidavit",
      description: "Sworn legal statement",
      icon: "document-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "permit",
      title: "Permit",
      description: "Government or organizational permit",
      icon: "shield-checkmark-outline",
      defaultIssuer: "",
      category: "legal",
    },
  ],
  financial: [
    {
      id: "insurance",
      title: "Insurance Policy",
      description: "Insurance policy or coverage document",
      icon: "shield-outline",
      defaultIssuer: "",
      category: "insurance",
    },
    {
      id: "bank-document",
      title: "Bank Document",
      description: "Important banking document",
      icon: "card-outline",
      defaultIssuer: "",
      category: "financial",
    },
  ],
  education: [
    {
      id: "diploma",
      title: "Diploma",
      description: "Academic diploma",
      icon: "school-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "transcript",
      title: "Transcript",
      description: "Academic transcript or record",
      icon: "document-text-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "certificate",
      title: "Certificate",
      description: "Educational or training certificate",
      icon: "ribbon-outline",
      defaultIssuer: "",
      category: "certificate",
    },
  ],
  employment: [
    {
      id: "employment-certificate",
      title: "Certificate of Employment",
      description: "Employment verification document",
      icon: "business-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "employment-id",
      title: "Company ID",
      description: "Employee identification card",
      icon: "person-outline", // Fixed icon name
      defaultIssuer: "",
      category: "employment",
    },
  ],
  personal: [
    {
      id: "personal-record",
      title: "Personal Record",
      description: "Personal document or record",
      icon: "person-outline",
      defaultIssuer: "",
      category: "other",
    },
  ],
  other: [
    {
      id: "other",
      title: "Other Document",
      description: "A document that does not fit another category",
      icon: "folder-outline",
      defaultIssuer: "",
      category: "other",
    },
  ],
};

function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync("userToken");
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
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

  const authenticityScore = Number.isFinite(extracted?.authenticityScore)
    ? Math.max(0, Math.min(100, Math.round(extracted.authenticityScore)))
    : 0;

  let authenticity: "real" | "replica" | "fake" = extracted?.authenticity;

  if (
    authenticity !== "real" &&
    authenticity !== "replica" &&
    authenticity !== "fake"
  ) {
    authenticity =
      authenticityScore >= 80
        ? "real"
        : authenticityScore >= 50
          ? "replica"
          : "fake";
  }

  return {
    title: sanitizeText(extracted?.title || "", MAX_TITLE_LENGTH),
    issuer: sanitizeText(extracted?.issuer || "", MAX_ISSUER_LENGTH),
    documentNumber: sanitizeDocumentNumber(extracted?.documentNumber || ""),
    issueDate: extracted?.issueDate || "",
    expiryDate: extracted?.expiryDate || "",
    category: extracted?.category || "other",
    confidence,
    authenticity,
    authenticityScore,
    authenticityReason: extracted?.authenticityReason || "",
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

  const [selectedFile, setSelectedFile] = useState<SelectedFileItem | null>(
    null,
  );
  const [scannerVisible, setScannerVisible] = useState<boolean>(false);

  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(
    null,
  );
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
      setTitle(specificDocument.title);
      if (specificDocument.defaultIssuer) {
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

      setStep(5);
      showToast("Document uploaded. Ready for review.", "success");
    } catch (error) {
      Alert.alert(
        "Upload Error",
        "Could not select the document. Please try again.",
      );
    }
  }

  async function processScan(uri: string) {
    setOcrLoading(true);

    try {
      const raw = await extractDocumentData(uri);
      const extracted = normalizeExtractedData(raw);

      setExtractedData(extracted);

      if (extracted.title) setTitle(extracted.title);
      if (extracted.documentNumber) setDocumentNumber(extracted.documentNumber);
      if (extracted.issuer) setIssuer(extracted.issuer);
      if (extracted.issueDate) setIssueDate(extracted.issueDate);
      if (extracted.expiryDate) setExpiryDate(extracted.expiryDate);

      setStep(5);
      showToast(
        `Document scanned successfully (${extracted.confidence}% confidence)`,
        "success",
      );
    } catch (error) {
      showToast(
        "The document was scanned, but information could not be extracted.",
        "warning",
      );
      setStep(5);
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleScanSuccess(data: { uri: string }) {
    setScannerVisible(false);
    setSelectedFile({
      name: "Scanned Document",
      uri: data.uri,
      size: 0,
      mimeType: "image/jpeg",
    });
    await processScan(data.uri);
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
      setStep(3);
      return;
    }

    setSaving(true);

    try {
      const token = await getStoredToken();
      const payload = {
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
        enableAlerts: true,
        processingStatus: selectedFile ? "processing" : "completed",
        needsSync: !!token,
        fileType: selectedFile?.mimeType ?? undefined, // Fixed null conversion
      };

      const localId = await createDocument(payload);
      await logDocumentAction(localId, "created", payload);

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

  function renderInformationStep() {
    return (
      <View>
        <Text style={styles.questionTitle}>Document Information</Text>
        <Text style={styles.questionSubtitle}>
          Enter the document details. Information extracted during scanning will
          automatically appear here.
        </Text>

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

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            if (validateInformation()) {
              setStep(4);
            }
          }}
        >
          <Text style={styles.primaryButtonText}>Continue to Scan</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
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

        <TouchableOpacity
          style={styles.scanOption}
          onPress={() => setScannerVisible(true)}
        >
          <View style={styles.scanIcon}>
            <Ionicons name="camera-outline" size={34} color={COLORS.primary} />
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

        <TouchableOpacity style={styles.skipButton} onPress={() => setStep(5)}>
          <Text style={styles.skipButtonText}>Continue without scanning</Text>
        </TouchableOpacity>

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
        <Text style={styles.questionTitle}>Review Information</Text>
        <Text style={styles.questionSubtitle}>
          Check the extracted information before saving the document.
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
          required
          placeholder="Document Name"
          onChangeText={(value) =>
            setTitle(sanitizeText(value, MAX_TITLE_LENGTH))
          }
        />

        <Field
          label="Document Number"
          value={documentNumber}
          required
          placeholder="Document Number"
          onChangeText={(value) =>
            setDocumentNumber(sanitizeDocumentNumber(value))
          }
        />

        <Field
          label="Issuing Agency"
          value={issuer}
          required
          placeholder="Issuing Agency"
          onChangeText={(value) =>
            setIssuer(sanitizeText(value, MAX_ISSUER_LENGTH))
          }
        />

        <TouchableOpacity style={styles.editButton} onPress={() => setStep(3)}>
          <Ionicons name="create-outline" size={20} color={COLORS.primary} />
          <Text style={styles.editButtonText}>Edit Details Manually</Text>
        </TouchableOpacity>

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
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBackStep} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Document</Text>
          <View style={{ width: 24 }} />
        </View>

        <StepHeader step={step} />

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {step === 0 && renderTypeStep()}
          {step === 1 && renderCategoryStep()}
          {step === 2 && renderSpecificDocumentStep()}
          {step === 3 && renderInformationStep()}
          {step === 4 && renderScanStep()}
          {step === 5 && renderReviewStep()}
        </ScrollView>

        {datePicker && (
          <DateTimePicker
            value={parseDate(issueDate || expiryDate) || new Date()}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleDateChange}
          />
        )}

        {scannerVisible && (
          <Modal visible={scannerVisible} animationType="slide">
            <DocumentScannerComponent
              onClose={() => setScannerVisible(false)}
              {...({ onScanComplete: handleScanSuccess } as any)}
            />
          </Modal>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "600", color: COLORS.text },
  scrollContent: { padding: 16, paddingBottom: 40 },
  stepHeader: { marginBottom: 20 },
  stepLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 12,
  },
  progressRow: { flexDirection: "row", gap: 4 },
  progressSegment: {
    flex: 1,
    height: 4,
    backgroundColor: "#E5E7EB",
    borderRadius: 2,
  },
  progressSegmentActive: { backgroundColor: COLORS.primary },
  questionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 6,
  },
  questionSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  largeChoice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  choiceContent: { flex: 1, marginRight: 8 },
  choiceTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 4,
  },
  choiceDescription: { fontSize: 13, color: COLORS.textSecondary },
  categoryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  documentChoice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  documentChoiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  field: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.text,
    marginBottom: 6,
  },
  required: { color: COLORS.danger },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  multilineInput: { height: 100, paddingTop: 10 },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dateText: { flex: 1, marginLeft: 10, fontSize: 15, color: COLORS.text },
  datePlaceholder: { flex: 1, marginLeft: 10, fontSize: 15, color: "#9CA3AF" },
  primaryButton: {
    flexDirection: "row",
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  scanOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  scanIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  skipButton: {
    padding: 12,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  skipButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: "500" },
  filePreview: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    padding: 12,
    borderRadius: 8,
    gap: 12,
  },
  fileName: { fontSize: 14, fontWeight: "500", color: COLORS.text },
  fileType: { fontSize: 12, color: COLORS.textSecondary },
  previewCard: {
    height: 200,
    backgroundColor: "#000",
    borderRadius: 8,
    marginBottom: 16,
    overflow: "hidden",
  },
  previewImage: { width: "100%", height: "100%" },
  extractionCard: {
    backgroundColor: "#F3F4F6",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  extractionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  extractionTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  confidenceRow: { flexDirection: "row", justifyContent: "space-between" },
  confidenceLabel: { fontSize: 13, color: COLORS.textSecondary },
  confidenceValue: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    marginBottom: 12,
  },
  editButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: "500" },
});
