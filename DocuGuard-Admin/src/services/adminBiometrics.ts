import {
  biometricAuthAvailable,
  createKeys,
  createSignature,
  getKeyInfo,
  type BiometricAvailability,
} from "react-native-biometric-signature";

const ADMIN_KEY_ALIAS = "docuguard.admin.device-signing.v1";

const BIOMETRIC_PROMPT = "Verify your DocuGuard administrator identity";

export type AdminBiometricKey = {
  publicKeyPem: string;
};

function getBiometricErrorMessage(code?: string, error?: string): string {
  switch (code) {
    case "userCanceled":
    case "systemCanceled":
      return "Biometric verification was canceled.";

    case "notAvailable":
      return "Biometric authentication is unavailable on this device.";

    case "notEnrolled":
      return "Enroll a fingerprint or face in your device settings before continuing.";

    case "lockedOut":
    case "lockedOutPermanent":
      return "Biometric authentication is locked. Follow your device's instructions and try again.";

    case "keyInvalidated":
      return "The administrator signing key is no longer valid. This device must be enrolled again.";

    case "keyNotFound":
      return "This device has no enrolled administrator signing key.";

    case "passcodeNotSet":
      return "Set up device security before enrolling this device.";

    case "notSupported":
      return "This device does not support the required biometric signing operation.";

    case "securityUpdateRequired":
      return "Update your device security before using biometric signing.";

    default:
      return error || "Biometric verification failed. Please try again.";
  }
}

/**
 * The native module reports SHA256withECDSA on Android and iOS.
 * The backend expects ECDSA P-256 with SHA-256.
 *
 * This validates the reported signature algorithm, but does not by itself
 * prove the key's elliptic curve is P-256.
 */
function isExpectedAdminKeyAlgorithm(algorithm?: string): boolean {
  return algorithm === "SHA256withECDSA";
}

export async function checkAdminBiometrics(): Promise<BiometricAvailability> {
  const availability = await biometricAuthAvailable();

  if (availability.canAuthenticate !== true) {
    throw new Error(
      availability.reason ||
        "Biometric authentication is unavailable on this device.",
    );
  }

  if (availability.hasEnrolledBiometrics !== true) {
    throw new Error(
      "No enrolled biometrics were detected. Set up a fingerprint or face in device settings.",
    );
  }

  return availability;
}

/**
 * Retrieves or creates the device's ECDSA signing key.
 * The public key must be registered through the controlled enrollment flow.
 */
export async function prepareAdminSigningKey(): Promise<AdminBiometricKey> {
  await checkAdminBiometrics();

  const existing = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");

  if (existing.exists && existing.isValid !== true) {
    throw new Error(
      "The existing administrator signing key is invalid. Follow the approved device recovery process.",
    );
  }

  if (existing.exists === true && existing.isValid === true) {
    if (!existing.publicKey) {
      throw new Error("The existing signing key did not provide a public key.");
    }

    if (!isExpectedAdminKeyAlgorithm(existing.algorithm)) {
      throw new Error(
        "The existing administrator key does not use the required SHA-256 ECDSA algorithm.",
      );
    }

    return { publicKeyPem: existing.publicKey };
  }

  const result = await createKeys(
    ADMIN_KEY_ALIAS,
    {
      signatureType: "ecdsa",
      enforceBiometric: true,
      setInvalidatedByBiometricEnrollment: true,
      useDeviceCredentials: false,
      failIfExists: false,
    },
    "pem",
    BIOMETRIC_PROMPT,
  );

  // Debug log to inspect the exact native response in the terminal
  console.log("NATIVE KEY GEN RESULT:", JSON.stringify(result, null, 2));

  if (!result.publicKey || result.error || result.code !== "success") {
    const rawDebugInfo = `[Code: ${result.code ?? "none"}, Error: ${result.error ?? "none"}]`;
    throw new Error(`${getBiometricErrorMessage(result.code, result.error)} ${rawDebugInfo}`);
  }

  if (!isExpectedAdminKeyAlgorithm(result.algorithm)) {
    throw new Error(
      "The device did not create the required SHA-256 ECDSA signing key.",
    );
  }

  return { publicKeyPem: result.publicKey };
}

/**
 * Signs the exact challenge string supplied by the server.
 * The private key remains in the native device keystore.
 */
export async function signAdminChallenge(challenge: string): Promise<string> {
  if (!challenge || !challenge.trim()) {
    throw new Error("The server challenge is missing. Start sign-in again.");
  }

  const keyInfo = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");

  if (!keyInfo.exists || keyInfo.isValid !== true) {
    throw new Error(
      "This device has no valid administrator signing key. Enroll it through the approved process.",
    );
  }

  if (!isExpectedAdminKeyAlgorithm(keyInfo.algorithm)) {
    throw new Error(
      "The administrator signing key does not use the required SHA-256 ECDSA algorithm.",
    );
  }

  const result = await createSignature(
    challenge,
    ADMIN_KEY_ALIAS,
    {
      allowDeviceCredentials: false,
    },
    "base64",
    "pem",
    BIOMETRIC_PROMPT,
  );

  // Debug log to inspect the signature response in the terminal
  console.log("NATIVE SIGNATURE RESULT:", JSON.stringify(result, null, 2));

  if (!result.signature || result.error || result.code !== "success") {
    const rawDebugInfo = `[Code: ${result.code ?? "none"}, Error: ${result.error ?? "none"}]`;
    throw new Error(`${getBiometricErrorMessage(result.code, result.error)} ${rawDebugInfo}`);
  }

  if (result.authenticationType !== "biometric") {
    throw new Error(
      "Biometric authentication was not confirmed. The signature was rejected.",
    );
  }

  return result.signature;
}