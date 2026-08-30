import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { useForm } from "../../hooks/useForm";
import { COLORS } from "../../constants";
import { api } from "../../services/api";

export default function RegisterScreen() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [networkStatusText, setNetworkStatusText] = useState<string | null>(
    null,
  );

  // States for separated user inputs
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailUsername, setEmailUsername] = useState("");

  // Helper to evaluate password security and return fun descriptions
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

    if (score <= 1)
      return {
        score: 20,
        label: "Yikes! A toddler could guess this 🧸",
        color: "#EF4444",
      };
    if (score === 2)
      return {
        score: 40,
        label: "Meh... decent for a burner account 🚪",
        color: "#F59E0B",
      };
    if (score === 3)
      return {
        score: 60,
        label: "Not bad! Hackers will need coffee ☕",
        color: "#3B82F6",
      };
    if (score === 4)
      return {
        score: 80,
        label: "Strong! Cyber-monsters stay away 🛡️",
        color: "#10B981",
      };
    return {
      score: 100,
      label: "Fort Knox cyber-vault level! 👑🚀",
      color: "#8B5CF6",
    };
  };

  const checkEmailExists = async (username: string) => {
    const cleanUsername = username.replace(/@.*/g, "").trim().toLowerCase();
    if (!cleanUsername) {
      setEmailAvailable(false);
      setNetworkStatusText(null);
      return;
    }

    const fullEmail = `${cleanUsername}@gmail.com`;
    setCheckingEmail(true);
    setEmailError(null);
    setEmailAvailable(false);
    setNetworkStatusText(null);

    try {
      const response = await api.client.get(`/auth/check-email`, {
        params: { email: fullEmail },
      });

      if (response.data?.exists) {
        setEmailError("This email address is already registered.");
        setEmailAvailable(false);
      } else {
        setEmailAvailable(true);
      }
    } catch (err: any) {
      if (err.code === "ECONNREFUSED") {
        setNetworkStatusText(
          "⚠️ Connection refused: Is Node.js server running?",
        );
      } else if (err.message?.includes("Network Error")) {
        setNetworkStatusText("⚠️ Network error: Check IP address in api.ts");
      } else {
        setNetworkStatusText(
          `⚠️ Backend offline: ${err.message || "Uniqueness check skipped"}`,
        );
      }
    } finally {
      setCheckingEmail(false);
    }
  };

  const validate = (values: any) => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) {
      errors.firstName = "First name is required";
    } else if (firstName.trim().length < 2) {
      errors.firstName = "First name must be at least 2 characters";
    } else if (firstName.trim().length > 50) {
      errors.firstName = "First name must be under 50 characters";
    }

    if (!lastName.trim()) {
      errors.lastName = "Last name is required";
    } else if (lastName.trim().length < 2) {
      errors.lastName = "Last name must be at least 2 characters";
    } else if (lastName.trim().length > 50) {
      errors.lastName = "Last name must be under 50 characters";
    }

    if (!emailUsername.trim()) {
      errors.email = "Email address is required";
    } else if (emailUsername.includes("@") || emailUsername.includes(" ")) {
      errors.email = "Enter only your account name without @gmail.com";
    } else if (emailError) {
      errors.email = emailError;
    }

    if (!values.password) {
      errors.password = "Password is required";
    } else if (values.password.length < 6) {
      errors.password = "Must be at least 6 characters";
    }

    if (values.password !== values.confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    return errors;
  };

  const form = useForm({
    initialValues: { password: "", confirmPassword: "" },
    validate,
    onSubmit: async (values) => {
      setServerError(null);

      if (emailError) {
        Alert.alert("Error", emailError);
        return;
      }

      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const fullEmail = `${emailUsername.trim().toLowerCase()}@gmail.com`;

      try {
        const payload = {
          name: fullName,
          email: fullEmail,
          password: values.password,
        };

        await api.auth.register(payload);

        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: fullEmail },
        } as any);
      } catch (err: any) {
        const errorMsg =
          err?.response?.data?.error ||
          "Could not create account. Please try again.";
        setServerError(errorMsg);
        Alert.alert("Registration Failed", errorMsg);
      }
    },
  });

  const pwdStats = getPasswordStrength(form.values.password);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>
          Secure your personal identity documents today with Gmail verification
        </Text>
      </View>

      <Card>
        {serverError && <Text style={styles.errorText}>{serverError}</Text>}

        <Input
          label="First name"
          placeholder="John"
          value={firstName}
          onChangeText={(text) => {
            const cleanText = text.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");
            if (cleanText.length <= 50) setFirstName(cleanText);
          }}
        />

        <Input
          label="Last name"
          placeholder="Doe"
          value={lastName}
          onChangeText={(text) => {
            const cleanText = text.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");
            if (cleanText.length <= 50) setLastName(cleanText);
          }}
        />

        <View style={styles.emailContainer}>
          <View style={{ flex: 1 }}>
            <Input
              label="Email address"
              placeholder="Username"
              value={emailUsername}
              onChangeText={(text) => {
                const cleaned = text.replace(/@.*/g, "").trim();
                setEmailUsername(cleaned);
                if (emailError) setEmailError(null);
                if (emailAvailable) setEmailAvailable(false);
                if (networkStatusText) setNetworkStatusText(null);
              }}
              onBlur={() => checkEmailExists(emailUsername)}
            />
          </View>
          <View style={styles.suffixContainer}>
            <Text style={styles.suffixText}>@gmail.com</Text>
          </View>
        </View>

        {checkingEmail ? (
          <Text style={styles.statusText}>Checking availability...</Text>
        ) : emailError ? (
          <Text style={styles.errorStatusText}>{emailError}</Text>
        ) : emailAvailable ? (
          <Text style={styles.successStatusText}>✓ Email is available!</Text>
        ) : networkStatusText ? (
          <Text style={styles.warningStatusText}>{networkStatusText}</Text>
        ) : null}

        <Input
          label="Password (Min 6 chars)"
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
            title="Register & Verify Gmail"
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
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20 },
  header: { alignItems: "center", marginBottom: 30, marginTop: 30 },
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
  emailContainer: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
  },
  suffixContainer: {
    position: "absolute",
    right: 14,
    top: 34,
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "none",
  },
  suffixText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: "500" },
  errorText: {
    color: COLORS.danger,
    marginBottom: 12,
    textAlign: "center",
    fontSize: 14,
  },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
    marginLeft: 4,
    fontStyle: "italic",
  },
  errorStatusText: {
    color: COLORS.danger,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
    marginLeft: 4,
  },
  successStatusText: {
    color: "#10B981",
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
    marginLeft: 4,
    fontWeight: "500",
  },
  warningStatusText: {
    color: "#F59E0B",
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
    marginLeft: 4,
    fontStyle: "italic",
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
