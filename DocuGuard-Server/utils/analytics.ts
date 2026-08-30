export interface DocumentItem {
  id: string;
  title: string;
  category: string;
  expiryDate: string;
  status?: string;
}

export type RiskLevel = "CRITICAL" | "WARNING" | "STABLE" | "EXPIRED";

export function getDaysUntilExpiry(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function calculateRiskLevel(expiryDate: string): RiskLevel {
  const days = getDaysUntilExpiry(expiryDate);
  if (days < 0) return "EXPIRED";
  if (days <= 7) return "CRITICAL";
  if (days <= 30) return "WARNING";
  return "STABLE";
}

export function generateAnalyticsSummary(documents: DocumentItem[]) {
  let expired = 0;
  let critical = 0; // <= 7 days
  let warning = 0; // 8 - 30 days
  let stable = 0; // > 30 days

  documents.forEach((doc) => {
    const risk = calculateRiskLevel(doc.expiryDate);
    if (risk === "EXPIRED") expired++;
    else if (risk === "CRITICAL") critical++;
    else if (risk === "WARNING") warning++;
    else stable++;
  });

  return {
    total: documents.length,
    expired,
    critical,
    warning,
    stable,
    healthScore:
      documents.length > 0
        ? Math.round(((stable + warning * 0.5) / documents.length) * 100)
        : 100,
  };
}
