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
  if (!needsSync && syncStatus === "synced") {
    return "Synced";
  }
  if (needsSync || syncStatus === "pending") {
    return "Waiting to sync";
  }
  if (syncStatus === "failed") {
    return "Sync failed";
  }
  if (syncStatus === "local" || !needsSync) {
    return "Stored locally";
  }
  return "Waiting to sync";
}
