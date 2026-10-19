import React, { useRef, useState } from "react";
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
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colors = useColors();

  const [serverError, setServerError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Prevent rapid repeated taps before the loading state updates.
  const requestInProgressRef = useRef(false);

  useFeedbackService();

  const validate = (values: ForgotPasswordInput) => {
    const result = validateSchema(forgotPasswordSchema, values);

    if (result.success) {
      return {};
    }

    return result.errors as Partial<Record<keyof ForgotPasswordInput, string>>;
  };

  const form = useForm<ForgotPasswordInput>({
    initialValues: {
      email: "",
    },

    validate,

    onSubmit: async (values) => {
      if (requestInProgressRef.current) {
        return;
      }

      requestInProgressRef.current = true;
      setServerError(null);

      const email = values.email.trim().toLowerCase();

      try {
        await api.auth.forgotPassword({ email });

        // Keep the response generic so the UI does not disclose
        // whether the email is registered.
        await feedbackService.confirm({
          title: "Check Your Email",
          message:
            "If an account exists with that email, instructions and a secure link to reset your password have been sent.",
          confirmText: "OK",
          onConfirm: () => router.replace("/(auth)/login" as any),
          onCancel: () => {},
        });
      } catch (err: any) {
        const status = err?.response?.status;

        let message =
          "We couldn't process that request. Please try again in a moment.";

        if (!err?.response) {
          message =
            "Unable to connect. Check your internet connection and try again.";
        } else if (status === 429) {
          message =
            "Too many requests. Please wait a while before trying again.";
        } else if (status >= 500) {
          message =
            "The service is temporarily unavailable. Please try again later.";
        }

        setServerError(message);
        feedbackService.error(message);
      } finally {
        requestInProgressRef.current = false;
      }
    },
  });

  const handleSendResetLink = () => {
    if (requestInProgressRef.current || form.isSubmitting) {
      return;
    }

    setHasAttemptedSubmit(true);
    setServerError(null);

    const result = validateSchema(forgotPasswordSchema, {
      email: form.values.email.trim().toLowerCase(),
    });

    if (!result.success) {
      const errors = result.errors as Partial<
        Record<keyof ForgotPasswordInput, string>
      >;

      feedbackService.warning(
        errors.email ?? "Please enter a valid email address.",
      );
    }

    // Keep useForm as the authority for whether submission is valid.
    form.handleSubmit();
  };

  const emailError =
    form.touched.email || hasAttemptedSubmit ? form.errors.email : undefined;

  const styles = StyleSheet.create({
    errorText: {
      color: colors.error,
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
      title="Reset Password"
      subtitle="Enter your email to receive a secure reset link"
      icon="mail-outline"
    >
      <Card>
        {serverError && (
          <Text
            style={styles.errorText}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {serverError}
          </Text>
        )}

        <Input
          label="Email"
          placeholder="you@example.com"
          value={form.values.email}
          onChangeText={(text) => {
            if (serverError) {
              setServerError(null);
            }

            form.handleChange("email")(text);
          }}
          onBlur={form.handleBlur("email")}
          error={emailError}
          keyboardType="email-address"
        />

        <View style={{ marginTop: Spacing.sm }}>
          <Button
            title="Send Reset Link"
            onPress={handleSendResetLink}
            loading={form.isSubmitting}
            disabled={form.isSubmitting}
          />
        </View>
      </Card>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Remember your password? </Text>

        <Link href="/(auth)/login" asChild>
          <Text style={styles.link}>Sign in</Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
