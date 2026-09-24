import React, { useState, useEffect, useRef } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";
import {
  loginSchema,
  type LoginInput,
  validateSchema,
} from "@/shared/validation";

export default function LoginScreen() {
  const router = useRouter();
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // 6. Stop the pulse animation when the screen unmounts
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04, // Subtler scaling effect
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

  // 3 & 4. Check hardware capability, OS enrollment, and app-level biometric toggle
  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const biometricSetting =
        await SecureStore.getItemAsync("biometricEnabled");

      setIsBiometricSupported(
        compatible && enrolled && biometricSetting === "true",
      );
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
        // 11. Email normalization
        const normalizedValues = {
          ...values,
          email: values.email.trim().toLowerCase(),
        };

        const response = await api.auth.login(normalizedValues);

        // 2 & 3. Store token securely using standardized SecureStore
        if (response?.data?.token) {
          await SecureStore.setItemAsync("userToken", response.data.token);
        }

        // Handle rememberMe persistence securely
        if (values.rememberMe) {
          await SecureStore.setItemAsync(
            "rememberedEmail",
            normalizedValues.email,
          );
        } else {
          await SecureStore.deleteItemAsync("rememberedEmail");
        }

        router.replace("/(tabs)/documents" as any);
      } catch (err: any) {
        // 9. Improved error handling feedback
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

  // Simplified and secure native biometric prompt handling
  const handleBiometricAuth = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        Alert.alert(
          "Biometrics Unavailable",
          "Please set up Face ID or fingerprint recognition on your device settings first.",
        );
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock your DocuGuard vault",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });

      if (!result.success) {
        return; // User cancelled or failed authentication gracefully
      }

      const token = await SecureStore.getItemAsync("userToken");
      if (!token) {
        Alert.alert(
          "Session Expired",
          "Please sign in with your password first to re-establish your secure session.",
        );
        return;
      }

      // Navigate straight into documents vault upon verified biometric match
      router.replace("/(tabs)/documents" as any);
    } catch (error) {
      Alert.alert(
        "Authentication Error",
        "An unexpected error occurred during biometric validation. Please try again.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>
            Sign in to access your secure documents
          </Text>
        </View>

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
            />
          </View>
        </Card>

        {isBiometricSupported && (
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

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity>
              <Text style={styles.link}>Sign up</Text>
            </TouchableOpacity>
          </Link>
        </View>
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
