export interface Document {
  id: string;
  title: string;
  category:
    | "passport"
    | "license"
    | "insurance"
    | "certificate"
    | "visa"
    | "other";
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  status: "valid" | "expiring" | "expired";
  imageUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  documentId: string;
  title: string;
  message: string;
  severity: "urgent" | "warning" | "info";
  dueDate: string;
  isRead: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  securityLevel: "basic" | "standard" | "premium";
  documentCount: number;
  expiringCount: number;
  createdAt: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user?: User;
  token?: string;
}

export interface FormState {
  isLoading: boolean;
  error?: string;
  success?: boolean;
}

export interface DashboardSummary {
  totalDocuments: number;
  validDocuments: number;
  expiringDocuments: number;
  expiredDocuments: number;
  pendingReminders: number;
}
