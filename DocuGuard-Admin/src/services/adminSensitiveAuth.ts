import { Platform } from "react-native";
import { checkAdminBiometrics } from "./adminBiometrics";

export type SensitiveAuthOptions = {
  adminIdHint?: string | null;
};

type SensitiveAuthHandler = (opts?: SensitiveAuthOptions) => Promise<boolean>;

let webHandler: SensitiveAuthHandler | null = null;

export function registerSensitiveAuthHandler(handler: SensitiveAuthHandler | null) {
  webHandler = handler;
}

export async function requireSensitiveActionAuth(
  opts?: SensitiveAuthOptions,
): Promise<boolean> {
  if (Platform.OS === "web") {
    if (webHandler) {
      return webHandler(opts);
    }
    return false;
  }

  try {
    await checkAdminBiometrics();
    const { createSignature } = await import("react-native-biometric-signature");
    const nonce = `docuguard-admin-sensitive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await createSignature(
      nonce,
      "docuguard.admin.device-signing.v1",
      { allowDeviceCredentials: false } as any,
      "base64",
      "pem",
      "Confirm this sensitive admin action",
    );
    return true;
  } catch (e: any) {
    const msg = e?.message || "Biometric verification failed or was cancelled.";
    console.warn("[requireSensitiveActionAuth]", msg);
    return false;
  }
}
