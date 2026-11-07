import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import {
  adminLogin,
  createAdminChallenge,
  enrollAdminDevice,
  verifyAdminDevice,
} from "../services/adminApi";
import {
  prepareAdminSigningKey,
  signAdminChallenge,
} from "../services/adminBiometrics";
import {
  getAdminDeviceId,
  saveAdminDeviceId,
  saveAdminToken,
} from "../services/adminSession";

export default function AdminLoginScreen() {
  const [adminId, setAdminId] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [enrollmentMode, setEnrollmentMode] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!adminId.trim() || !password) {
      Alert.alert("Missing information", "Enter your Admin ID and password.");
      return;
    }

    if (requiresTwoFactor && !totpCode.trim()) {
      Alert.alert(
        "Verification required",
        "Enter the code from your authenticator app.",
      );
      return;
    }

    setLoading(true);

    try {
      // Check enrollment before creating a server-side pending login.
      const deviceId = await getAdminDeviceId();

      if (!deviceId) {
        setEnrollmentMode(true);
        Alert.alert(
          "Device enrollment required",
          "This device is not enrolled. Enter a one-time enrollment token to enroll it, then sign in.",
        );
        return;
      }

      // Stage 1: Admin ID, password, and optional TOTP.
      const login = await adminLogin(
        adminId,
        password,
        requiresTwoFactor ? totpCode : undefined,
      );

      if (login.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setTotpCode("");
        Alert.alert(
          "Two-factor verification",
          "Enter the code from your authenticator app, then continue.",
        );
        return;
      }

      if (!login.pendingToken || login.requiresDeviceVerification !== true) {
        throw new Error(
          "The server did not return a valid pending administrator login.",
        );
      }

      // Stage 2: ask the backend for a challenge bound to this device.
      const challenge = await createAdminChallenge(
        login.pendingToken,
        deviceId,
      );

      if (!challenge.challengeId || !challenge.challenge) {
        throw new Error("The server returned an invalid device challenge.");
      }

      // Stage 3a: sign the exact server challenge using biometric auth.
      const signature = await signAdminChallenge(challenge.challenge);

      // Stage 3b: backend verifies the signature and only then returns a JWT.
      const verified = await verifyAdminDevice(
        login.pendingToken,
        challenge.challengeId,
        deviceId,
        signature,
      );

      if (!verified.token || !verified.user) {
        throw new Error(
          "Device verification did not produce a valid administrator session.",
        );
      }

      // Do not store the session until the server has verified the proof.
      await saveAdminToken(verified.token);

      setRequiresTwoFactor(false);
      setTotpCode("");

      router.replace("/dashboard");
    } catch (error) {
      // Detailed console debug logging for sign-in failures
      console.error("[Sign-In Debug Error]:", error);

      const errorMessage =
        error instanceof Error
          ? `${error.message}${error.stack ? `\n\nStack: ${error.stack}` : ""}`
          : JSON.stringify(error);

      const message =
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again.";

      if (
        requiresTwoFactor &&
        /verification code|invalid code|invalid verification/i.test(message)
      ) {
        setTotpCode("");
      }

      Alert.alert("Sign-in failed", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollDevice = async () => {
    if (!enrollmentToken.trim()) {
      Alert.alert(
        "Enrollment token required",
        "Enter the one-time enrollment token provided through your administrator provisioning process.",
      );
      return;
    }

    setLoading(true);

    try {
      const existingDeviceId = await getAdminDeviceId();

      if (existingDeviceId) {
        Alert.alert(
          "Device already enrolled",
          "This app already has a saved administrator device ID. Do not enroll it again unless you are following an approved recovery procedure.",
        );
        return;
      }

      // Create or retrieve this device's ECDSA P-256 public key.
      const key = await prepareAdminSigningKey();

      // Safely validate the enrollment token locally.
      // Never log or display the actual token.
      const tokenForValidation = enrollmentToken.trim();

      const tokenDiagnostic = {
        length: tokenForValidation.length,
        validFormat: /^[A-Za-z0-9_-]{32,256}$/.test(tokenForValidation),
      };

      console.log("[Enrollment Token Diagnostic]", tokenDiagnostic);

      if (!tokenDiagnostic.validFormat) {
        Alert.alert(
          "Invalid enrollment token",
          "The enrollment token must contain 32–256 characters using only letters, numbers, underscores, or hyphens. Check that you copied the complete token.",
        );
        return;
      }

      // The backend validates and consumes the separately provisioned token.
      const enrolled = await enrollAdminDevice(
        tokenForValidation,
        key.publicKeyPem,
        "DocuGuard Admin device",
      );

      if (
        enrolled.enrolled !== true ||
        enrolled.keyAlgorithm !== "ECDSA_P256_SHA256" ||
        !enrolled.deviceId
      ) {
        throw new Error("The server returned an invalid enrollment response.");
      }

      // Keep the device identifier in secure local storage.
      await saveAdminDeviceId(String(enrolled.deviceId));

      setEnrollmentToken("");
      setEnrollmentMode(false);

      Alert.alert(
        "Device enrolled",
        "This device is registered. You can now sign in using your Admin ID, password, and biometric verification.",
      );
    } catch (error) {
      // Detailed console debug logging for enrollment failures
      console.error("[Device Enrollment Debug Error]", {
        message:
          error instanceof Error ? error.message : "Unknown enrollment error",
        status:
          error && typeof error === "object" && "status" in error
            ? error.status
            : undefined,
        code:
          error && typeof error === "object" && "code" in error
            ? error.code
            : undefined,
      });

      const detailedErrorMessage =
        error instanceof Error
          ? `${error.message}${error.stack ? `\n\nStack: ${error.stack}` : ""}`
          : JSON.stringify(error);

      Alert.alert("Enrollment failed", detailedErrorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            <View style={styles.brandSection}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>D</Text>
              </View>

              <Text style={styles.brandName}>DocuGuard</Text>
              <Text style={styles.brandSubtitle}>ADMINISTRATION PORTAL</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.securityIcon}>
                <Text style={styles.securityIconText}>◆</Text>
              </View>

              <Text style={styles.title}>
                {enrollmentMode
                  ? "Enroll this device"
                  : requiresTwoFactor
                    ? "Verify your identity"
                    : "Administrator sign in"}
              </Text>

              <Text style={styles.description}>
                {enrollmentMode
                  ? "Register this device with a one-time enrollment token issued through your approved provisioning process."
                  : requiresTwoFactor
                    ? "Enter the verification code from your authenticator app to continue."
                    : "Sign in with your Admin ID and password, then verify your identity using this enrolled device."}
              </Text>

              {enrollmentMode ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>One-time enrollment token</Text>
                    <TextInput
                      style={styles.input}
                      value={enrollmentToken}
                      onChangeText={setEnrollmentToken}
                      placeholder="Enter enrollment token"
                      placeholderTextColor="#8A96A8"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!loading}
                      secureTextEntry
                      accessibilityLabel="One-time device enrollment token"
                    />
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.signInButton,
                      pressed && !loading && styles.buttonPressed,
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={handleEnrollDevice}
                    disabled={loading}
                    accessibilityRole="button"
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.signInButtonText}>
                        Enroll with biometrics
                      </Text>
                    )}
                  </Pressable>

                  <Pressable
                    style={styles.backButton}
                    onPress={() => {
                      setEnrollmentMode(false);
                      setEnrollmentToken("");
                    }}
                    disabled={loading}
                  >
                    <Text style={styles.backButtonText}>Back to sign in</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Admin ID</Text>
                    <TextInput
                      style={styles.input}
                      value={adminId}
                      onChangeText={setAdminId}
                      placeholder="Enter your Admin ID"
                      placeholderTextColor="#8A96A8"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      editable={!loading}
                      accessibilityLabel="Administrator ID"
                    />
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>Password</Text>
                    <TextInput
                      style={styles.input}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Enter your password"
                      placeholderTextColor="#8A96A8"
                      secureTextEntry
                      autoCapitalize="none"
                      autoComplete="current-password"
                      editable={!loading}
                      onSubmitEditing={handleSignIn}
                      accessibilityLabel="Administrator password"
                    />
                  </View>

                  {requiresTwoFactor && (
                    <View style={styles.field}>
                      <Text style={styles.label}>Authenticator code</Text>
                      <TextInput
                        style={styles.input}
                        value={totpCode}
                        onChangeText={(value) =>
                          setTotpCode(value.replace(/\s/g, ""))
                        }
                        placeholder="Enter verification code"
                        placeholderTextColor="#8A96A8"
                        keyboardType="number-pad"
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={8}
                        editable={!loading}
                        onSubmitEditing={handleSignIn}
                        accessibilityLabel="Two-factor verification code"
                      />
                    </View>
                  )}

                  <Pressable
                    style={({ pressed }) => [
                      styles.signInButton,
                      pressed && !loading && styles.buttonPressed,
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={handleSignIn}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel="Sign in as administrator"
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.signInButtonText}>
                        {requiresTwoFactor
                          ? "Verify and continue"
                          : "Continue securely"}
                      </Text>
                    )}
                  </Pressable>

                  {requiresTwoFactor && (
                    <Pressable
                      style={styles.backButton}
                      onPress={() => {
                        setRequiresTwoFactor(false);
                        setTotpCode("");
                      }}
                      disabled={loading}
                    >
                      <Text style={styles.backButtonText}>Back to sign in</Text>
                    </Pressable>
                  )}

                  <Pressable
                    style={styles.backButton}
                    onPress={() => setEnrollmentMode(true)}
                    disabled={loading}
                  >
                    <Text style={styles.backButtonText}>
                      Enroll this device
                    </Text>
                  </Pressable>
                </>
              )}

              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Restricted access. Only authorized administrators may sign in.
                </Text>
              </View>
            </View>

            <Text style={styles.footer}>
              DocuGuard {"·"} Secure Document Management
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3F6FB",
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  container: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  brandSection: {
    alignItems: "center",
    marginBottom: 30,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#15366B",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  logoText: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
  },
  brandName: {
    color: "#15366B",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    color: "#66758C",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: 6,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 25,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    shadowColor: "#15366B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 3,
  },
  securityIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: "#EAF1FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  securityIconText: {
    color: "#2856A5",
    fontSize: 21,
  },
  title: {
    color: "#172B4D",
    fontSize: 23,
    fontWeight: "800",
  },
  description: {
    color: "#68778D",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    marginBottom: 25,
  },
  field: {
    marginBottom: 18,
  },
  label: {
    color: "#263957",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    height: 51,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DCE4EF",
    backgroundColor: "#FBFCFE",
    paddingHorizontal: 14,
    color: "#172B4D",
    fontSize: 14,
  },
  signInButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#204D91",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  signInButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  backButton: {
    alignItems: "center",
    paddingTop: 18,
  },
  backButtonText: {
    color: "#2856A5",
    fontWeight: "700",
    fontSize: 14,
  },
  notice: {
    borderTopWidth: 1,
    borderTopColor: "#EDF1F7",
    marginTop: 24,
    paddingTop: 17,
  },
  noticeText: {
    color: "#7A8799",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  footer: {
    color: "#8A96A8",
    fontSize: 12,
    textAlign: "center",
    marginTop: 24,
  },
});
