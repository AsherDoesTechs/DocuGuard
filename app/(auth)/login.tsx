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
import { Link, useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { isValidEmail } from "../../utils";
import { COLORS } from "../../constants";
import { api } from "../../services/api";

export default function LoginScreen() {
  const router = useRouter();
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for biometric button
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulseAnim]);

  // Check biometric support
  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsBiometricSupported(compatible && enrolled);
    })();
  }, []);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: (values: any) => {
      const errors: Record<string, string> = {};
      if (!values.email) errors.email = "Email is required";
      else if (!isValidEmail(values.email))
        errors.email = "Invalid email format";
      if (!values.password) errors.password = "Password is required";
      return errors;
    },
    onSubmit: async (values) => {
      try {
        await api.auth.login({ ...values, rememberMe });
        router.replace("/(tabs)/documents" as any);
      } catch (err) {
        console.error("Login crashed", err);
      }
    },
  });

  const handleBiometricAuth = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Sign in with Biometrics",
      fallbackLabel: "Use Password",
    });

    if (result.success) {
      router.replace("/(tabs)/home" as any);
    } else {
      Alert.alert(
        "Authentication failed",
        "Please try again or use your password.",
      );
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
          />
          <TouchableOpacity
            style={styles.eyeIcon}
            onPress={() => setShowPassword(!showPassword)}
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
            onPress={() => setRememberMe(!rememberMe)}
          >
            <Ionicons
              name={rememberMe ? "checkbox" : "square-outline"}
              size={22}
              color={rememberMe ? COLORS.primary : COLORS.textSecondary}
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
          >
            <Animated.View
              style={[
                styles.fingerprintRing,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <Ionicons name="finger-print" size={40} color={COLORS.primary} />
            </Animated.View>
          </TouchableOpacity>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20 },
  header: { alignItems: "center", marginBottom: 40, marginTop: 40 },
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
    marginBottom: 15,
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
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 40,
    paddingBottom: 40,
  },
  footerText: { color: COLORS.textSecondary, fontSize: 14 },
  link: { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
});
