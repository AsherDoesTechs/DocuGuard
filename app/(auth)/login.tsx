import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Link, useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";

import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants";
import { api } from "../../services/api";
import { switchLocalUser } from "../../services/localDatabase";
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
    ) => {
      if (!response?.token) {
        throw new Error("The server did not return a valid session.");
      }

      await SecureStore.setItemAsync("userToken", response.token);

      if (response.user?.id != null) {
        await switchLocalUser(response.user.id);
      }

      if (rememberMe) {
        await SecureStore.setItemAsync("rememberedEmail", email);
      } else {
        await SecureStore.deleteItemAsync("rememberedEmail");
      }

      router.replace("/(tabs)/documents" as any);
    },
    [router],
  );

  // Check biometric availability without allowing native API failures
  // to crash the login screen.
  useEffect(() => {
    let mounted = true;

    const checkBiometricSupport = async () => {
      try {
        const [hasHardware, isEnrolled, biometricSetting] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          SecureStore.getItemAsync("biometricEnabled"),
        ]);

        if (mounted) {
          setIsBiometricSupported(
            hasHardware && isEnrolled && biometricSetting === "true",
          );
        }
      } catch (error) {
        console.warn("Unable to check biometric availability:", error);

        if (mounted) {
          setIsBiometricSupported(false);
        }
      }
    };

    void checkBiometricSupport();

    return () => {
      mounted = false;
    };
  }, []);

  const handleTwoFactorSubmit = async () => {
    if (!pendingTwoFactor || twoFactorRequestRef.current) {
      return;
    }

    const code = twoFactorCode.trim();

    if (!/^\d{6}$/.test(code)) {
      setTwoFactorError(
        "Enter the complete 6-digit code from your authenticator app.",
      );
      feedbackService.warning(
        "Enter the complete 6-digit code from your authenticator app.",
      );
      return;
    }

    twoFactorRequestRef.current = true;
    setTwoFactorSubmitting(true);
    setTwoFactorError(null);

    try {
      const response = await api.auth.login({
        email: pendingTwoFactor.email,
        password: pendingTwoFactor.password,
        totpCode: code,
      });

      if (response?.requiresTwoFactor) {
        const message = "That code was not accepted. Try the next one.";

        setTwoFactorError(message);
        setTwoFactorCode("");
        feedbackService.error(message);
        return;
      }

      await completeLogin(
        response,
        pendingTwoFactor.rememberMe,
        pendingTwoFactor.email,
      );

      setPendingTwoFactor(null);
      setTwoFactorCode("");
    } catch (err: any) {
      const status = err?.response?.status;

      if (status === 401) {
        const message = "That code was not accepted. Try the next one.";

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

      // Cancellation is intentional and should not produce an error.
      if (!result.success) {
        return;
      }

      const token = await SecureStore.getItemAsync("userToken");

      if (!token) {
        feedbackService.alert({
          title: "Session expired",
          message:
            "Please sign in with your password first to re-establish your secure session.",
          type: "warning",
        });
        return;
      }

      router.replace("/(tabs)/documents" as any);
    } catch (error) {
      console.warn("Biometric sign-in failed:", error);

      feedbackService.error(
        "Biometric sign-in is unavailable right now. Please use your password.",
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
          <Input
            label="Verification Code"
            placeholder="000000"
            value={twoFactorCode}
            onChangeText={(text) => {
              setTwoFactorCode(text.replace(/\D/g, "").slice(0, 6));
              setTwoFactorError(null);
            }}
            error={twoFactorError ?? undefined}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
          />

          <View style={{ marginTop: Spacing.sm }}>
            <Button
              title="Verify"
              onPress={handleTwoFactorSubmit}
              loading={twoFactorSubmitting}
              disabled={twoFactorSubmitting || twoFactorCode.length !== 6}
            />
          </View>

          <TouchableOpacity
            style={{ marginTop: Spacing.sm, alignItems: "center" }}
            disabled={twoFactorSubmitting}
            onPress={() => {
              setPendingTwoFactor(null);
              setTwoFactorCode("");
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
