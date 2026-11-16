import { Platform } from "react-native";
import { checkAdminBiometrics } from "./adminBiometrics";

const WEB_AUTH_MESSAGE =
  "Re-enter your admin credentials context is not stored. For web, confirm this sensitive action by entering your Admin ID again.";

export async function requireSensitiveActionAuth(opts?: {
  adminIdHint?: string | null;
}): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return false;
    const hint = opts?.adminIdHint?.trim();
    const promptText = hint
      ? `Confirm your identity to continue. Enter Admin ID "${hint}" to proceed:`
      : "Confirm your identity to continue. Enter your Admin ID to proceed:";
    const entered = window.prompt(promptText);
    if (!entered) return false;
    if (hint && entered.trim().toLowerCase() !== hint.toLowerCase()) {
      window.alert("Admin ID does not match. Action cancelled.");
      return false;
    }
    return true;
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
    if (typeof window !== "undefined") {
      // no-op for native Alert usage in callers; return false and let caller show
    }
    console.warn("[requireSensitiveActionAuth]", msg);
    return false;
  }
}
