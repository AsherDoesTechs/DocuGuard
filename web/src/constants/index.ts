// Color Constants

export const COLORS = {
  primary: "#2563eb",
  primaryLight: "#dbeafe",
  accent: {
    indigo: "#6366f1",
    teal: "#14b8a6",
    amber: "#f59e0b",
    red: "#ef4444",
    green: "#22c55e",
  },
  status: {
    valid: "#22c55e",
    expiring: "#f59e0b",
    expired: "#ef4444",
    info: "#3b82f6",
  },
  bg: {
    light: "#f9fafb",
    lighter: "#f3f4f6",
    surface: "#ffffff",
  },
  text: {
    primary: "#1f2937",
    secondary: "#6b7280",
    light: "#9ca3af",
  },
  border: "#e5e7eb",
};

// Category Mapping
export const DOCUMENT_CATEGORIES = {
  passport: { label: "Passport", icon: "Plane", color: "#2563eb" },
  license: { label: "License", icon: "Car", color: "#f59e0b" },
  insurance: { label: "Insurance", icon: "Shield", color: "#22c55e" },
  certificate: { label: "Certificate", icon: "Award", color: "#6366f1" },
  visa: { label: "Visa", icon: "Globe", color: "#14b8a6" },
  other: { label: "Other", icon: "FileText", color: "#9ca3af" },
};

// Mock Documents
export const MOCK_DOCUMENTS: any[] = [
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
    createdAt: "2024-01-10",
    updatedAt: "2024-01-10",
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
    notes: "Valid state ID",
    createdAt: "2024-01-12",
    updatedAt: "2024-01-12",
  },
  {
    id: "3",
    title: "Car Insurance",
    category: "insurance",
    issuer: "State Farm",
    documentNumber: "SF-789456",
    issueDate: "2023-09-01",
    expiryDate: "2024-08-31",
    status: "expired",
    imageUrl: "https://via.placeholder.com/300x200?text=Insurance",
    notes: "Comprehensive coverage",
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
    notes: "Solutions Architect",
    createdAt: "2024-01-20",
    updatedAt: "2024-01-20",
  },
];

// Mock Reminders
export const MOCK_REMINDERS: any[] = [
  {
    id: "1",
    documentId: "2",
    title: "License Expiring Soon",
    message: "Your driver license expires in 2 months",
    severity: "warning",
    dueDate: "2026-04-20",
    isRead: false,
    createdAt: "2024-01-25",
  },
  {
    id: "2",
    documentId: "3",
    title: "Insurance Expired",
    message: "Your car insurance policy has expired",
    severity: "urgent",
    dueDate: "2024-08-31",
    isRead: true,
    createdAt: "2024-09-01",
  },
  {
    id: "3",
    documentId: "1",
    title: "Passport Renewal",
    message: "Consider renewing your passport within the next year",
    severity: "info",
    dueDate: "2029-03-15",
    isRead: false,
    createdAt: "2024-01-22",
  },
];

// Mock User
export const MOCK_USER = {
  id: "1",
  name: "John Doe",
  email: "john.doe@example.com",
  avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=John",
  securityLevel: "premium" as const,
  documentCount: 4,
  expiringCount: 1,
  createdAt: "2023-12-01",
};
