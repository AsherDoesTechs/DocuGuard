import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { isValidEmail } from "../../utils";
import { COLORS } from "../../constants";
import { api } from "../../services/api";

interface FormValues {
  email: string;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const validate = (values: FormValues) => {
    const errors: Record<string, string> = {};
    if (!values.email) errors.email = "Email is required";
    else if (!isValidEmail(values.email)) errors.email = "Invalid email format";
    return errors;
  };

  const form = useForm<FormValues>({
    initialValues: { email: "" },
    validate,
    onSubmit: async (values) => {
      setServerError(null);
      try {
        await api.auth.forgotPassword({ email: values.email });
        Alert.alert(
          "Check Your Email",
          "If an account exists with that email, instructions and a secure link to reset your password have been sent.",
          [{ text: "OK", onPress: () => router.push("/(auth)/login" as any) }],
        );
      } catch (err: any) {
        setServerError(
          err.response?.data?.error ||
            "Something went wrong. Please try again.",
        );
      }
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
