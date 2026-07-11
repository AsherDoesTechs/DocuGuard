import { COLORS, DOCUMENT_CATEGORIES, MOCK_DOCUMENTS } from "@/constants";
import {
  format,
  formatDistanceToNow,
  isPast,
  isWithinInterval,
  addDays,
} from "date-fns";
import type { Document } from "@/types";

// Date Formatting
export const formatDate = (date: string | Date): string => {
  return format(new Date(date), "MMM dd, yyyy");
};

export const formatShortDate = (date: string | Date): string => {
  return format(new Date(date), "MMM dd");
};

export const formatRelativeDate = (date: string | Date): string => {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
};

// Document Status
export const getDocumentStatus = (
  expiryDate: string,
): "valid" | "expiring" | "expired" => {
  const today = new Date();
  const expiry = new Date(expiryDate);
  const thirtyDaysFromNow = addDays(today, 30);

  if (isPast(expiry)) {
    return "expired";
  } else if (
    isWithinInterval(expiry, { start: today, end: thirtyDaysFromNow })
  ) {
    return "expiring";
  } else {
    return "valid";
  }
};

export const getStatusColor = (
  status: "valid" | "expiring" | "expired",
): string => {
  return COLORS.status[status] || COLORS.status.valid;
};

export const getStatusLabel = (
  status: "valid" | "expiring" | "expired",
): string => {
  const labels = {
    valid: "Valid",
    expiring: "Expiring Soon",
    expired: "Expired",
  };
  return labels[status];
};

// Category Helpers
export const getCategoryLabel = (category: string): string => {
  return (
    DOCUMENT_CATEGORIES[category as keyof typeof DOCUMENT_CATEGORIES]?.label ||
    "Other"
  );
};

export const getCategoryColor = (category: string): string => {
  return (
    DOCUMENT_CATEGORIES[category as keyof typeof DOCUMENT_CATEGORIES]?.color ||
    COLORS.text.light
  );
};

// Validation
export const isValidEmail = (email: string): boolean => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const isValidPassword = (password: string): boolean => {
  return password.length >= 8;
};

// Document Calculations
export const getDaysUntilExpiry = (expiryDate: string): number => {
  const today = new Date();
  const expiry = new Date(expiryDate);
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

export const calculateDashboardSummary = (documents: Document[]) => {
  return {
    totalDocuments: documents.length,
    validDocuments: documents.filter((d) => d.status === "valid").length,
    expiringDocuments: documents.filter((d) => d.status === "expiring").length,
    expiredDocuments: documents.filter((d) => d.status === "expired").length,
    pendingReminders: MOCK_DOCUMENTS.length > 0 ? 2 : 0, // Simplified for demo
  };
};

// File Handling
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

// String Utilities
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

export const capitalizeFirstLetter = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1);
};
