import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "docuguard.admin.session.token";
const DEVICE_ID_KEY = "docuguard.admin.device.id";

export async function saveAdminToken(token: string): Promise<void> {
  if (!token.trim()) {
    throw new Error("Cannot save an empty administrator token.");
  }

  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getAdminToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearAdminToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function saveAdminDeviceId(deviceId: string): Promise<void> {
  if (!deviceId.trim()) {
    throw new Error("Cannot save an empty administrator device ID.");
  }

  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
}

export async function getAdminDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_ID_KEY);
}

export async function clearAdminDeviceId(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
}
