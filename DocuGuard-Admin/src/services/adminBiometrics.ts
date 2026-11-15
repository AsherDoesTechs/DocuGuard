import { Platform } from "react-native";

const ADMIN_KEY_ALIAS = "docuguard.admin.device-signing.v1";
const BIOMETRIC_PROMPT = "Verify your DocuGuard administrator identity";

export type AdminBiometricKey = {
  publicKeyPem: string;
};

export type BiometricAvailability = {
  canAuthenticate?: boolean;
  hasEnrolledBiometrics?: boolean;
  reason?: string;
  [key: string]: any;
};

const WEB_UNSUPPORTED_MESSAGE =
  "Hardware-backed device key authentication is not available in the browser PWA. Use the native/Capacitor admin app for device enrollment and cryptographic sign-in.";

if (Platform.OS !== "web") {
  // Native-only module loaded lazily in functions below.
}

export async function checkAdminBiometrics(): Promise<BiometricAvailability> {
  if (Platform.OS === "web") {
    throw new Error(WEB_UNSUPPORTED_MESSAGE);
  }
  const { biometricAuthAvailable } = await import("react-native-biometric-signature");
  const availability = await biometricAuthAvailable();
  if (availability.canAuthenticate !== true) {
    throw new Error(
      availability.reason || "Biometric authentication is unavailable on this device.",
    );
  }
  if ((availability as any).hasEnrolledBiometrics !== true) {
    throw new Error(
      "No enrolled biometrics were detected. Set up a fingerprint or face in device settings.",
    );
  }
  return availability as any;
}

export async function prepareAdminSigningKey(): Promise<AdminBiometricKey> {
  if (Platform.OS === "web") {
    throw new Error(WEB_UNSUPPORTED_MESSAGE);
  }
  const { biometricAuthAvailable, createKeys, getKeyInfo } = await import(
    "react-native-biometric-signature"
  );
  await checkAdminBiometrics();

  let existing: any;
  try {
    existing = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");
  } catch {
    existing = { exists: false };
  }

  if (existing.exists === true && existing.isValid === true) {
    if (!existing.publicKey) {
      throw new Error("The existing signing key did not provide a public key.");
    }
    if (existing.algorithm !== "SHA256withECDSA") {
      throw new Error(
        "The existing administrator key does not use the required SHA-256 ECDSA algorithm.",
      );
    }
    return { publicKeyPem: existing.publicKey };
  }

  let result: any;
  try {
    result = await createKeys(
      ADMIN_KEY_ALIAS,
      {
        signatureType: "ecdsa",
        enforceBiometric: false,
        setInvalidatedByBiometricEnrollment: false,
        useDeviceCredentials: false,
        failIfExists: false,
      } as any,
      "pem",
      BIOMETRIC_PROMPT,
    );
  } catch (keyGenErr: any) {
    console.warn("Native key generation threw exception:", keyGenErr);
    throw new Error("Unable to create a device signing key on this device.");
  }

  if (!result || !result.publicKey || result.error || result.code !== "success") {
    throw new Error(result?.error || "Failed to create device signing key.");
  }

  if (result.algorithm !== "SHA256withECDSA") {
    throw new Error(
      "The device did not create the required SHA-256 ECDSA signing key.",
    );
  }

  return { publicKeyPem: result.publicKey };
}

export async function signAdminChallenge(challenge: string): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error(WEB_UNSUPPORTED_MESSAGE);
  }
  const logPrefix = "[AdminBiometric][signAdminChallenge]";
  const { createSignature, getKeyInfo } = await import(
    "react-native-biometric-signature"
  );

  if (!challenge || !challenge.trim()) {
    throw new Error("The server challenge is missing. Start sign-in again.");
  }

  let keyInfo: any;
  try {
    keyInfo = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");
  } catch (keyError) {
    console.error(`${logPrefix} KEY INFO ERROR`, keyError);
    throw new Error("Unable to inspect the administrator signing key.");
  }

  if (!keyInfo?.exists || keyInfo?.isValid !== true) {
    throw new Error(
      "This device has no valid administrator signing key. Enroll it through the approved process.",
    );
  }

  let result: any;
  try {
    result = await createSignature(
      challenge,
      ADMIN_KEY_ALIAS,
      { allowDeviceCredentials: false } as any,
      "base64",
      "pem",
      BIOMETRIC_PROMPT,
    );
  } catch (nativeErr: any) {
    const errorText = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
    if (
      errorText.includes("KEY_USER_NOT_AUTHENTICATED") ||
      errorText.includes("-26") ||
      errorText.toLowerCase().includes("user not authenticated")
    ) {
      throw new Error(
        "Biometric authentication was not accepted by the device signing key. Re-enroll this device, then sign in again.",
      );
    }
    if (errorText.includes("KEY_INVALIDATED") || errorText.includes("Key permanently invalidated")) {
      throw new Error(
        "The administrator signing key is no longer valid. Re-enroll this device.",
      );
    }
    throw new Error(
      "Biometric authentication completed, but the device could not sign the challenge.",
    );
  }

  if (!result || !result.signature || result.error || result.code !== "success") {
    throw new Error(result?.error || "Failed to sign the server challenge.");
  }

  return result.signature;
}
