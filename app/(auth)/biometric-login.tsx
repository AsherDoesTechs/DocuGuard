import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { Link, useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";

import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";

import { useColors } from "@/context/ThemeContext";
import { api } from "../../services/api";
import { establishAuthenticatedSession } from "../../services/authSession";
import {
  loginSchema,
  type LoginInput,
  validateSchema,
} from "@/shared/validation";
import { feedbackService } from "../../services/feedbackService";
import { useFeedbackService } from "../../services/feedbackService";

const WELCOME_VISIT_KEY = "docuguardWelcomeVisitCount";

export default function BiometricLoginScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [welcome, setWelcome] = useState({
    title: "Welcome to DocuGuard",
    subtitle: "Your important documents, organized and protected.",
  });

  useFeedbackService();

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Load a personalized greeting when this screen opens.
  useEffect(() => {
    let isActive = true;

    const loadWelcomeMessage = async () => {
      try {
        const storedCount = await SecureStore.getItemAsync(WELCOME_VISIT_KEY);

        const previousCount = storedCount ? Number(storedCount) : 0;

        const visitCount =
          Number.isFinite(previousCount) && previousCount >= 0
            ? previousCount + 1
            : 1;

        await SecureStore.setItemAsync(WELCOME_VISIT_KEY, String(visitCount));

        const hour = new Date().getHours();

        const timeGreeting =
          hour < 12
            ? "Good morning"
            : hour < 18
              ? "Good afternoon"
              : "Good evening";

        let title: string;
        let subtitle: string;

        if (visitCount === 1) {
          title = "Welcome to DocuGuard";
          subtitle = "Your important documents, organized and protected.";
        } else if (visitCount < 5) {
          title = `${timeGreeting}, welcome back!`;
          subtitle = "Your secure document vault is ready when you are.";
        } else {
          title = `${timeGreeting}!`;
          subtitle =
            "Good to see you again. Your documents are ready when you are.";
        }

        if (isActive) {
          setWelcome({ title, subtitle });
        }
      } catch (error) {
        // Keep the default greeting if saved visit data is unavailable.
        console.warn("Unable to load welcome message:", error);
      }
    };

    void loadWelcomeMessage();

    return () => {
      isActive = false;
    };
  }, []);

  // Subtle fingerprint animation. Stop it when the screen unmounts.
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

  // Check device biometric support and the app's biometric setting.
  useEffect(() => {
    let isActive = true;

    const checkBiometricSupport = async () => {
      try {
        const [compatible, enrolled, storedCredentials, activeUserIdRaw, lastSignedOutRaw] =
          await Promise.all([
            LocalAuthentication.hasHardwareAsync(),
            LocalAuthentication.isEnrolledAsync(),
            SecureStore.getItemAsync("secure_user_credentials"),
            SecureStore.getItemAsync("docuguard.localUserId"),
            SecureStore.getItemAsync("docuguard.lastSignedOutUserId"),
          ]);

        const activeUserId = activeUserIdRaw ? Number(activeUserIdRaw) : NaN;
        const activeId =
          Number.isSafeInteger(activeUserId) && activeUserId > 0 ? activeUserId : null;
        const lastSignedOut = lastSignedOutRaw ? Number(lastSignedOutRaw) : NaN;
        const lastSignedOutId =
          Number.isSafeInteger(lastSignedOut) && lastSignedOut > 0 ? lastSignedOut : null;

        let parsed: { userId?: number } | null = null;
        if (storedCredentials) {
          try {
            parsed = JSON.parse(storedCredentials) as { userId?: number };
          } catch {
            parsed = null;
          }
        }
        const credentialUserId =
          parsed && typeof parsed.userId === "number" && Number.isSafeInteger(parsed.userId) && parsed.userId > 0
            ? parsed.userId
            : null;

        const effectiveId = activeId ?? credentialUserId ?? lastSignedOutId;

        const credentialsForCurrentUser =
          !!storedCredentials &&
          credentialUserId !== null &&
          (effectiveId === null || credentialUserId === effectiveId) &&
          typeof (parsed as any)?.email === "string" &&
          typeof (parsed as any)?.password === "string";

        let biometricSetting: string | null = null;
        if (effectiveId !== null) {
          biometricSetting = await SecureStore.getItemAsync(
            `docuguard.security.biometricEnabled.user.${effectiveId}`,
          );
          if (biometricSetting === null) {
            const legacy = await SecureStore.getItemAsync(
              "docuguard.security.biometricEnabled",
            );
            if (legacy !== null) {
              await SecureStore.setItemAsync(
                `docuguard.security.biometricEnabled.user.${effectiveId}`,
                legacy,
              );
              biometricSetting = legacy;
            }
          }
          if (biometricSetting === null && credentialsForCurrentUser) {
            await SecureStore.setItemAsync(
              `docuguard.security.biometricEnabled.user.${effectiveId}`,
              "true",
            );
            biometricSetting = "true";
          }
        }

        if (isActive) {
          setIsBiometricSupported(
            compatible &&
              enrolled &&
              biometricSetting === "true",
          );
        }
      } catch (error) {
        console.warn("Unable to check biometric support:", error);

        if (isActive) {
          setIsBiometricSupported(false);
        }
      }
    };

    void checkBiometricSupport();

    return () => {
      isActive = false;
    };
  }, []);

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
      try {
        const normalizedValues = {
          ...values,
          email: values.email.trim().toLowerCase(),
        };

        const response = await api.auth.login(normalizedValues);

        // Never establish a session before completing the required 2FA challenge.
        if (response?.requiresTwoFactor) {
          router.push({
            pathname: "/(auth)/verify-2fa" as any,
            params: {
              email: normalizedValues.email,
              password: values.password,
            },
          });
          return;
        }

        const userId = response?.user?.id;

        if (
          !response?.token ||
          typeof userId !== "number" ||
          !Number.isSafeInteger(userId) ||
          userId <= 0
        ) {
          throw new Error("The server did not return a complete authenticated session.");
        }

        await establishAuthenticatedSession(response.token, userId);

        // Securely cache credentials for biometrics if password is provided.
        try {
          await SecureStore.setItemAsync(
            "secure_user_credentials",
            JSON.stringify({
              email: normalizedValues.email,
              password: values.password,
              userId,
            }),
          );
          const perUserKey = `docuguard.security.biometricEnabled.user.${userId}`;
          const existingBio = await SecureStore.getItemAsync(perUserKey);
          if (existingBio === null) {
            const legacyBio = await SecureStore.getItemAsync(
              "docuguard.security.biometricEnabled",
            );
            if (legacyBio === "true") {
              await SecureStore.setItemAsync(perUserKey, "true");
            }
          }
        } catch (error) {
          console.warn("[BiometricLogin] Failed to save biometric credentials.", error);
        }

        // Remember only the email, never the password.
        try {
          if (values.rememberMe) {
            await SecureStore.setItemAsync(
              "rememberedEmail",
              normalizedValues.email,
            );
          } else {
            await SecureStore.deleteItemAsync("rememberedEmail");
          }
        } catch (error) {
          console.warn("[BiometricLogin] Remembered-email update failed.", error);
        }

        router.replace("/(tabs)/documents" as any);
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

  // Authenticate using the device's enrolled biometric method.
  const handleBiometricAuth = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        feedbackService.alert({
          title: "Biometrics Unavailable",
          message:
            "Please set up fingerprint recognition or face authentication in your device settings first.",
          type: "warning",
        });
        return;
      }

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

      const response = await api.auth.login({ email, password });

      if (response?.requiresTwoFactor) {
        router.push({
          pathname: "/(auth)/verify-2fa" as any,
          params: { email: email.trim().toLowerCase(), password },
        });
        return;
      }

      const userId = response?.user?.id;
      if (
        !response?.token ||
        typeof userId !== "number" ||
        !Number.isSafeInteger(userId) ||
        userId <= 0
      ) {
        throw new Error("Could not refresh session via biometrics.");
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
      await SecureStore.setItemAsync(
        "secure_user_credentials",
        JSON.stringify({ email, password, userId }),
      );

      router.replace("/(tabs)/documents" as any);
    } catch (error) {
      console.warn("Biometric authentication failed:", error);

      feedbackService.error(
        "An unexpected error occurred during biometric validation. Please try again.",
      );
    }
  };

  return (
    <AuthScreen
      title={welcome.title}
      subtitle={welcome.subtitle}
      icon="finger-print-outline"
    >
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
            disabled={form.isSubmitting}
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
                style={[styles.forgotPasswordText, { color: colors.primary }]}
              >
                Forgot password?
              </Text>
            </TouchableOpacity>
          </Link>
        </View>

        <View style={styles.signInButton}>
          <Button
            title="Sign In"
            onPress={form.handleSubmit}
            loading={form.isSubmitting}
          />
        </View>
      </Card>

      {isBiometricSupported && (
        <View style={styles.biometricSection}>
          <Text style={[styles.orText, { color: colors.textSecondary }]}>
            OR USE BIOMETRICS
          </Text>

          <TouchableOpacity
            onPress={handleBiometricAuth}
            style={styles.fingerprintButton}
            disabled={form.isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Sign in using fingerprint or face authentication"
          >
            <Animated.View
              style={[
                styles.fingerprintRing,
                {
                  backgroundColor: colors.primaryLight,
                  borderColor: colors.primary,
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            >
              <Ionicons name="finger-print" size={40} color={colors.primary} />
            </Animated.View>
          </TouchableOpacity>

          <Text style={[styles.biometricHint, { color: colors.textSecondary }]}>
            Use Face ID or Fingerprint
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          Don't have an account?{" "}
        </Text>

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity>
            <Text style={[styles.link, { color: colors.primary }]}>
              Sign up
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </AuthScreen>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  passwordWrapper: {
    position: "relative",
    width: "100%",
  },

  eyeIcon: {
    position: "absolute",
    right: 14,
    top: 39,
    height: 44,
    width: 36,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 12,
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

  forgotPasswordText: {
    fontSize: 14,
    fontWeight: "500",
  },

  signInButton: {
    marginTop: 12,
  },

  biometricSection: {
    marginTop: 32,
    alignItems: "center",
  },

  orText: {
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
    justifyContent: "center",
    alignItems: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },

  biometricHint: {
    marginTop: 8,
    fontSize: 12,
  },

  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 32,
    paddingBottom: 20,
  },

  footerText: {
    fontSize: 14,
  },

  link: {
    fontSize: 14,
    fontWeight: "600",
  },
});
