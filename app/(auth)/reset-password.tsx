import React, { useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";
import { Spacing } from "../../constants";
import { useColors } from "@/context/ThemeContext";
import { api } from "../../services/api";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
  validateSchema,
} from "@/shared/validation";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";

interface FormValues {
  newPassword: string;
  confirmPassword: string;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const colors = useColors();
  const params = useLocalSearchParams();

  const rawToken = params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  const [serverError, setServerError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Prevent duplicate requests from rapid taps.
  const requestInProgressRef = useRef(false);

  useFeedbackService();

  const validate = (values: FormValues) => {
    const payload: ResetPasswordInput = {
      token,
      newPassword: values.newPassword,
    };

    const result = validateSchema(resetPasswordSchema, payload);
    const errors: Partial<Record<keyof FormValues, string>> = {};

    if (!result.success) {
      const schemaErrors = result.errors as Record<string, string>;

      if (schemaErrors.newPassword) {
        errors.newPassword = schemaErrors.newPassword;
      }

      // A missing token is handled separately in the screen UI.
      // Do not attach a token validation error to a password field.
    }

    if (
      values.confirmPassword.length > 0 &&
      values.newPassword !== values.confirmPassword
    ) {
      errors.confirmPassword = "Passwords do not match.";
    } else if (values.confirmPassword.length === 0 && hasAttemptedSubmit) {
      errors.confirmPassword = "Please confirm your new password.";
    }

    return errors;
  };

  const form = useForm<FormValues>({
    initialValues: {
      newPassword: "",
      confirmPassword: "",
    },

    validate,

    onSubmit: async (values) => {
      if (requestInProgressRef.current) {
        return;
      }

      if (!token) {
        const message =
          "This password reset link is invalid or has expired. Please request a new one.";

        setServerError(message);
        feedbackService.error(message);
        return;
      }

      requestInProgressRef.current = true;
      setServerError(null);

      try {
        if (typeof (api.auth as any).resetPassword === "function") {
          await (api.auth as any).resetPassword({
            token,
            newPassword: values.newPassword,
          });
        } else {
          await (api as any).post("/auth/reset-password", {
            token,
            newPassword: values.newPassword,
          });
        }

        await feedbackService.confirm({
          title: "Password Updated Successfully",
          message:
            "Your password has been changed. You can now log in with your new credentials.",
          confirmText: "Sign In",
          onConfirm: () => router.replace("/(auth)/login" as any),
          onCancel: () => {},
        });
      } catch (err: any) {
        const status = err?.response?.status;

        let message: string;

        if ([400, 401, 410].includes(status)) {
          message =
            "This password reset link is invalid or has expired. Please request a new one.";
        } else if (!err?.response) {
          message =
            "Unable to connect. Check your internet connection and try again.";
        } else if (status === 429) {
          message =
            "Too many requests. Please wait a while before trying again.";
        } else if (status >= 500) {
          message =
            "The service is temporarily unavailable. Please try again later.";
        } else {
          // Avoid exposing raw server responses that may contain
          // implementation details.
          message =
            "We couldn't reset your password. Please check the link and try again.";
        }

        setServerError(message);
        feedbackService.error(message);
      } finally {
        requestInProgressRef.current = false;
      }
    },
  });

  const handleUpdatePassword = () => {
    if (requestInProgressRef.current || form.isSubmitting) {
      return;
    }

    setHasAttemptedSubmit(true);
    setServerError(null);

    if (!token) {
      const message =
        "This password reset link is invalid or has expired. Please request a new one.";

      setServerError(message);
      feedbackService.error(message);
      return;
    }

    form.handleSubmit();
  };

  const newPasswordError =
    form.touched.newPassword || hasAttemptedSubmit
      ? form.errors.newPassword
      : undefined;

  const confirmPasswordError =
    form.touched.confirmPassword || hasAttemptedSubmit
      ? form.errors.confirmPassword
      : undefined;

  const styles = StyleSheet.create({
    errorText: {
      color: colors.error,
      marginBottom: 12,
      textAlign: "center",
      fontSize: 14,
    },
    helperText: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 6,
    },
  });

  return (
    <AuthScreen
      title="Create New Password"
      subtitle="Enter a secure new password for your account below."
      icon="lock-closed-outline"
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
          label="New Password"
          placeholder="Enter your new password"
          secureTextEntry
          value={form.values.newPassword}
          onChangeText={(text) => {
            if (serverError) {
              setServerError(null);
            }

            form.handleChange("newPassword")(text);
          }}
          onBlur={form.handleBlur("newPassword")}
          error={newPasswordError}
        />

        <Input
          label="Confirm New Password"
          placeholder="Re-enter your new password"
          secureTextEntry
          value={form.values.confirmPassword}
          onChangeText={(text) => {
            if (serverError) {
              setServerError(null);
            }

            form.handleChange("confirmPassword")(text);
          }}
          onBlur={form.handleBlur("confirmPassword")}
          error={confirmPasswordError}
        />

        <Text style={styles.helperText}>
          Choose a strong password and enter it the same way in both fields.
        </Text>

        <View style={{ marginTop: Spacing.sm }}>
          <Button
            title="Update Password"
            onPress={handleUpdatePassword}
            loading={form.isSubmitting}
            disabled={form.isSubmitting}
          />
        </View>
      </Card>
    </AuthScreen>
  );
}
