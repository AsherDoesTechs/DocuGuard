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
 * Compatible with Android KeyStore and iOS Secure Enclave constraints.
 */
export async function prepareAdminSigningKey(): Promise<AdminBiometricKey> {
  await checkAdminBiometrics();

  let existing;
  try {
    existing = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");
  } catch {
    existing = { exists: false };
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

  // Relaxed options for robust Android Keystore compatibility
  const result = await createKeys(
    ADMIN_KEY_ALIAS,
    {
      signatureType: "ecdsa",
      enforceBiometric: false,
      setInvalidatedByBiometricEnrollment: false,
      useDeviceCredentials: false,
      failIfExists: false,
    },
    "pem",
    BIOMETRIC_PROMPT,
  );

  console.log("NATIVE KEY GEN RESULT:", JSON.stringify(result, null, 2));

  if (!result.publicKey || result.error || result.code !== "success") {
    const rawDebugInfo = `[Code: ${result.code ?? "none"}, Error: ${result.error ?? "none"}]`;
    throw new Error(
      `${getBiometricErrorMessage(result.code, result.error)} ${rawDebugInfo}`,
    );
  }

  if (!isExpectedAdminKeyAlgorithm(result.algorithm)) {
    throw new Error(
      "The device did not create the required SHA-256 ECDSA signing key.",
    );
  }

  return { publicKeyPem: result.publicKey };
}

export async function signAdminChallenge(challenge: string): Promise<string> {
  if (!challenge || !challenge.trim()) {
    throw new Error("The server challenge is missing. Start sign-in again.");
  }

  const performSignAttempt = async (): Promise<any> => {
    return await createSignature(
      challenge,
      ADMIN_KEY_ALIAS,
      {
        allowDeviceCredentials: true,
      },
      "base64",
      "pem",
      BIOMETRIC_PROMPT,
    );
  };

  let keyInfo = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");

  if (!keyInfo.exists || keyInfo.isValid !== true) {
    throw new Error(
      "This device has no valid administrator signing key. Enroll it through the approved process.",
    );
  }

  let result;
  try {
    result = await performSignAttempt();
  } catch (nativeErr: any) {
    console.warn(
      "Initial signature attempt threw exception, attempting key refresh:",
      nativeErr,
    );
    try {
      await createKeys(
        ADMIN_KEY_ALIAS,
        {
          signatureType: "ecdsa",
          enforceBiometric: false,
          setInvalidatedByBiometricEnrollment: false,
          useDeviceCredentials: false,
          failIfExists: false,
        },
        "pem",
        BIOMETRIC_PROMPT,
      );
      result = await performSignAttempt();
    } catch (retryErr: any) {
      console.error("NATIVE SIGNATURE EXCEPTION AFTER RETRY:", retryErr);
      throw new Error(
        "Android Keystore rejected the signature operation due to hardware auth constraints (-26).",
      );
    }
  }

  console.log("NATIVE SIGNATURE RESULT:", JSON.stringify(result, null, 2));

  // Check for Keystore error code -26 immediately in the result object error string
  const errString = String(result?.error || "");
  if (
    errString.includes("-26") ||
    errString.includes("KEY_USER_NOT_AUTHENTICATED")
  ) {
    throw new Error(
      "Hardware security token expired due to device prompt animation delay (-26). Please tap sign-in and try scanning your fingerprint again.",
    );
  }

  if (
    !result ||
    !result.signature ||
    result.error ||
    result.code !== "success"
  ) {
    const rawDebugInfo = `[Code: ${result?.code ?? "none"}, Error: ${result?.error ?? "none"}]`;
    throw new Error(
      `${getBiometricErrorMessage(result?.code, result?.error)} ${rawDebugInfo}`,
    );
  }

  // Allow both biometric and accepted device credential confirmation types
  const authType = result.authenticationType as string;
  if (authType && authType !== "biometric" && authType !== "deviceCredential") {
    console.warn("Unexpected authentication type returned:", authType);
  }

  return result.signature;
}
