import { AppDocument, User, Reminder } from "./../types";

export { default as Colors } from "./colors";
export { default as Spacing } from "./spacing";
export { ErrorCodes, getErrorMessage, formatError } from "./errorCodes";

export const COLORS = {
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  primaryLight: "#EFF6FF",
  secondary: "#4F46E5",
  success: "#10B981",
  successLight: "#D1FAE5",
  warning: "#F59E0B",
  warningLight: "#FEF3C7",
  danger: "#EF4444",
  dangerLight: "#FEE2E2",
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSecondary: "#F3F7FC",
  text: "#243247",
  textSecondary: "#6B7A90",
  textMuted: "#9AA8BA",
  border: "#DCE6F2",
  borderLight: "#EDF3FA",
  shadow: "#000000",
  overlay: "rgba(15, 23, 42, 0.5)",
  divider: "#E2E8F0",
  inputBackground: "#FFFFFF",
  inputBorder: "#D1D5DB",
  buttonPrimary: "#2563EB",
  buttonPrimaryText: "#FFFFFF",
  buttonSecondary: "#EDF3FA",
  buttonSecondaryText: "#1D4ED8",
  buttonDanger: "#EF4444",
  buttonDangerText: "#FFFFFF",
  tagBackground: "#EFF6FF",
  tagText: "#1D4ED8",
  tagBorder: "#BFDBFE",
  progressBackground: "#DCE6F2",
  progressFill: "#2563EB",
  modalOverlay: "rgba(15, 23, 42, 0.4)",
  headerBackground: "#FFFFFF",
  tabBarBackground: "#FFFFFF",
  tabBarBorder: "#E2E8F0",
  searchBackground: "#F3F7FC",
  cardShadow: "rgba(73, 103, 145, 0.08)",
};

export const TYPOGRAPHY = {
  heading: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.25,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  body: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: "500",
  },
  small: {
    fontSize: 12,
    fontWeight: "500",
  },
};

export const SHADOWS = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
};

export const BORDER_RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const DOCUMENT_CATEGORIES = {
  passport: "Passport",
  license: "License",
  insurance: "Insurance",
  certificate: "Certificate",
  visa: "Visa",
  other: "Other",
};

export const MOCK_USER: User = {
  id: "1",
  name: "John Doe",
  email: "john.doe@example.com",
  avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=john",
  documentCount: 4,
  expiringCount: 1,
  securityLevel: "premium",
};

export const MOCK_DOCUMENTS: AppDocument[] = [
  {
    id: "1",
    title: "US Passport",
    category: "passport",
    issuer: "US State Department",
    documentNumber: "N12345678",
    issueDate: "2020-03-15",
    expiryDate: "2030-03-15",
    status: "valid",
    imageUrl: "https://via.placeholder.com/300x200?text=Passport",
    notes: "Primary travel document",
    createdAt: "2024-01-15",
    updatedAt: "2024-01-15",
  },
  {
    id: "2",
    title: "Driver License",
    category: "license",
    issuer: "California DMV",
    documentNumber: "D4567890",
    issueDate: "2021-06-20",
    expiryDate: "2026-06-20",
    status: "expiring",
    imageUrl: "https://via.placeholder.com/300x200?text=License",
    notes: "Standard driver license",
    createdAt: "2024-01-15",
    updatedAt: "2024-01-15",
  },
  {
    id: "3",
    title: "Car Insurance",
    category: "insurance",
    issuer: "State Farm",
    documentNumber: "SF-789456",
    issueDate: "2023-08-31",
    expiryDate: "2024-08-31",
    status: "expired",
    imageUrl: "https://via.placeholder.com/300x200?text=Insurance",
    notes: "Vehicle insurance policy",
    createdAt: "2024-01-15",
    updatedAt: "2024-01-15",
  },
  {
    id: "4",
    title: "Professional Certification",
    category: "certificate",
    issuer: "AWS",
    documentNumber: "AWS-123456",
    issueDate: "2023-01-15",
    expiryDate: "2026-01-15",
    status: "valid",
    imageUrl: "https://via.placeholder.com/300x200?text=Certificate",
    notes: "AWS Solutions Architect certification",
    createdAt: "2024-01-15",
    updatedAt: "2024-01-15",
  },
];

export const MOCK_REMINDERS: Reminder[] = [
  {
    id: "1",
    title: "License Expiring Soon",
    description: "Your driver license expires in 2 months",
    severity: "urgent",
    dueDate: "2026-04-20",
    read: false,
    documentId: "2",
  },
  {
    id: "2",
    title: "Insurance Expired",
    description: "Your car insurance policy has expired",
    severity: "urgent",
    dueDate: "2024-08-31",
    read: false,
    documentId: "3",
  },
  {
    id: "3",
    title: "Passport Renewal",
    description: "Consider renewing your passport within the next year",
    severity: "info",
    dueDate: "2029-03-15",
    read: false,
    documentId: "1",
  },
];