import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
  validateSchema,
} from "@/shared/validation";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

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

        Alert.alert(
          "Check Your Email",
          "If an account exists with that email, instructions and a secure link to reset your password have been sent.",
          [
            {
              text: "OK",
              onPress: () => router.replace("/(auth)/login" as any),
            },
          ],
        );
      } catch (err: any) {
        console.error("Forgot password request failed:", err);
        setServerError(
          "We couldn't process that request. Please try again in a moment.",
        );
      }
    },
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter your email to receive a secure reset link
          </Text>
        </View>

        <Card>
          {serverError && <Text style={styles.errorText}>{serverError}</Text>}

          <Input
            label="Email"
            placeholder="you@example.com"
            value={form.values.email}
            onChangeText={form.handleChange("email")}
            onBlur={form.handleBlur("email")}
            error={form.touched.email ? form.errors.email : undefined}
            keyboardType="email-address"
          />

          <View style={{ marginTop: 12 }}>
            <Button
              title="Send Reset Link"
              onPress={form.handleSubmit}
              loading={form.isSubmitting}
            />
          </View>
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Remember your password? </Text>
          <Link href="/(auth)/login" asChild>
            <Text style={styles.link}>Sign in</Text>
          </Link>
        </View>
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
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
  },
  footerText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  link: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
});
