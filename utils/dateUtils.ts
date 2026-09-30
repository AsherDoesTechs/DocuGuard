export type ExpirationStatus = "valid" | "expiring" | "expired";

export type SyncStatusDisplay = "synced" | "local" | "pending" | "failed";

export function classifyExpiration(expiryDate: string | null | undefined): ExpirationStatus {
  if (!expiryDate) return "valid";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  if (isNaN(expiry.getTime())) return "valid";

  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "expiring";
  return "valid";
}

export function getSyncStatusDisplay(
  syncStatus?: string | null,
  needsSync?: boolean,
): string {
  // Failure must be checked before the pending branch: a failed sync keeps
  // needsSync = 1, so testing "pending" first would mask the failure forever.
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
