import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Link, useRouter, useFocusEffect } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";

import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants";
import { api } from "../../services/api";
import { establishAuthenticatedSession } from "../../services/authSession";
import { registerPushTokenWithBackend } from "../../hooks/usePushNotifications";
import {
  loginSchema,
  type LoginInput,
  validateSchema,
} from "@/shared/validation";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";

export default function LoginScreen() {
  const router = useRouter();
  const colors = useColors();

  const [showPassword, setShowPassword] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const [pendingTwoFactor, setPendingTwoFactor] = useState<{
    email: string;
    password: string;
    rememberMe: boolean;
  } | null>(null);

  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorMode, setTwoFactorMode] = useState<"totp" | "recovery">(
    "totp",
  );
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);

  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [biometricSubmitting, setBiometricSubmitting] = useState(false);

  // Refs prevent duplicate requests before React updates loading state.
  const loginRequestRef = useRef(false);
  const twoFactorRequestRef = useRef(false);
  const biometricRequestRef = useRef(false);

  useFeedbackService();

  const completeLogin = useCallback(
    async (
      response: { token?: string; user?: { id: number } },
      rememberMe: boolean,
      email: string,
      password?: string, // Add optional password parameter here
    ) => {
      if (!response?.token) {
        throw new Error("The server did not return a valid session.");
      }

      const userId = response.user?.id;

      if (
        typeof userId !== "number" ||
        !Number.isSafeInteger(userId) ||
        userId <= 0
      ) {
        throw new Error(
          "The server did not return a valid account identity. Please sign in again.",
        );
      }

      await establishAuthenticatedSession(response.token, userId);

      // Securely cache credentials for biometrics if password is provided
      if (password) {
        try {
          await SecureStore.setItemAsync(
            "secure_user_credentials",
            JSON.stringify({ email, password, userId }),
          );
        } catch (e) {
          console.warn("[Login] Failed to save biometric credentials:", e);
        }
      }

      void Promise.resolve(registerPushTokenWithBackend()).catch((error) => {
        console.warn("[Login] Push-token registration failed.", error);
      });

      try {
        if (rememberMe) {
          await SecureStore.setItemAsync("rememberedEmail", email);
        } else {
          await SecureStore.deleteItemAsync("rememberedEmail");
        }
      } catch (error) {
        console.warn("[Login] Remembered-email update failed.", error);
      }

      router.replace("/(tabs)/documents" as any);
    },
    [router],
  );

  // Check biometric availability without allowing native API failures
  // to crash the login screen.
  useFocusEffect(
    useCallback(() => {
      let active = true;

      const checkBiometricSupport = async () => {
        try {
          const [hasHardware, isEnrolled, token, storedCredentials, activeUserId] =
            await Promise.all([
              LocalAuthentication.hasHardwareAsync(),
              LocalAuthentication.isEnrolledAsync(),
              SecureStore.getItemAsync("userToken"),
              SecureStore.getItemAsync("secure_user_credentials"),
              (async () => {
                const raw = await SecureStore.getItemAsync("docuguard.localUserId");
                const n = raw ? Number(raw) : NaN;
                return Number.isSafeInteger(n) && n > 0 ? n : null;
              })(),
            ]);

          let parsedCredentials: { email?: string; password?: string; userId?: number } | null = null;
          if (storedCredentials) {
            try {
              parsedCredentials = JSON.parse(storedCredentials);
            } catch {
              parsedCredentials = null;
            }
          }

          const credentialUserId =
            parsedCredentials &&
            typeof parsedCredentials.userId === "number" &&
            Number.isSafeInteger(parsedCredentials.userId) &&
            parsedCredentials.userId > 0
              ? parsedCredentials.userId
              : null;

          const effectiveUserId = activeUserId ?? credentialUserId;
          const hasUsableCredentials =
            !!parsedCredentials &&
            typeof parsedCredentials.email === "string" &&
            typeof parsedCredentials.password === "string";

          let biometricSetting: string | null = null;
          if (effectiveUserId !== null) {
            biometricSetting = await SecureStore.getItemAsync(
              `docuguard.security.biometricEnabled.user.${effectiveUserId}`,
            );
            // Migrate legacy/global biometric preference for this account.
            if (biometricSetting === null) {
              const legacy = await SecureStore.getItemAsync(
                "docuguard.security.biometricEnabled",
              );
              if (legacy !== null) {
                await SecureStore.setItemAsync(
                  `docuguard.security.biometricEnabled.user.${effectiveUserId}`,
                  legacy,
                );
                biometricSetting = legacy;
              }
            }
          } else {
            biometricSetting = await SecureStore.getItemAsync(
              "docuguard.security.biometricEnabled",
            );
          }

          const credentialsMatchAccount =
            hasUsableCredentials &&
            (credentialUserId === null ||
              effectiveUserId === null ||
              credentialUserId === effectiveUserId);

          if (active) {
            setIsBiometricSupported(
              hasHardware &&
                isEnrolled &&
                credentialsMatchAccount &&
                (biometricSetting === "true" ||
                  (effectiveUserId !== null && Boolean(token))),
            );
          }
        } catch (error) {
          console.warn("Unable to check biometric availability:", error);

          if (active) {
            setIsBiometricSupported(false);
          }
        }
      };

      void checkBiometricSupport();

      return () => {
        active = false;
      };
    }, []),
  );

  const handleTwoFactorSubmit = async () => {
    if (!pendingTwoFactor || twoFactorRequestRef.current) {
      return;
    }

    const code = twoFactorCode.trim();
    const validCode =
      twoFactorMode === "totp"
        ? /^\d{6}$/.test(code)
        : /^[A-F0-9]{32}$/.test(code);

    if (!validCode) {
      const message =
        twoFactorMode === "totp"
          ? "Enter the complete 6-digit authenticator code."
          : "Enter a valid 32-character recovery code.";

      setTwoFactorError(message);
      feedbackService.warning(message);
      return;
    }

    twoFactorRequestRef.current = true;
    setTwoFactorSubmitting(true);
    setTwoFactorError(null);

    try {
      const response = await api.auth.login({
        email: pendingTwoFactor.email,
        password: pendingTwoFactor.password,
        [twoFactorMode === "totp" ? "totpCode" : "recoveryCode"]: code,
      });

      if (response?.requiresTwoFactor) {
        router.push({
          pathname: "/(auth)/verify-2fa" as any,
          params: {
            email: pendingTwoFactor.email,
            password: pendingTwoFactor.password,
          },
        });
        return;
      }

      if (!response?.token) {
        throw new Error("The server did not return a valid session.");
      }

      await completeLogin(
        response,
        pendingTwoFactor.rememberMe,
        pendingTwoFactor.email,
        pendingTwoFactor.password,
      );

      setPendingTwoFactor(null);
      setTwoFactorCode("");
      setTwoFactorMode("totp");
    } catch (err: any) {
      const status = err?.response?.status;

      if (status === 401) {
        const message = "That code was not accepted. Try again.";
        setTwoFactorError(message);
        setTwoFactorCode("");
        feedbackService.error(message);
      } else if (status === 429) {
        const message = "Too many attempts. Please wait before trying again.";
        setTwoFactorError(message);
        feedbackService.warning(message);
      } else if (!err?.response) {
        const message =
          "Network error. Check your internet connection and try again.";
        setTwoFactorError(message);
        feedbackService.error(message);
      } else {
        const message =
          status >= 500
            ? "The server is temporarily unavailable. Please try again later."
            : (err?.response?.data?.error ??
              "Verification failed. Please try again.");

        setTwoFactorError(message);
        feedbackService.error(message);
      }
    } finally {
      twoFactorRequestRef.current = false;
      setTwoFactorSubmitting(false);
    }
  };

  const form = useForm<LoginInput>({
    initialValues: {
      email: "",
      password: "",
      rememberMe: false,
    },

    validate: (values: LoginInput) => {
      const result = validateSchema(loginSchema, values);

      if (result.success) {
        return {};
      }

      return result.errors as Partial<Record<keyof LoginInput, string>>;
    },

    onSubmit: async (values) => {
      if (loginRequestRef.current) {
        return;
      }

      loginRequestRef.current = true;

      try {
        const normalizedValues = {
          ...values,
          email: values.email.trim().toLowerCase(),
        };

        const response = await api.auth.login(normalizedValues);

        if (response?.requiresTwoFactor) {
          setPendingTwoFactor({
            email: normalizedValues.email,
            password: values.password,
            rememberMe: values.rememberMe ?? false,
          });
          setTwoFactorCode("");
          setTwoFactorError(null);
          return;
        }

        await completeLogin(
          response,
          values.rememberMe ?? false,
          normalizedValues.email,
          values.password,
        );

        setPendingTwoFactor(null);
      } catch (err: any) {
        const status = err?.response?.status;
        let errorMessage =
          "Unable to sign in. Please check your credentials and try again.";

        if (!err?.response) {
          errorMessage =
            "Network error. Please check your internet connection and try again.";
        } else if (status === 429) {
          errorMessage = "Too many attempts. Please wait before trying again.";
        } else if (status >= 500) {
          errorMessage =
            "The server is temporarily unavailable. Please try again later.";
        } else if (status === 401) {
          errorMessage =
            "Email or password is incorrect. Please check your details and try again.";
        } else if (err?.response?.data?.error) {
          errorMessage = err.response.data.error;
        } else if (
          err instanceof Error &&
          err.message.includes("valid session")
        ) {
          errorMessage =
            "We couldn't establish a secure session. Please try again.";
        }

        feedbackService.error(errorMessage);
      } finally {
        loginRequestRef.current = false;
      }
    },
  });

  // Run the existing schema validation before allowing a request.
  // The attempted-submit flag makes errors visible even before fields blur.
  const handleLoginPress = () => {
    if (loginRequestRef.current || form.isSubmitting) {
      return;
    }

    setHasAttemptedSubmit(true);

    const result = validateSchema(loginSchema, form.values);

    if (!result.success) {
      const errors = result.errors as Partial<Record<keyof LoginInput, string>>;

      const firstError =
        errors.email ??
        errors.password ??
        "Please complete the required fields.";

      feedbackService.warning(firstError);
      form.handleSubmit();
      return;
    }

    form.handleSubmit();
  };

  const handleBiometricAuth = async () => {
    if (
      biometricRequestRef.current ||
      form.isSubmitting ||
      loginRequestRef.current
    ) {
      return;
    }

    biometricRequestRef.current = true;
    setBiometricSubmitting(true);

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock your DocuGuard vault",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });

      if (!result.success) {
        return;
      }

      const storedCredentials = await SecureStore.getItemAsync(
        "secure_user_credentials",
      );

      if (!storedCredentials) {
        feedbackService.alert({
          title: "Session Reset",
          message:
            "Please sign in with your password once to re-enable biometric login.",
          type: "warning",
        });
        return;
      }

      let parsedCredentials: { email?: string; password?: string; userId?: number };
      try {
        parsedCredentials = JSON.parse(storedCredentials);
      } catch {
        await SecureStore.deleteItemAsync("secure_user_credentials");
        feedbackService.alert({
          title: "Session Reset",
          message:
            "Please sign in with your password once to re-enable biometric login.",
          type: "warning",
        });
        return;
      }

      const { email, password, userId: cachedUserId } = parsedCredentials;

      if (typeof email !== "string" || typeof password !== "string") {
        await SecureStore.deleteItemAsync("secure_user_credentials");
        feedbackService.alert({
          title: "Session Reset",
          message:
            "Please sign in with your password once to re-enable biometric login.",
          type: "warning",
        });
        return;
      }

      // Request a session token from the backend using stored credentials
      const response = await api.auth.login({ email, password });

      // FIX: Check if 2FA is triggered during biometric login
      if (response?.requiresTwoFactor) {
        router.push({
          pathname: "/(auth)/verify-2fa" as any,
          params: {
            email: email.trim().toLowerCase(),
            password,
          },
        });
        return;
      }

      if (!response?.token) {
        throw new Error("Could not refresh session via biometrics.");
      }

      const userId = response.user?.id;
      if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error("Could not verify account identity for biometric sign-in.");
      }

      if (
        typeof cachedUserId === "number" &&
        Number.isSafeInteger(cachedUserId) &&
        cachedUserId > 0 &&
        cachedUserId !== userId
      ) {
        await SecureStore.deleteItemAsync("secure_user_credentials");
        throw new Error(
          "Biometric credentials are no longer valid for this account. Please sign in with your password.",
        );
      }

      await establishAuthenticatedSession(response.token, userId);

      // Refresh cached credentials with verified user ownership.
      try {
        await SecureStore.setItemAsync(
          "secure_user_credentials",
          JSON.stringify({ email, password, userId }),
        );
      } catch {}

      router.replace("/(tabs)/documents" as any);
    } catch (error) {
      console.warn("Biometric sign-in failed:", error);
      feedbackService.error(
        "Biometric sign-in failed. Please use your password.",
      );
    } finally {
      biometricRequestRef.current = false;
      setBiometricSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 24,
      paddingBottom: 32,
    },
    header: {
      alignItems: "center",
      marginBottom: 32,
      marginTop: 16,
    },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: "center",
    },
    passwordWrapper: {
      position: "relative",
      width: "100%",
    },
    eyeIcon: {
      position: "absolute",
      right: 14,
      top: 0,
      bottom: 0,
      width: 36,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginVertical: Spacing.sm,
    },
    checkboxContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    checkboxLabel: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    errorText: {
      color: colors.error,
      marginBottom: 12,
      textAlign: "center",
      fontSize: 14,
    },
    biometricSection: {
      marginTop: 32,
      alignItems: "center",
    },
    dividerContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 24,
      gap: 12,
    },
    divider: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    biometricButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primaryLight,
      justifyContent: "center",
      alignItems: "center",
    },
    biometricHint: {
      marginTop: 10,
      fontSize: 13,
      color: colors.textSecondary,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      marginTop: 32,
    },
    footerText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    link: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: "600",
    },
  });

  return (
    <AuthScreen
      title={pendingTwoFactor ? "Two-Factor Authentication" : "Welcome Back"}
      subtitle={
        pendingTwoFactor
          ? "Enter the 6-digit code from your authenticator app"
          : "Sign in to access your secure documents"
      }
    >
      {pendingTwoFactor ? (
        <Card>
          <View
            style={{
              flexDirection: "row",
              gap: Spacing.sm,
              marginBottom: Spacing.sm,
            }}
          >
            <TouchableOpacity
              disabled={twoFactorSubmitting}
              onPress={() => {
                setTwoFactorMode("totp");
                setTwoFactorCode("");
                setTwoFactorError(null);
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor:
                  twoFactorMode === "totp" ? colors.primary : colors.background,
              }}
            >
              <Text
                style={{
                  color: twoFactorMode === "totp" ? colors.buttonPrimaryText : colors.text,
                }}
              >
                Authenticator
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={twoFactorSubmitting}
              onPress={() => {
                setTwoFactorMode("recovery");
                setTwoFactorCode("");
                setTwoFactorError(null);
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor:
                  twoFactorMode === "recovery"
                    ? colors.primary
                    : colors.background,
              }}
            >
              <Text
                style={{
                  color: twoFactorMode === "recovery" ? colors.buttonPrimaryText : colors.text,
                }}
              >
                Recovery code
              </Text>
            </TouchableOpacity>
          </View>

          <Input
            label={
              twoFactorMode === "totp" ? "Authenticator Code" : "Recovery Code"
            }
            placeholder={
              twoFactorMode === "totp" ? "000000" : "32-character code"
            }
            value={twoFactorCode}
            onChangeText={(text) => {
              setTwoFactorCode(
                twoFactorMode === "totp"
                  ? text.replace(/\D/g, "").slice(0, 6)
                  : text
                      .replace(/[^a-fA-F0-9]/g, "")
                      .slice(0, 32)
                      .toUpperCase(),
              );
              setTwoFactorError(null);
            }}
            error={twoFactorError ?? undefined}
            keyboardType={twoFactorMode === "totp" ? "number-pad" : "default"}
            autoComplete={twoFactorMode === "totp" ? "one-time-code" : "off"}
            maxLength={twoFactorMode === "totp" ? 6 : 32}
            autoFocus
          />

          <View style={{ marginTop: Spacing.sm }}>
            <Button
              title="Verify"
              onPress={handleTwoFactorSubmit}
              loading={twoFactorSubmitting}
              disabled={
                twoFactorSubmitting ||
                twoFactorCode.length !== (twoFactorMode === "totp" ? 6 : 32)
              }
            />
          </View>

          <TouchableOpacity
            style={{ marginTop: Spacing.sm, alignItems: "center" }}
            disabled={twoFactorSubmitting}
            onPress={() => {
              setPendingTwoFactor(null);
              setTwoFactorCode("");
              setTwoFactorMode("totp");
              setTwoFactorError(null);
            }}
            accessibilityRole="button"
          >
            <Text
              style={{
                color: colors.primary,
                fontSize: 14,
                fontWeight: "500",
              }}
            >
              Use a different account
            </Text>
          </TouchableOpacity>
        </Card>
      ) : (
        <Card>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={form.values.email}
            onChangeText={(text) => {
              form.handleChange("email")(text);
            }}
            onBlur={form.handleBlur("email")}
            error={
              form.touched.email || hasAttemptedSubmit
                ? form.errors.email
                : undefined
            }
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />

          <View style={styles.passwordWrapper}>
            <Input
              label="Password"
              placeholder="Enter your password"
              value={form.values.password}
              onChangeText={(text) => {
                form.handleChange("password")(text);
              }}
              onBlur={form.handleBlur("password")}
              error={
                form.touched.password || hasAttemptedSubmit
                  ? form.errors.password
                  : undefined
              }
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              textContentType="password"
            />

            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowPassword((previous) => !previous)}
              accessibilityRole="button"
              accessibilityLabel={
                showPassword ? "Hide password" : "Show password"
              }
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={22}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              style={styles.checkboxContainer}
              disabled={form.isSubmitting || biometricSubmitting}
              onPress={() =>
                form.handleChange("rememberMe")(!form.values.rememberMe)
              }
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: !!form.values.rememberMe,
              }}
              accessibilityLabel="Remember me"
            >
              <Ionicons
                name={form.values.rememberMe ? "checkbox" : "square-outline"}
                size={22}
                color={
                  form.values.rememberMe ? colors.primary : colors.textSecondary
                }
              />
              <Text style={styles.checkboxLabel}>Remember me</Text>
            </TouchableOpacity>

            <Link href="/(auth)/forgot-password" asChild>
              <TouchableOpacity>
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 14,
                    fontWeight: "500",
                  }}
                >
                  Forgot password?
                </Text>
              </TouchableOpacity>
            </Link>
          </View>

          <View style={{ marginTop: Spacing.sm }}>
            <Button
              title="Sign In"
              onPress={handleLoginPress}
              loading={form.isSubmitting}
              disabled={form.isSubmitting || biometricSubmitting}
            />
          </View>

          {isBiometricSupported && (
            <>
              <View style={styles.dividerContainer}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>Or sign in with</Text>
                <View style={styles.divider} />
              </View>

              <View style={styles.biometricSection}>
                <TouchableOpacity
                  onPress={handleBiometricAuth}
                  disabled={form.isSubmitting || biometricSubmitting}
                  style={[
                    styles.biometricButton,
                    (form.isSubmitting || biometricSubmitting) && {
                      opacity: 0.6,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in using Face ID or fingerprint"
                  accessibilityState={{
                    disabled: form.isSubmitting || biometricSubmitting,
                    busy: biometricSubmitting,
                  }}
                >
                  <Ionicons
                    name="finger-print"
                    size={32}
                    color={colors.primary}
                  />
                </TouchableOpacity>

                <Text style={styles.biometricHint}>
                  {biometricSubmitting
                    ? "Waiting for authentication..."
                    : "Face ID or Fingerprint"}
                </Text>
              </View>
            </>
          )}
        </Card>
      )}

      {!pendingTwoFactor && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>

          <Link href="/(auth)/register" asChild>
            <TouchableOpacity>
              <Text style={styles.link}>Sign up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      )}
    </AuthScreen>
  );
}
