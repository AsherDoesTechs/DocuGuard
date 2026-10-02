import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";
import { switchLocalUser } from "../../services/localDatabase";
import {
  loginSchema,
  type LoginInput,
  validateSchema,
} from "@/shared/validation";

export default function LoginScreen() {
  const router = useRouter();
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Set when the server accepts the password but requires a TOTP code. The
  // password is held only in component state for the follow-up request.
  const [pendingTwoFactor, setPendingTwoFactor] = useState<{
    email: string;
    password: string;
    rememberMe: boolean;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  /** Completes login once a valid TOTP code has been supplied. */
  const completeLogin = useCallback(
    async (response: {
      token?: string;
      user?: { id: number };
    }, rememberMe: boolean, email: string) => {
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

  /** Submits the second factor and retries the login request with it. */
  const handleTwoFactorSubmit = async () => {
    if (!pendingTwoFactor) return;

    const code = twoFactorCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setTwoFactorError("Enter the 6-digit code from your authenticator app.");
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
        setTwoFactorCode("");
        return;
      }

      await completeLogin(response, pendingTwoFactor.rememberMe, pendingTwoFactor.email);
      setPendingTwoFactor(null);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setTwoFactorError("That code was not accepted. Try the next one.");
        setTwoFactorCode("");
      } else if (status === 429) {
        setTwoFactorError("Too many attempts. Please wait and try again.");
      } else if (!err?.response) {
        setTwoFactorError("Network error. Check your connection and try again.");
      } else {
        setTwoFactorError(
          err?.response?.data?.error ?? "Something went wrong. Try again.",
        );
      }
    } finally {
      setTwoFactorSubmitting(false);
    }
  };

  // Stop pulse animation on unmount
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  // Check hardware capability and look for biometric preference across stores
  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      // Check both SecureStore and AsyncStorage to see if biometrics were enabled previously
      const secureSetting = await SecureStore.getItemAsync("biometricEnabled");
      const asyncSetting = await AsyncStorage.getItem("biometricEnabled");

      const isEnabled =
        secureSetting === "true" ||
        asyncSetting === "true" ||
        // Fallback: If hardware is ready and user has logged in before (has a token/email stored)
        (await SecureStore.getItemAsync("userToken")) !== null;

      setIsBiometricSupported(compatible && enrolled && (isEnabled || true)); // Set to true if hardware/enrollment pass so users can set it up easily
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

        // The server returns no token when the account has TOTP enrolled; it
        // asks for a code instead. Without this branch the user was silently
        // signed out with no token and no explanation.
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

        Alert.alert("Login Failed", errorMessage);
      }
    },
  });

  const handleBiometricAuth = () => {
    router.push("/(auth)/biometric-login" as any);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>
            {pendingTwoFactor ? "Two-Factor Authentication" : "Welcome Back"}
          </Text>
          <Text style={styles.subtitle}>
            {pendingTwoFactor
              ? "Enter the 6-digit code from your authenticator app"
              : "Sign in to access your secure documents"}
          </Text>
        </View>

        {pendingTwoFactor ? (
          <Card>
            <Input
              label="Verification Code"
              placeholder="000000"
              value={twoFactorCode}
              onChangeText={(text) => {
                // Digits only, capped at 6, so the field cannot hold a value
                // the server will always reject.
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

            <View style={{ marginTop: 12 }}>
              <Button
                title="Verify"
                onPress={handleTwoFactorSubmit}
                loading={twoFactorSubmitting}
                disabled={twoFactorCode.length !== 6}
                feedbackType="success"
              />
            </View>

            <TouchableOpacity
              style={{ marginTop: 12, alignItems: "center" }}
              onPress={() => {
                setPendingTwoFactor(null);
                setTwoFactorCode("");
                setTwoFactorError(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.forgotPasswordText}>Use a different account</Text>
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
              accessibilityLabel={
                showPassword ? "Hide password" : "Show password"
              }
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={22}
                color={COLORS.textSecondary}
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
                color={
                  form.values.rememberMe ? COLORS.primary : COLORS.textSecondary
                }
              />
              <Text style={styles.checkboxLabel}>Remember me</Text>
            </TouchableOpacity>

            <Link href="/(auth)/forgot-password" asChild>
              <TouchableOpacity>
                <Text style={styles.forgotPasswordText}>Forgot password?</Text>
              </TouchableOpacity>
            </Link>
          </View>

          <View style={{ marginTop: 12 }}>
            <Button
              title="Sign In"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
              feedbackType="success"
            />
          </View>
        </Card>
        )}

        {isBiometricSupported && !pendingTwoFactor && (
          <View style={styles.biometricSection}>
            <Text style={styles.orText}>OR USE BIOMETRICS</Text>
            <TouchableOpacity
              onPress={handleBiometricAuth}
              style={styles.fingerprintButton}
              disabled={form.isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Sign in using Face ID or fingerprint"
            >
              <Animated.View
                style={[
                  styles.fingerprintRing,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              >
                <Ionicons
                  name="finger-print"
                  size={40}
                  color={COLORS.primary}
                />
              </Animated.View>
            </TouchableOpacity>
            <Text style={styles.biometricHint}>Use Face ID or Fingerprint</Text>
          </View>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20 },
  header: { alignItems: "center", marginBottom: 30, marginTop: 20 },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: "center" },
  passwordWrapper: { position: "relative" },
  eyeIcon: { position: "absolute", right: 18, top: 43 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 12,
  },
  checkboxContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkboxLabel: { color: COLORS.textSecondary, fontSize: 14 },
  forgotPasswordText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "500",
  },
  biometricSection: { marginTop: 30, alignItems: "center" },
  orText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 12,
    letterSpacing: 1,
  },
  fingerprintButton: {
    width: 80,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
  },
  fingerprintRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  biometricHint: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 30,
    paddingBottom: 20,
  },
  footerText: { color: COLORS.textSecondary, fontSize: 14 },
  link: { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
});
