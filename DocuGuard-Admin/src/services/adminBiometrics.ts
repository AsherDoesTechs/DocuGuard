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
 * The key requires biometric user authentication for each signature so the
 * Android Keystore can authorize signing after BiometricPrompt success.
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
  const logPrefix = "[AdminBiometric][signAdminChallenge]";

  const logErrorDetails = (label: string, error: unknown) => {
    if (error instanceof Error) {
      console.error(`${logPrefix} ${label}:`, {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      return;
    }

    console.error(`${logPrefix} ${label}:`, error);

    try {
      console.error(
        `${logPrefix} ${label} serialized:`,
        JSON.stringify(error, null, 2),
      );
    } catch {
      console.error(`${logPrefix} ${label}: Could not serialize error.`);
    }
  };

  const startedAt = Date.now();

  console.log(`${logPrefix} START`, {
    timestamp: new Date().toISOString(),
    challengeProvided: typeof challenge === "string",
    challengeLength: typeof challenge === "string" ? challenge.length : 0,
    keyAlias: ADMIN_KEY_ALIAS,
  });

  if (!challenge || !challenge.trim()) {
    console.error(`${logPrefix} VALIDATION FAILED: Missing challenge`);

    throw new Error("The server challenge is missing. Start sign-in again.");
  }

  let keyInfo;

  try {
    console.log(`${logPrefix} Checking signing key...`);

    keyInfo = await getKeyInfo(ADMIN_KEY_ALIAS, true, "pem");

    console.log(`${logPrefix} KEY INFO RESULT`, {
      exists: keyInfo?.exists,
      isValid: keyInfo?.isValid,
      algorithm: keyInfo?.algorithm,
      publicKeyAvailable: Boolean(keyInfo?.publicKey),
      keyAlias: ADMIN_KEY_ALIAS,
    });
  } catch (keyError: unknown) {
    logErrorDetails("KEY INFO ERROR", keyError);

    throw new Error(
      "Unable to inspect the administrator signing key. Check device logs.",
    );
  }

  if (!keyInfo.exists || keyInfo.isValid !== true) {
    console.error(`${logPrefix} KEY VALIDATION FAILED`, {
      exists: keyInfo.exists,
      isValid: keyInfo.isValid,
      algorithm: keyInfo.algorithm,
    });

    throw new Error(
      "This device has no valid administrator signing key. Enroll it through the approved process.",
    );
  }

  let result;

  try {
    console.log(`${logPrefix} SIGNATURE OPERATION START`, {
      timestamp: new Date().toISOString(),
      keyAlias: ADMIN_KEY_ALIAS,
      allowDeviceCredentials: false,
      outputFormat: "base64",
      keyFormat: "pem",
    });

    result = await createSignature(
      challenge,
      ADMIN_KEY_ALIAS,
      {
        allowDeviceCredentials: false,
      },
      "base64",
      "pem",
      BIOMETRIC_PROMPT,
    );

    console.log(`${logPrefix} SIGNATURE OPERATION COMPLETED`, {
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (nativeErr: unknown) {
    console.error(`${logPrefix} NATIVE SIGNATURE EXCEPTION`, {
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    logErrorDetails("NATIVE SIGNATURE ERROR", nativeErr);

    const errorText =
      nativeErr instanceof Error
        ? `${nativeErr.name}: ${nativeErr.message}`
        : String(nativeErr);

    console.error(`${logPrefix} KEYSTORE ERROR CLASSIFICATION`, {
      keyUserNotAuthenticated: errorText.includes("KEY_USER_NOT_AUTHENTICATED"),
      keystoreErrorMinus26: errorText.includes("-26"),
      keyInvalidated:
        errorText.includes("KEY_INVALIDATED") ||
        errorText.includes("Key permanently invalidated"),
      userCanceled: errorText.toLowerCase().includes("cancel"),
      rawError: errorText,
    });

    if (
      errorText.includes("KEY_USER_NOT_AUTHENTICATED") ||
      errorText.includes("-26") ||
      errorText.toLowerCase().includes("user not authenticated")
    ) {
      throw new Error(
        "Biometric authentication was not accepted by the device signing key. Re-enroll this device with a new enrollment token, then sign in again.",
      );
    }

    if (
      errorText.includes("KEY_INVALIDATED") ||
      errorText.includes("Key permanently invalidated")
    ) {
      throw new Error(
        "The administrator signing key is no longer valid. Re-enroll this device with a new enrollment token.",
      );
    }

    throw new Error(
      "Biometric authentication completed, but the device could not sign the challenge. Check Android logs for the exact native error.",
    );
  }

  console.log(`${logPrefix} NATIVE SIGNATURE RESULT`, {
    code: result?.code,
    error: result?.error,
    signaturePresent: Boolean(result?.signature),
    signatureLength: result?.signature?.length ?? 0,
    algorithm: result?.algorithm,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  if (
    !result ||
    !result.signature ||
    result.error ||
    result.code !== "success"
  ) {
    console.error(`${logPrefix} SIGNATURE VALIDATION FAILED`, {
      resultExists: Boolean(result),
      code: result?.code,
      error: result?.error,
      signaturePresent: Boolean(result?.signature),
      signatureLength: result?.signature?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    const errorText = String(result?.error || "");

    console.error(`${logPrefix} RESULT ERROR CLASSIFICATION`, {
      keyUserNotAuthenticated: errorText.includes("KEY_USER_NOT_AUTHENTICATED"),
      keystoreErrorMinus26: errorText.includes("-26"),
      keyInvalidated:
        errorText.includes("KEY_INVALIDATED") ||
        errorText.includes("Key permanently invalidated"),
      errorCode: result?.code,
      rawError: errorText,
    });

    if (
      errorText.includes("KEY_USER_NOT_AUTHENTICATED") ||
      errorText.includes("-26") ||
      errorText.toLowerCase().includes("user not authenticated")
    ) {
      throw new Error(
        "Biometric authentication was not accepted by the device signing key. Re-enroll this device with a new enrollment token, then sign in again.",
      );
    }

    if (
      errorText.includes("KEY_INVALIDATED") ||
      errorText.includes("Key permanently invalidated")
    ) {
      throw new Error(
        "The administrator signing key is no longer valid. Re-enroll this device with a new enrollment token.",
      );
    }

    throw new Error(getBiometricErrorMessage(result?.code, result?.error));
  }

  console.log(`${logPrefix} SUCCESS`, {
    signaturePresent: true,
    signatureLength: result.signature.length,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  return result.signature;
}
