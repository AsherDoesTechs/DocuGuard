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
import { createDocument, logDocumentAction, LocalDocument } from "../services/localDatabase";
import { formatCategoryForBackend } from "@/DocuGuard-Server/utils/categories";

const MAX_TITLE_LENGTH = 100;
const MAX_ISSUER_LENGTH = 150;
const MAX_DOCUMENT_NUMBER_LENGTH = 50;
const MAX_NOTES_LENGTH = 1000;

const STEPS = ["Type", "Category", "Document", "Scan", "Review"] as const;

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
    {
      id: "sss-id",
      title: "SSS ID",
      description: "Social Security System Identification card",
      icon: "card-outline",
      defaultIssuer: "Social Security System",
      category: "government-id",
    },
    {
      id: "philhealth-id",
      title: "PhilHealth ID",
      description: "Philippine Health Insurance Corporation ID",
      icon: "medical-outline",
      defaultIssuer: "PhilHealth",
      category: "government-id",
    },
    {
      id: "tin-id",
      title: "TIN ID",
      description: "Taxpayer Identification Number card",
      icon: "document-text-outline",
      defaultIssuer: "Bureau of Internal Revenue",
      category: "government-id",
    },
    {
      id: "postal-id",
      title: "Postal ID",
      description: "Philippine Postal Corporation ID",
      icon: "mail-outline",
      defaultIssuer: "PhilPost",
      category: "government-id",
    },
    {
      id: "senior-citizen-id",
      title: "Senior Citizen ID",
      description: "Identification card for senior citizens",
      icon: "person-outline",
      defaultIssuer: "Local Government Unit / OSCA",
      category: "government-id",
    },
    {
      id: "voters-id",
      title: "Voter's ID",
      description: "Commission on Elections voter identification",
      icon: "checkbox-outline",
      defaultIssuer: "Commission on Elections",
      category: "government-id",
    },
    {
      id: "barangay-id",
      title: "Barangay ID",
      description: "Identification card issued by the local barangay",
      icon: "home-outline",
      defaultIssuer: "Barangay Hall",
      category: "government-id",
    },
    {
      id: "pwd-id",
      title: "PWD ID",
      description: "Persons with Disability identification card",
      icon: "accessibility-outline",
      defaultIssuer: "Local Government Unit / PDAO",
      category: "government-id",
    },
    {
      id: "sirb",
      title: "Seafarer’s Identification and Record Book (SIRB)",
      description: "Seaman's book issued by MARINA",
      icon: "boat-outline",
      defaultIssuer: "Maritime Industry Authority",
      category: "government-id",
    },
    {
      id: "ofw-id",
      title: "OFW ID / iDOLE Card",
      description: "Overseas Filipino Worker identification card",
      icon: "globe-outline",
      defaultIssuer: "Department of Migrant Workers",
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
      id: "certificate-of-live-birth",
      title: "Certificate of Live Birth",
      description: "Official record of a child's birth",
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
    {
      id: "cenomar",
      title: "CENOMAR",
      description: "Certificate of No Marriage Record",
      icon: "document-outline",
      defaultIssuer: "Philippine Statistics Authority",
      category: "certificate",
    },
    {
      id: "death-certificate",
      title: "Death Certificate",
      description: "Official record of death",
      icon: "document-text-outline",
      defaultIssuer: "Philippine Statistics Authority",
      category: "certificate",
    },
    {
      id: "certificate-of-no-death-record",
      title: "Certificate of No Death Record",
      description: "Certification verifying absence of death record",
      icon: "document-outline",
      defaultIssuer: "Philippine Statistics Authority",
      category: "certificate",
    },
    {
      id: "adoption-certificate",
      title: "Adoption Certificate",
      description: "Legal documentation of adoption",
      icon: "people-outline",
      defaultIssuer: "Philippine Statistics Authority / Court",
      category: "certificate",
    },
    {
      id: "annulment-divorce-document",
      title: "Annulment/Divorce-related Document",
      description: "Court decree or related legal document",
      icon: "file-tray-stacked-outline",
      defaultIssuer: "Regional Trial Court",
      category: "legal",
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
      id: "deed-of-sale",
      title: "Deed of Sale",
      description: "Legal document transferring ownership of property",
      icon: "swap-horizontal-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "lease-agreement",
      title: "Lease Agreement",
      description: "Rental or property lease contract",
      icon: "home-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "spa",
      title: "Special Power of Attorney (SPA)",
      description: "Legal authorization for someone to act on your behalf",
      icon: "key-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "notarized-document",
      title: "Notarized Document",
      description: "Document bearing a notary public seal",
      icon: "ribbon-outline",
      defaultIssuer: "Notary Public",
      category: "legal",
    },
    {
      id: "court-document",
      title: "Court Document",
      description: "Official legal records from a court proceeding",
      icon: "gavel-outline" as keyof typeof Ionicons.glyphMap,
      defaultIssuer: "Judiciary / Court",
      category: "legal",
    },
    {
      id: "legal-notice",
      title: "Legal Notice",
      description: "Formal notification of a legal claim or action",
      icon: "alert-circle-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "demand-letter",
      title: "Demand Letter",
      description: "Formal letter demanding fulfillment of an obligation",
      icon: "mail-open-outline",
      defaultIssuer: "",
      category: "legal",
    },
    {
      id: "authorization-letter",
      title: "Authorization Letter",
      description: "Letter granting permission for specific actions",
      icon: "create-outline",
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
    {
      id: "business-permit",
      title: "Business Permit",
      description: "Official permit to operate a business",
      icon: "business-outline",
      defaultIssuer: "Local Government Unit / City Hall",
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
      id: "insurance-claim-document",
      title: "Insurance Claim Document",
      description: "Documents related to filing an insurance claim",
      icon: "document-lock-outline",
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
    {
      id: "bank-statement",
      title: "Bank Statement",
      description: "Account summary and transaction history",
      icon: "receipt-outline",
      defaultIssuer: "",
      category: "financial",
    },
    {
      id: "bank-certificate",
      title: "Bank Certificate",
      description: "Certification of deposit or account status",
      icon: "document-text-outline",
      defaultIssuer: "",
      category: "financial",
    },
    {
      id: "loan-agreement",
      title: "Loan Agreement",
      description: "Contract detailing loan terms and repayment conditions",
      icon: "cash-outline",
      defaultIssuer: "",
      category: "financial",
    },
    {
      id: "credit-card-document",
      title: "Credit Card Document",
      description: "Statements or agreement terms for credit cards",
      icon: "card-outline",
      defaultIssuer: "",
      category: "financial",
    },
    {
      id: "payment-receipt",
      title: "Payment Receipt",
      description: "Proof of payment for goods or services",
      icon: "receipt-outline",
      defaultIssuer: "",
      category: "financial",
    },
    {
      id: "tax-document",
      title: "Tax Document",
      description: "BIR returns, assessments, or tax clearances",
      icon: "calculator-outline",
      defaultIssuer: "Bureau of Internal Revenue",
      category: "financial",
    },
    {
      id: "investment-statement",
      title: "Investment Statement",
      description: "Portfolio or asset management statement",
      icon: "trending-up-outline",
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
      title: "Academic Transcript",
      description: "Academic transcript or record",
      icon: "document-text-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "report-card",
      title: "Report Card",
      description: "Periodic academic grades record",
      icon: "stats-chart-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "training-certificate",
      title: "Training Certificate",
      description: "Certification of completed professional or skills training",
      icon: "ribbon-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "enrollment-certificate",
      title: "Enrollment Certificate",
      description: "Proof of school enrollment or registration",
      icon: "checkmark-circle-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "school-id",
      title: "School ID",
      description: "Student identification card",
      icon: "id-card-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "graduation-certificate",
      title: "Graduation Certificate",
      description: "Proof of graduation from an institution",
      icon: "school-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "certificate-of-completion",
      title: "Certificate of Completion",
      description: "Certificate indicating completion of a course or program",
      icon: "trophy-outline",
      defaultIssuer: "",
      category: "education",
    },
    {
      id: "scholarship-document",
      title: "Scholarship Document",
      description: "Scholarship agreement or grant terms",
      icon: "wallet-outline",
      defaultIssuer: "",
      category: "education",
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
      id: "employment-contract",
      title: "Employment Contract",
      description: "Job terms and agreement contract",
      icon: "document-text-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "employment-id",
      title: "Company ID",
      description: "Employee identification card",
      icon: "person-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "payslip",
      title: "Payslip",
      description: "Employee salary and deduction record",
      icon: "cash-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "company-clearance",
      title: "Company Clearance",
      description: "Exit clearance document from an employer",
      icon: "checkmark-done-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "employee-certificate",
      title: "Employee Certificate",
      description: "General certification regarding employee status",
      icon: "ribbon-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "job-offer-letter",
      title: "Job Offer Letter",
      description: "Official job offer document",
      icon: "mail-open-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "resignation-letter",
      title: "Resignation Letter",
      description: "Formal letter of resignation",
      icon: "exit-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "employment-verification-letter",
      title: "Employment Verification Letter",
      description: "Letter verifying active or past employment details",
      icon: "search-outline",
      defaultIssuer: "",
      category: "employment",
    },
    {
      id: "leave-certificate",
      title: "Leave Certificate",
      description: "Approved leave or sabbatical document",
      icon: "calendar-outline",
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
    {
      id: "medical-record",
      title: "Medical Record",
      description: "Health history, prescriptions, or laboratory results",
      icon: "medkit-outline",
      defaultIssuer: "",
      category: "personal",
    },
    {
      id: "membership-card",
      title: "Membership Card",
      description: "Club, organization, or loyalty membership card",
      icon: "id-card-outline",
      defaultIssuer: "",
      category: "personal",
    },
    {
      id: "warranty-document",
      title: "Warranty Document",
      description: "Product warranty and guarantee card",
      icon: "shield-checkmark-outline",
      defaultIssuer: "",
      category: "personal",
    },
    {
      id: "property-record",
      title: "Property Record",
      description: "Land titles, tax declarations, or asset deeds",
      icon: "home-outline",
      defaultIssuer: "",
      category: "personal",
    },
    {
      id: "vehicle-registration-document",
      title: "Vehicle Registration Document",
      description:
        "LTO Certificate of Registration (CR) and Official Receipt (OR)",
      icon: "car-outline",
      defaultIssuer: "Land Transportation Office",
      category: "personal",
    },
    {
      id: "other-personal-document",
      title: "Other Personal Document",
      description: "Any other miscellaneous personal files",
      icon: "folder-outline",
      defaultIssuer: "",
      category: "personal",
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
      return;
    }

    setSaving(true);

    try {
      const token = await getStoredToken();
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
         processingStatus: selectedFile ? "processing" : "completed",
         needsSync: !!token,
         syncStatus: "pending",
         fileType: selectedFile?.mimeType ?? undefined,
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
           <Text style={styles.fieldLabel}>
             Alerts & Reminders
           </Text>
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
                     reminderIntervals.includes(days) &&
                       styles.checkboxChecked,
                   ]}
                 >
                   {reminderIntervals.includes(days) && (
                     <Ionicons
                       name="checkmark"
                       size={14}
                       color="#fff"
                     />
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
          {/* Your Step 0 to Step 4 views go here */}
        </ScrollView>
      </KeyboardAvoidingView>

      {scannerVisible && (
        <DocumentScannerComponent
          visible={scannerVisible}
          onScanSuccess={(data) => {
            if (data.images && data.images.length > 0) {
              // Wrap the URI in an object to match what handleScanSuccess expects
              handleScanSuccess({ uri: data.images[0].uri });
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
  },
  stepHeader: {
    paddingHorizontal: 20,
    marginBottom: 16,
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
