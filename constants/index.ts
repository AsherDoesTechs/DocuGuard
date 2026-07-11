import { AppDocument, User, Reminder } from "./../types";

export { default as Colors } from "./colors";
export { default as Spacing } from "./spacing";

export const COLORS = {
  primary: "#2563eb",
  primaryDark: "#1e40af",
  secondary: "#4f46e5",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  background: "#f8fafc",
  surface: "#ffffff",
  text: "#1f2937",
  textSecondary: "#6b7280",
  border: "#e5e7eb",
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
