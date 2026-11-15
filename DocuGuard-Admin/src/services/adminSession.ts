import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "docuguard.admin.session.token";
const DEVICE_ID_KEY = "docuguard.admin.device.id";

const isWeb = Platform.OS === "web";
let devAdminToken: string | null = null;

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
    return null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function saveAdminToken(token: string): Promise<void> {
  if (!token.trim()) {
    throw new Error("Cannot save an empty administrator token.");
  }

  await setItem(TOKEN_KEY, token);
}

export async function getAdminToken(): Promise<string | null> {
  if (devAdminToken) return devAdminToken;
  const stored = await getItem(TOKEN_KEY);
  if (stored) return stored;
  const envToken =
    (typeof process !== "undefined" &&
      (process.env.EXPO_PUBLIC_ADMIN_DEV_TOKEN as string | undefined)) ||
    "";
  if (envToken.trim()) {
    devAdminToken = envToken.trim();
    return devAdminToken;
  }
  return null;
}

export async function clearAdminToken(): Promise<void> {
  devAdminToken = null;
  await deleteItem(TOKEN_KEY);
}

export async function saveAdminDeviceId(deviceId: string): Promise<void> {
  if (!deviceId.trim()) {
    throw new Error("Cannot save an empty administrator device ID.");
  }

  await setItem(DEVICE_ID_KEY, deviceId);
}

export async function getAdminDeviceId(): Promise<string | null> {
  return getItem(DEVICE_ID_KEY);
}

export async function clearAdminDeviceId(): Promise<void> {
  await deleteItem(DEVICE_ID_KEY);
}

export function setDevAdminToken(token: string | null): void {
  devAdminToken = token?.trim() || null;
}
