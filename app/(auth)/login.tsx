import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Link, useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";
import { useColors } from "@/context/ThemeContext";
import { Spacing, BORDER_RADIUS } from "@/constants";
import { api } from "../../services/api";
import { switchLocalUser } from "../../services/localDatabase";
import {
  loginSchema,
  type LoginInput,
  validateSchema,
} from "@/shared/validation";
import { feedbackService, useFeedbackService } from "../../services/feedbackService";

export default function LoginScreen() {
  const router = useRouter();
  const colors = useColors();
  const [showPassword, setShowPassword] = useState(false);

  useFeedbackService();

  const [pendingTwoFactor, setPendingTwoFactor] = useState<{
    email: string;
    password: string;
    rememberMe: boolean;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);

  const completeLogin = useCallback(
    async (
      response: { token?: string; user?: { id: number } },
      rememberMe: boolean,
      email: string,
    ) => {
      if (response?.token) {
        await SecureStore.setItemAsync("userToken", response.token);
      }
      if (response?.user?.id != null) {
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

  const handleTwoFactorSubmit = async () => {
    if (!pendingTwoFactor) return;

    const code = twoFactorCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setTwoFactorError("Enter the 6-digit code from your authenticator app.");
      feedbackService.error("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setTwoFactorSubmitting(true);
    setTwoFactorError(null);

    try {
      const response = await api.auth.login({
        email: pendingTwoFactor.email,
        password: pendingTwoFactor.password,
        totpCode: code,
      });

      if (response?.requiresTwoFactor) {
        setTwoFactorError("That code was not accepted. Try the next one.");
        feedbackService.error("That code was not accepted. Try the next one.");
        setTwoFactorCode("");
        return;
      }

      await completeLogin(response, pendingTwoFactor.rememberMe, pendingTwoFactor.email);
      setPendingTwoFactor(null);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setTwoFactorError("That code was not accepted. Try the next one.");
        feedbackService.error("That code was not accepted. Try the next one.");
        setTwoFactorCode("");
      } else if (status === 429) {
        setTwoFactorError("Too many attempts. Please wait and try again.");
        feedbackService.warning("Too many attempts. Please wait and try again.");
      } else if (!err?.response) {
        setTwoFactorError("Network error. Check your connection and try again.");
        feedbackService.error("Network error. Check your connection and try again.");
      } else {
        const message = err?.response?.data?.error ?? "Something went wrong. Try again.";
        setTwoFactorError(message);
        feedbackService.error(message);
      }
    } finally {
      setTwoFactorSubmitting(false);
    }
  };

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const secureSetting = await SecureStore.getItemAsync("biometricEnabled");
      const asyncSetting = await AsyncStorage.getItem("biometricEnabled");
      const hasToken = (await SecureStore.getItemAsync("userToken")) !== null;

      const isEnabled =
        secureSetting === "true" ||
        asyncSetting === "true" ||
        hasToken;

      setIsBiometricSupported(compatible && enrolled && isEnabled);
    })();
  }, []);

  const form = useForm<LoginInput>({
    initialValues: { email: "", password: "", rememberMe: false },
    validate: (values: LoginInput) => {
      const result = validateSchema(loginSchema, values);
      if (result.success) {
        return {};
      }
      return result.errors as Partial<Record<keyof LoginInput, string>>;
    },
    onSubmit: async (values) => {
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
        let errorMessage = "Please check your credentials and try again.";

        if (!err?.response) {
          errorMessage =
            "Network error. Please check your internet connection.";
        } else if (status === 429) {
          errorMessage =
            "Too many failed attempts. Please wait before trying again.";
        } else if (status >= 500) {
          errorMessage =
            "Something went wrong on our servers. Please try again later.";
        } else if (err?.response?.data?.error) {
          errorMessage = err.response.data.error;
        }

        feedbackService.error(errorMessage);
      }
    },
  });

  const handleBiometricAuth = () => {
    router.push("/(auth)/biometric-login" as any);
  };

  const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 32 },
    header: { alignItems: "center", marginBottom: 32, marginTop: 16 },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    subtitle: { fontSize: 15, color: colors.textSecondary, textAlign: "center" },
    passwordWrapper: { position: "relative" },
    eyeIcon: { position: "absolute", right: 16, top: 36 },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginVertical: Spacing.sm,
    },
    checkboxContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
    checkboxLabel: { color: colors.textSecondary, fontSize: 14 },
    errorText: {
      color: colors.error,
      marginBottom: 12,
      textAlign: "center",
      fontSize: 14,
    },
    biometricSection: { marginTop: 32, alignItems: "center" },
    dividerContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 24,
      gap: 12,
    },
    divider: { flex: 1, height: 1, backgroundColor: colors.border },
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
    footerText: { color: colors.textSecondary, fontSize: 14 },
    link: { color: colors.primary, fontSize: 14, fontWeight: "600" },
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
                disabled={twoFactorCode.length !== 6}
              />
            </View>

            <TouchableOpacity
              style={{ marginTop: Spacing.sm, alignItems: "center" }}
              onPress={() => {
                setPendingTwoFactor(null);
                setTwoFactorCode("");
                setTwoFactorError(null);
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "500" }}>
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
              onChangeText={form.handleChange("email")}
              onBlur={form.handleBlur("email")}
              error={form.touched.email ? form.errors.email : undefined}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />

            <View style={styles.passwordWrapper}>
              <Input
                label="Password"
                placeholder="••••••••"
                value={form.values.password}
                onChangeText={form.handleChange("password")}
                onBlur={form.handleBlur("password")}
                error={form.touched.password ? form.errors.password : undefined}
                secureTextEntry={!showPassword}
                autoComplete="password"
                textContentType="password"
              />
              <TouchableOpacity
                style={styles.eyeIcon}
                onPress={() => setShowPassword(!showPassword)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
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
                disabled={form.isSubmitting}
                onPress={() =>
                  form.handleChange("rememberMe")(!form.values.rememberMe)
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!form.values.rememberMe }}
                accessibilityLabel="Remember me"
              >
                <Ionicons
                  name={form.values.rememberMe ? "checkbox" : "square-outline"}
                  size={22}
                  color={form.values.rememberMe ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.checkboxLabel}>Remember me</Text>
              </TouchableOpacity>

              <Link href="/(auth)/forgot-password" asChild>
                <TouchableOpacity>
                  <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "500" }}>
                    Forgot password?
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>

            <View style={{ marginTop: Spacing.sm }}>
              <Button
                title="Sign In"
                onPress={form.handleSubmit}
                loading={form.isSubmitting}
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
                    disabled={form.isSubmitting}
                    style={styles.biometricButton}
                    accessibilityRole="button"
                    accessibilityLabel="Sign in using Face ID or fingerprint"
                  >
                    <Ionicons
                      name="finger-print"
                      size={32}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  <Text style={styles.biometricHint}>Face ID or Fingerprint</Text>
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
