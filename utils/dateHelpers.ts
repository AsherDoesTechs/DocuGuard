/**
 * Parses a date string using its local calendar date.
 *
 * Date-only strings such as YYYY-MM-DD are parsed at local midnight,
 * preventing UTC timezone shifts from changing the expiration day.
 */
export function parseLocalDate(
  dateString: string | null | undefined,
): Date | null {
  if (!dateString?.trim()) {
    return null;
  }

  const value = dateString.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const parsed = new Date(year, month - 1, day);

    // Reject invalid calendar dates instead of silently normalizing them.
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calculates the number of calendar days until expiry.
 *
 * Missing or invalid dates return 9999 to preserve the existing
 * convention for documents without a usable expiry date.
 */
export function getDaysUntilExpiry(
  dateString: string | null | undefined,
): number {
  if (!dateString) {
    return 9999;
  }

  const expiryDate = parseLocalDate(dateString);

  if (!expiryDate) {
    return 9999;
  }

  expiryDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((expiryDate.getTime() - today.getTime()) / 86_400_000);
}
