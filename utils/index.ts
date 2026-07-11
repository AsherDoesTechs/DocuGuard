/**
 * Calculates how many days are left until a document expires.
 */
export function getDaysUntilExpiry(dateString: string): number {
  if (!dateString) return 9999; // Assume no expiry means infinite validity
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiryDate = new Date(dateString);
  expiryDate.setHours(0, 0, 0, 0);

  const differenceInTime = expiryDate.getTime() - today.getTime();
  return Math.ceil(differenceInTime / (1000 * 60 * 60 * 24));
}

/**
 * Aggregates summary details for the home screen dashboard metric widgets
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
    if (daysLeft < 0) {
      expiredDocuments++;
    } else if (daysLeft <= 30) {
      expiringDocuments++;
    } else {
      validDocuments++;
    }
  });

  // Dynamically calculate a safety score percentage based on your standing
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
 * Validates whether an email string follows a correct pattern syntax
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Formats an ISO date string (YYYY-MM-DD) into a clean short readable text format
 */
export function formatShortDate(dateString: string): string {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}
