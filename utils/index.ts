import {
  parseLocalDate,
  getDaysUntilExpiry,
  toLocalDateString,
  localDateStringAfterDays,
} from "./dateHelpers";

export {
  parseLocalDate,
  getDaysUntilExpiry,
  toLocalDateString,
  localDateStringAfterDays,
} from "./dateHelpers";

export { classifyExpiration, getSyncStatusDisplay } from "./dateUtils";

export type { ExpirationStatus, SyncStatusDisplay } from "./dateUtils";

/**
 * Aggregates summary details for dashboard metric widgets.
 */
export function calculateDashboardSummary(documents: any[] = []) {
  let validDocuments = 0;
  let expiringDocuments = 0;
  let expiredDocuments = 0;

  documents.forEach((doc) => {
    if (!doc.expiryDate) {
      validDocuments++;
      return;
    }

    const daysLeft = getDaysUntilExpiry(doc.expiryDate);

    if (daysLeft === 9999) {
      validDocuments++;
    } else if (daysLeft < 0) {
      expiredDocuments++;
    } else if (daysLeft <= 30) {
      expiringDocuments++;
    } else {
      validDocuments++;
    }
  });

  const total = documents.length;

  const safetyScore =
    total > 0
      ? Math.round(((validDocuments + expiringDocuments * 0.5) / total) * 100)
      : 100;

  return {
    safetyScore,
    validDocuments,
    expiringDocuments,
    expiredDocuments,
  };
}

/**
 * Checks whether an email has a basic valid address format.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Formats an ISO date into a short, readable local date.
 */
export function formatShortDate(dateString: string | null | undefined): string {
  if (!dateString) {
    return "N/A";
  }

  const date = parseLocalDate(dateString);

  if (!date) {
    return dateString;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
