import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";
import { resetPasswordSchema, type ResetPasswordInput, validateSchema } from "@/shared/validation";

interface FormValues extends ResetPasswordInput {}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const token = params.token as string;

  const [serverError, setServerError] = useState<string | null>(null);

  const validate = (values: FormValues) => {
    const result = validateSchema(resetPasswordSchema, values);
    if (result.success) {
      return {};
    }
    return result.errors as Partial<Record<keyof FormValues, string>>;
  };

  const form = useForm<FormValues>({
    initialValues: { password: "", confirmPassword: "" },
    validate,
    onSubmit: async (values) => {
      if (!token) {
        setServerError(
          "Invalid or missing reset token. Please request a new link.",
        );
        return;
      }

      setServerError(null);
      try {
        await (api as any).post("/auth/reset-password", {
          token,
          newPassword: values.password,
        });

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
        setServerError(
          err.response?.data?.error ||
            "Failed to reset password. The link may have expired.",
        );
      }
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Create New Password</Text>
        <Text style={styles.subtitle}>
          Your identity has been verified via Gmail. Enter your new password
          below.
        </Text>
      </View>

      <Card>
        {serverError && <Text style={styles.errorText}>{serverError}</Text>}

        <Input
          label="New Password"
          placeholder="••••••••"
          secureTextEntry
          value={form.values.password}
          onChangeText={form.handleChange("password")}
          onBlur={form.handleBlur("password")}
          error={form.touched.password ? form.errors.password : undefined}
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
          />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
    marginTop: 40,
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