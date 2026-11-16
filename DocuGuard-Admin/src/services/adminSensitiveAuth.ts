import { Platform } from "react-native";
import { checkAdminBiometrics } from "./adminBiometrics";
import { adminLogin } from "./adminApi";
import { getAdminId, getAdminToken } from "./adminSession";

export async function requireSensitiveActionAuth(opts?: {
  adminIdHint?: string | null;
}): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return false;
    const storedId = opts?.adminIdHint?.trim() || (await getAdminId())?.trim() || "";

    const password = window.prompt(
      "Confirm your identity to continue.\nEnter your Password:",
    );
    if (password == null || !password.trim()) {
      window.alert("Password is required. Action cancelled.");
      return false;
    }

    const jwtToken = window.prompt(
      "Confirm your identity to continue.\nEnter your JWT/Bearer Token:",
    );
    if (jwtToken == null || !jwtToken.trim()) {
      window.alert("JWT token is required. Action cancelled.");
      return false;
    }

    const sessionToken = (await getAdminToken())?.trim() || "";
    if (jwtToken.trim() !== sessionToken) {
      window.alert("JWT token does not match your active session. Action cancelled.");
      return false;
    }

    if (storedId) {
      try {
        await adminLogin(storedId, password.trim());
      } catch (e: any) {
        const msg =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          "Password verification failed.";
        window.alert(String(msg));
        return false;
      }
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
    console.warn("[requireSensitiveActionAuth]", msg);
    return false;
  }
}
