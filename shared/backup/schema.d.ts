import type { z } from "zod";

export const BACKUP_FORMAT: "docuguard.backup";
export const BACKUP_VERSION: 1;

export type BackupDocument = {
  title: string;
  category:
    | "identification"
    | "financial"
    | "medical"
    | "legal"
    | "academic"
    | "other";
  issuer: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  status: "active" | "verified" | "expired";
  enableAlerts: boolean;
  reminderIntervalDays?: number | null;
  reminderIntervals?: number[];
  fileType?: string | null;
  processingStatus:
    | "pending"
    | "uploading"
    | "processing"
    | "completed"
    | "failed"
    | "manual_review";
  riskScore?: number | null;
  riskLevel?: "Low" | "Medium" | "High" | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: string[];
};

export type BackupReminder = {
  title: string;
  description: string | null;
  dueDate: string | null;
  severity: string;
  read: boolean;
  createdAt: string | null;
};

export type BackupData = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  documents: BackupDocument[];
  reminders: BackupReminder[];
};

export const documentSchema: z.ZodType<BackupDocument>;
export const reminderSchema: z.ZodType<BackupReminder>;
export const backupSchema: z.ZodType<BackupData>;

export function validateBackup(
  input: unknown,
): { success: true; data: BackupData } | { success: false; error: z.ZodError };
