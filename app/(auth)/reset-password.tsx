import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
  validateSchema,
} from "@/shared/validation";

// Define local form state interface incorporating fields required by the screen UI
interface FormValues {
  newPassword: string;
  confirmPassword: string;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const rawToken = params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  const [serverError, setServerError] = useState<string | null>(null);

  const validate = (values: FormValues) => {
    // Include the token in the payload being validated against the schema
    const payloadToValidate: ResetPasswordInput = {
      token,
      newPassword: values.newPassword,
    };

    const result = validateSchema(resetPasswordSchema, payloadToValidate);

    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!result.success) {
      Object.assign(errors, result.errors);
    }

    if (values.newPassword !== values.confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(errors).length > 0) {
      return errors;
    }
    return {};
  };

  const form = useForm<FormValues>({
    initialValues: { newPassword: "", confirmPassword: "" },
    validate,
    onSubmit: async (values) => {
      if (!token) {
        setServerError(
          "This password reset link is invalid or has expired. Please request a new one.",
        );
        return;
      }

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

        Alert.alert(
          "Password Updated Successfully",
          "Your password has been changed. You can now log in with your new credentials.",
          [
            {
              text: "Sign In",
              onPress: () => router.replace("/(auth)/login" as any),
            },
          ],
        );
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 400 || status === 401 || status === 410) {
          setServerError(
            "This password reset link is invalid or has expired. Please request a new one.",
          );
        } else {
          setServerError(
            err?.response?.data?.error ||
              "We couldn't reset your password right now. Please try again.",
          );
        }
      }
    },
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Create New Password</Text>
          <Text style={styles.subtitle}>
            Enter a secure new password for your account below.
          </Text>
        </View>

        <Card>
          {serverError && <Text style={styles.errorText}>{serverError}</Text>}

          <Input
            label="New Password"
            placeholder="••••••••"
            secureTextEntry
            value={form.values.newPassword}
            onChangeText={form.handleChange("newPassword")}
            onBlur={form.handleBlur("newPassword")}
            error={
              form.touched.newPassword ? form.errors.newPassword : undefined
            }
          />

          <Input
            label="Confirm New Password"
            placeholder="••••••••"
            secureTextEntry
            value={form.values.confirmPassword}
            onChangeText={form.handleChange("confirmPassword")}
            onBlur={form.handleBlur("confirmPassword")}
            error={
              form.touched.confirmPassword
                ? form.errors.confirmPassword
                : undefined
            }
          />

          <View style={{ marginTop: 12 }}>
            <Button
              title="Update Password"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
              feedbackType="success"
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
    marginTop: 20,
  },
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
  },
  errorText: {
    color: COLORS.danger,
    marginBottom: 12,
    textAlign: "center",
    fontSize: 14,
  },
});
