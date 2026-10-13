import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { useColors } from "@/context/ThemeContext";
import { Spacing, COLORS } from "@/constants";
import { api } from "../../services/api";
import {
  registerSchema,
  type RegisterInput,
  validateSchema,
} from "@/shared/validation";
import { feedbackService, useFeedbackService } from "../../services/feedbackService";

interface RegisterFormValues extends RegisterInput {
  firstName: string;
  lastName: string;
}

export default function RegisterScreen() {
  const router = useRouter();
  const colors = useColors();
  const [serverError, setServerError] = useState<string | null>(null);

  useFeedbackService();

  const getPasswordStrength = (password: string) => {
    if (!password)
      return {
        score: 0,
        label: "Enter a password",
        color: colors.textSecondary,
      };
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 1) return { score: 20, label: "Weak", color: COLORS.danger };
    if (score === 2) return { score: 40, label: "Fair", color: COLORS.warning };
    if (score === 3) return { score: 60, label: "Good", color: COLORS.primary };
    if (score === 4) return { score: 80, label: "Strong", color: COLORS.success };
    return { score: 100, label: "Very strong", color: COLORS.success };
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
          await feedbackService.alert({
            title: "Email Delivery Issue",
            message: "Your account was created, but verification email could not be sent. You can try resending from the next screen.",
            type: "warning",
            buttons: [{ text: "Continue" }],
          });
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
        feedbackService.error(errorMsg);
      }
    },
  });

  const pwdStats = useMemo(
    () => getPasswordStrength(form.values.password),
    [form.values.password, colors.textSecondary],
  );

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
    errorText: {
      color: colors.error,
      marginBottom: 12,
      textAlign: "center",
      fontSize: 14,
    },
    strengthContainer: { marginBottom: 16, marginTop: Spacing.xs },
    progressBarBackground: {
      height: 6,
      backgroundColor: colors.border,
      borderRadius: 3,
      overflow: "hidden",
      marginBottom: 6,
    },
    progressBarFill: { height: "100%", borderRadius: 3 },
    strengthLabel: { fontSize: 12, fontWeight: "600" },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      marginTop: 24,
    },
    footerText: { color: colors.textSecondary, fontSize: 14 },
    link: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Secure your personal identity documents today
          </Text>
        </View>

        <Card>
          {serverError && <Text style={styles.errorText}>{serverError}</Text>}

          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
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
              style={{ flex: 1 }}
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
              style={{ flex: 1 }}
            />
          </View>

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

          <View style={{ marginTop: Spacing.sm }}>
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
