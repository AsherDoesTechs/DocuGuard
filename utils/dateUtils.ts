import { getDaysUntilExpiry } from "./dateHelpers";

export type ExpirationStatus = "valid" | "expiring" | "expired";

export type SyncStatusDisplay = "synced" | "local" | "pending" | "failed";

/**
 * Classifies a document according to its expiry date.
 *
 * Expiring: 0–30 days remaining.
 * Expired: before today.
 * Valid: more than 30 days remaining, or no usable expiry date.
 */
export function classifyExpiration(
  expiryDate: string | null | undefined,
): ExpirationStatus {
  if (!expiryDate) {
    return "valid";
  }

  const daysLeft = getDaysUntilExpiry(expiryDate);

  // Preserve the existing convention for missing or invalid dates.
  if (daysLeft === 9999) {
    return "valid";
  }

  if (daysLeft < 0) {
    return "expired";
  }

  if (daysLeft <= 30) {
    return "expiring";
  }

  return "valid";
}

/**
 * Returns a user-facing description of a document's sync state.
 * Failed syncs take priority because they may still need syncing.
 */
export function getSyncStatusDisplay(
  syncStatus?: string | null,
  needsSync?: boolean,
): string {
  if (syncStatus === "failed") {
    return "Sync failed";
  }

  if (syncStatus === "synced" && !needsSync) {
    return "Synced";
  }

  if (syncStatus === "local") {
    return "Stored locally";
  }

  if (syncStatus === "pending" || needsSync) {
    return "Waiting to sync";
  }

  return "Stored locally";
}
