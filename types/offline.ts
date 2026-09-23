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
  fileUrl?: string;
  fileType?: string;
  s3Key?: string;
  processingStatus: string;
  riskScore?: number;
  riskLevel?: string;
  userId?: string;
  needsSync: boolean;
  createdAt?: string;
  updatedAt?: string;
  authenticity?: "real" | "replica" | "fake";
  authenticityScore?: number;
  authenticityReason?: string;
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
