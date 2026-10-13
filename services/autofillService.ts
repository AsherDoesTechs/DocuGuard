import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEYS = {
  RECENT_ISSUERS: "autofill_recent_issuers",
  RECENT_TITLES: "autofill_recent_titles",
  RECENT_DOC_NUMBERS: "autofill_recent_doc_numbers",
  REMINDER_PREFERENCES: "autofill_reminder_prefs",
  LAST_CATEGORY: "autofill_last_category",
  LAST_DOCUMENT_TYPE: "autofill_last_doc_type",
} as const;

interface IssuerEntry {
  issuer: string;
  category: string;
  count: number;
  lastUsed: number;
}

interface TitleEntry {
  title: string;
  category: string;
  count: number;
  lastUsed: number;
}

interface DocNumberEntry {
  documentNumber: string;
  category: string;
  count: number;
  lastUsed: number;
}

interface ReminderPrefs {
  defaultIntervals: number[];
  enableAlerts: boolean;
}

const MAX_ENTRIES = 20;

export const autofillService = {
  async getRecentIssuers(category?: string): Promise<string[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECENT_ISSUERS);
      if (!data) return [];
      const entries: IssuerEntry[] = JSON.parse(data);
      let filtered = entries;
      if (category) {
        filtered = entries.filter((e) => e.category === category);
      }
      return filtered
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .map((e) => e.issuer)
        .slice(0, 5);
    } catch {
      return [];
    }
  },

  async addIssuer(issuer: string, category: string): Promise<void> {
    if (!issuer.trim()) return;
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECENT_ISSUERS);
      const entries: IssuerEntry[] = data ? JSON.parse(data) : [];
      const existingIndex = entries.findIndex(
        (e) => e.issuer.toLowerCase() === issuer.toLowerCase() && e.category === category
      );
      const now = Date.now();
      if (existingIndex >= 0) {
        entries[existingIndex].count += 1;
        entries[existingIndex].lastUsed = now;
      } else {
        entries.unshift({ issuer: issuer.trim(), category, count: 1, lastUsed: now });
      }
      const trimmed = entries.slice(0, MAX_ENTRIES);
      await AsyncStorage.setItem(STORAGE_KEYS.RECENT_ISSUERS, JSON.stringify(trimmed));
    } catch {
      // Silently fail
    }
  },

  async getRecentTitles(category?: string): Promise<string[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECENT_TITLES);
      if (!data) return [];
      const entries: TitleEntry[] = JSON.parse(data);
      let filtered = entries;
      if (category) {
        filtered = entries.filter((e) => e.category === category);
      }
      return filtered
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .map((e) => e.title)
        .slice(0, 5);
    } catch {
      return [];
    }
  },

  async addTitle(title: string, category: string): Promise<void> {
    if (!title.trim()) return;
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECENT_TITLES);
      const entries: TitleEntry[] = data ? JSON.parse(data) : [];
      const existingIndex = entries.findIndex(
        (e) => e.title.toLowerCase() === title.toLowerCase() && e.category === category
      );
      const now = Date.now();
      if (existingIndex >= 0) {
        entries[existingIndex].count += 1;
        entries[existingIndex].lastUsed = now;
      } else {
        entries.unshift({ title: title.trim(), category, count: 1, lastUsed: now });
      }
      const trimmed = entries.slice(0, MAX_ENTRIES);
      await AsyncStorage.setItem(STORAGE_KEYS.RECENT_TITLES, JSON.stringify(trimmed));
    } catch {
      // Silently fail
    }
  },

  async getRecentDocNumbers(category?: string): Promise<string[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECENT_DOC_NUMBERS);
      if (!data) return [];
      const entries: DocNumberEntry[] = JSON.parse(data);
      let filtered = entries;
      if (category) {
        filtered = entries.filter((e) => e.category === category);
      }
      return filtered
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .map((e) => e.documentNumber)
        .slice(0, 5);
    } catch {
      return [];
    }
  },

  async addDocNumber(documentNumber: string, category: string): Promise<void> {
    if (!documentNumber.trim()) return;
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECENT_DOC_NUMBERS);
      const entries: DocNumberEntry[] = data ? JSON.parse(data) : [];
      const existingIndex = entries.findIndex(
        (e) => e.documentNumber.toLowerCase() === documentNumber.toLowerCase() && e.category === category
      );
      const now = Date.now();
      if (existingIndex >= 0) {
        entries[existingIndex].count += 1;
        entries[existingIndex].lastUsed = now;
      } else {
        entries.unshift({ documentNumber: documentNumber.trim().toUpperCase(), category, count: 1, lastUsed: now });
      }
      const trimmed = entries.slice(0, MAX_ENTRIES);
      await AsyncStorage.setItem(STORAGE_KEYS.RECENT_DOC_NUMBERS, JSON.stringify(trimmed));
    } catch {
      // Silently fail
    }
  },

  async getReminderPreferences(): Promise<ReminderPrefs> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.REMINDER_PREFERENCES);
      if (!data) return { defaultIntervals: [30], enableAlerts: true };
      return JSON.parse(data);
    } catch {
      return { defaultIntervals: [30], enableAlerts: true };
    }
  },

  async saveReminderPreferences(prefs: ReminderPrefs): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.REMINDER_PREFERENCES, JSON.stringify(prefs));
    } catch {
      // Silently fail
    }
  },

  async getLastCategory(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.LAST_CATEGORY);
    } catch {
      return null;
    }
  },

  async setLastCategory(categoryId: string): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_CATEGORY, categoryId);
    } catch {
      // Silently fail
    }
  },

  async getLastDocumentType(): Promise<"legal" | "non-legal" | null> {
    try {
      const value = await AsyncStorage.getItem(STORAGE_KEYS.LAST_DOCUMENT_TYPE);
      if (value === "legal" || value === "non-legal") return value;
      return null;
    } catch {
      return null;
    }
  },

  async setLastDocumentType(type: "legal" | "non-legal"): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_DOCUMENT_TYPE, type);
    } catch {
      // Silently fail
    }
  },

  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.RECENT_ISSUERS,
        STORAGE_KEYS.RECENT_TITLES,
        STORAGE_KEYS.RECENT_DOC_NUMBERS,
        STORAGE_KEYS.REMINDER_PREFERENCES,
        STORAGE_KEYS.LAST_CATEGORY,
        STORAGE_KEYS.LAST_DOCUMENT_TYPE,
      ]);
    } catch {
      // Silently fail
    }
  },
};

export function useAutofill(category?: string) {
  const [issuers, setIssuers] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [docNumbers, setDocNumbers] = useState<string[]>([]);
  const [reminderPrefs, setReminderPrefs] = useState<ReminderPrefs>({ defaultIntervals: [30], enableAlerts: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [issuersData, titlesData, docNumbersData, prefs] = await Promise.all([
        autofillService.getRecentIssuers(category),
        autofillService.getRecentTitles(category),
        autofillService.getRecentDocNumbers(category),
        autofillService.getReminderPreferences(),
      ]);
      setIssuers(issuersData);
      setTitles(titlesData);
      setDocNumbers(docNumbersData);
      setReminderPrefs(prefs);
      setLoading(false);
    };
    load();
  }, [category]);

  return {
    issuers,
    titles,
    docNumbers,
    reminderPrefs,
    loading,
    refresh: () => {
      setLoading(true);
      autofillService.getRecentIssuers(category).then(setIssuers);
      autofillService.getRecentTitles(category).then(setTitles);
      autofillService.getRecentDocNumbers(category).then(setDocNumbers);
      autofillService.getReminderPreferences().then(setReminderPrefs);
      setLoading(false);
    },
  };
}