import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";

import { useForm } from "../../hooks/useForm";
import { isValidEmail } from "../../utils";
import { COLORS } from "../../constants";
import { api } from "../../services/api";

export default function RegisterScreen() {
  const router = useRouter();

  const validate = (values: any) => {
    const errors: Record<string, string> = {};
    if (!values.name) errors.name = "Name is required";
    if (!values.email) errors.email = "Email is required";
    else if (!isValidEmail(values.email)) errors.email = "Invalid email format";
    if (!values.password) errors.password = "Password is required";
    else if (values.password.length < 6)
      errors.password = "Must be at least 6 characters";
    if (values.password !== values.confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }
    return errors;
  };

  const form = useForm({
    initialValues: { name: "", email: "", password: "", confirmPassword: "" },
    validate,
    onSubmit: async (values) => {
      try {
        await api.auth.register(values);
        router.replace("/(tabs)/documents" as any);
      } catch (err) {
        console.error("Registration crashed", err);
      }
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>
          Secure your personal identity documents today
        </Text>
      </View>

      <Card>
        <Input
          label="Full Name"
          placeholder="John Doe"
          value={form.values.name}
          onChangeText={form.handleChange("name")}
          onBlur={form.handleBlur("name")}
          error={form.touched.name ? form.errors.name : undefined}
        />

        <Input
          label="Email Address"
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

        <Input
          label="Confirm Password"
          placeholder="••••••••"
          value={form.values.confirmPassword}
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
            title="Register"
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
    marginBottom: 30,
    marginTop: 30,
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
    paddingHorizontal: 10,
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
