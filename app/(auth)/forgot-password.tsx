import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";
import { Spacing } from "../../constants";
import { useColors } from "@/context/ThemeContext";
import { api } from "../../services/api";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
  validateSchema,
} from "@/shared/validation";
import { feedbackService, useFeedbackService } from "../../services/feedbackService";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colors = useColors();
  const [serverError, setServerError] = useState<string | null>(null);

  // Initialize feedback service
  useFeedbackService();

  const validate = (values: ForgotPasswordInput) => {
    const result = validateSchema(forgotPasswordSchema, values);
    if (result.success) {
      return {};
    }
    return result.errors as Partial<Record<keyof ForgotPasswordInput, string>>;
  };

  const form = useForm<ForgotPasswordInput>({
    initialValues: { email: "" },
    validate,
    onSubmit: async (values) => {
      setServerError(null);
      const email = values.email.trim().toLowerCase();

      try {
        await api.auth.forgotPassword({ email });

        await feedbackService.confirm({
          title: "Check Your Email",
          message: "If an account exists with that email, instructions and a secure link to reset your password have been sent.",
          confirmText: "OK",
          onConfirm: () => router.replace("/(auth)/login" as any),
        });
      } catch (err: any) {
        console.error("Forgot password request failed:", err);
        setServerError(
          "We couldn't process that request. Please try again in a moment.",
        );
        feedbackService.error(
          "We couldn't process that request. Please try again in a moment.",
        );
      }
    },
  });

  return (
    <AuthScreen
      title="Reset Password"
      subtitle="Enter your email to receive a secure reset link"
      icon="mail-outline"
    >
        <Card>
          {serverError && <Text style={[styles.errorText, { color: colors.error }]}>{serverError}</Text>}

          <Input
            label="Email"
            placeholder="you@example.com"
            value={form.values.email}
            onChangeText={form.handleChange("email")}
            onBlur={form.handleBlur("email")}
            error={form.touched.email ? form.errors.email : undefined}
            keyboardType="email-address"
          />

          <View style={{ marginTop: Spacing.sm }}>
            <Button
              title="Send Reset Link"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
            />
          </View>
        </Card>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Remember your password?{" "}
          </Text>
          <Link href="/(auth)/login" asChild>
            <Text style={[styles.link, { color: colors.primary }]}>Sign in</Text>
          </Link>
        </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  errorText: {
    marginBottom: 12,
    textAlign: "center",
    fontSize: 14,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
  },
  footerText: {
    fontSize: 14,
  },
  link: {
    fontSize: 14,
    fontWeight: "600",
  },
});
