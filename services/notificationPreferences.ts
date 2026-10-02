import AsyncStorage from "@react-native-async-storage/async-storage";

import { getUserProfile, saveUserProfile } from "./localDatabase";

/**
 * Single source of truth for the user's notification opt-out.
 *
 * This existed in two places that never agreed: the Reminders screen toggle
 * wrote `"notificationsEnabled"` to AsyncStorage, while
 * `notificationScheduler` read the same key from SecureStore. Turning alerts
 * off therefore had no effect - the scheduler saw no value and scheduled
 * everything anyway.
 *
 * The preference is not a secret, so AsyncStorage is the appropriate store. It
 * is also mirrored into the per-user local profile so it can be synced to the
 * server alongside the other profile fields.
 */
const NOTIFICATIONS_ENABLED_KEY = "notificationsEnabled";

/**
 * Reads the preference, defaulting to enabled.
 *
 * Absent or unparsable means enabled: a corrupted value must not silently
 * disable a safety reminder the user expects.
 */
export async function isNotificationsEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    if (stored === null) {
      // Fall back to the synced per-user profile before assuming the default.
      const profile = await getUserProfile();
      return profile?.notificationsEnabled ?? true;
    }
    return stored !== "false";
  } catch {
    return true;
  }
}

/** Persists the preference and mirrors it into the local profile row. */
export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(enabled));
  } catch (error) {
    console.warn("Failed to persist notification preference:", error);
  }

  try {
    const profile = await getUserProfile();
    if (profile) {
      await saveUserProfile({ ...profile, notificationsEnabled: enabled });
    }
  } catch (error) {
    // A missing or unreadable profile row must not break the toggle.
    console.warn("Failed to mirror notification preference to profile:", error);
  }
}