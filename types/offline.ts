export interface LocalDocument {
  id?: number;
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes?: string;
  status: string;
  enableAlerts: boolean;
  reminderIntervalDays?: number;
  reminderIntervals?: number[];
  fileUrl?: string;
  fileType?: string;
  s3Key?: string;
  processingStatus: string;
  /** Null until a real detector assesses the document. Never derived from OCR. */
  riskScore?: number | null;
  riskLevel?: string | null;
  userId?: string;
  needsSync: boolean;
  syncStatus?: "synced" | "pending" | "failed" | "local";
  cloudId?: number | null;
  /** Server revision this device last synced against, for conflict detection. */
  serverUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface DocumentDashboardSummary {
  total: number;
  valid: number;
  expiring: number;
  expired: number;
  nextExpiring?: {
    id: number;
    title: string;
    daysRemaining: number;
    expiryDate: string;
  };
}

export interface LocalReminder {
  id?: number;
  title: string;
  description?: string;
  dueDate: string;
  severity: string;
  read: boolean;
  userId?: string;
  needsSync: boolean;
  /** Backend reminder id once uploaded, so re-sync updates instead of duplicating. */
  cloudId?: number | null;
  createdAt?: string;
}

export interface LocalUserProfile {
  id?: number;
  name: string;
  email: string;
  documentCount: number;
  expiringCount: number;
  expiredCount: number;
  notificationsEnabled: boolean;
  notifyEmail: boolean;
  notifyExpiry: boolean;
  twoFactor: boolean;
}

export interface SyncResult {
  success: boolean;
  message: string;
  documentsSynced: number;
  remindersSynced: number;
  errors?: string[];
}
