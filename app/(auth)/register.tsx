import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";
import {
  registerSchema,
  type RegisterInput,
  validateSchema,
} from "@/shared/validation";

interface RegisterFormValues extends RegisterInput {
  firstName: string;
  lastName: string;
}

export default function RegisterScreen() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const getPasswordStrength = (password: string) => {
    if (!password)
      return {
        score: 0,
        label: "Enter a password",
        color: COLORS.textSecondary,
      };
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 1) return { score: 20, label: "Weak", color: "#EF4444" };
    if (score === 2) return { score: 40, label: "Fair", color: "#F59E0B" };
    if (score === 3) return { score: 60, label: "Good", color: "#3B82F6" };
    if (score === 4) return { score: 80, label: "Strong", color: "#10B981" };
    return { score: 100, label: "Very strong", color: "#8B5CF6" };
  };

  const validate = (values: RegisterFormValues) => {
    const fullName = `${values.firstName.trim()} ${values.lastName.trim()}`;
    const normalizedEmail = values.email.trim().toLowerCase();

    const valuesToValidate = {
      name: fullName,
      email: normalizedEmail,
      password: values.password,
      confirmPassword: values.confirmPassword,
    };

    const result = validateSchema(registerSchema, valuesToValidate);
    if (result.success) {
      return {};
    }
    return result.errors as Partial<Record<keyof RegisterFormValues, string>>;
  };

  const form = useForm<RegisterFormValues>({
    initialValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      name: "",
    },
    validate,
    onSubmit: async (values) => {
      setServerError(null);

      const fullName = `${values.firstName.trim()} ${values.lastName.trim()}`;
      const normalizedEmail = values.email.trim().toLowerCase();

      try {
        const payload = {
          name: fullName,
          email: normalizedEmail,
          password: values.password,
        };

        const response = await api.auth.register(payload);

        if (response?.emailSent === false) {
          Alert.alert(
            "Email Delivery Issue",
            "Your account was created, but verification email could not be sent. You can try resending from the next screen.",
            [{ text: "Continue" }],
          );
        }

        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: normalizedEmail },
        } as any);
      } catch (err: any) {
        const errorMsg =
          err?.response?.data?.error ||
          "Could not create account. Please try again.";
        setServerError(errorMsg);
      }
    },
  });

  const pwdStats = getPasswordStrength(form.values.password);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Secure your personal identity documents today
          </Text>
        </View>

        <Card>
          {serverError && <Text style={styles.errorText}>{serverError}</Text>}

          <Input
            label="First name"
            placeholder="John"
            value={form.values.firstName}
            onChangeText={(text) => {
              const cleanText = text.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");
              if (cleanText.length <= 50) {
                form.handleChange("firstName")(cleanText);
              }
            }}
          />

          <Input
            label="Last name"
            placeholder="Doe"
            value={form.values.lastName}
            onChangeText={(text) => {
              const cleanText = text.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");
              if (cleanText.length <= 50) {
                form.handleChange("lastName")(cleanText);
              }
            }}
          />

          <Input
            label="Email address"
            placeholder="you@example.com"
            value={form.values.email}
            onChangeText={form.handleChange("email")}
            onBlur={form.handleBlur("email")}
            error={form.touched.email ? form.errors.email : undefined}
            keyboardType="email-address"
          />

          <Input
            label="Password"
            placeholder="••••••••"
            value={form.values.password}
            onChangeText={form.handleChange("password")}
            onBlur={form.handleBlur("password")}
            error={form.touched.password ? form.errors.password : undefined}
            secureTextEntry
          />

          {form.values.password.length > 0 && (
            <View style={styles.strengthContainer}>
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${pwdStats.score}%`,
                      backgroundColor: pwdStats.color,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.strengthLabel, { color: pwdStats.color }]}>
                {pwdStats.label}
              </Text>
            </View>
          )}

          <Input
            label="Confirm Password"
            placeholder="••••••••"
            value={form.values.confirmPassword || ""}
            onChangeText={form.handleChange("confirmPassword")}
            onBlur={form.handleBlur("confirmPassword")}
            error={
              form.touched.confirmPassword
                ? form.errors.confirmPassword
                : undefined
            }
            secureTextEntry
          />

          <View style={{ marginTop: 20 }}>
            <Button
              title="Create Account"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
            />
          </View>
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" asChild>
            <Text style={styles.link}>Sign in</Text>
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40 },
  header: { alignItems: "center", marginBottom: 30, marginTop: 20 },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  errorText: {
    color: COLORS.danger,
    marginBottom: 12,
    textAlign: "center",
    fontSize: 14,
  },
  strengthContainer: { marginBottom: 16, marginTop: -4 },
  progressBarBackground: {
    height: 6,
    backgroundColor: "#E5E7EB",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressBarFill: { height: "100%", borderRadius: 3 },
  strengthLabel: { fontSize: 12, fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
  footerText: { color: COLORS.textSecondary, fontSize: 14 },
  link: { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
});
