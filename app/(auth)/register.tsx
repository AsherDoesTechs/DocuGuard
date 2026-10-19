import React, { useState, useMemo, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Link, useRouter } from "expo-router";
import { Input, Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { useForm } from "../../hooks/useForm";
import { useColors } from "@/context/ThemeContext";
import { Spacing, COLORS } from "@/constants";
import { api } from "../../services/api";
import {
  registerSchema,
  type RegisterInput,
  validateSchema,
} from "@/shared/validation";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";

interface RegisterFormValues extends RegisterInput {
  firstName: string;
  lastName: string;
}

export default function RegisterScreen() {
  const router = useRouter();
  const colors = useColors();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Prevent duplicate API requests before React updates the loading state.
  const registrationRequestRef = useRef(false);

  useFeedbackService();

  const getPasswordStrength = (password: string) => {
    if (!password) {
      return {
        score: 0,
        label: "Enter a password",
        color: colors.textSecondary,
      };
    }

    let score = 0;

    if (password.length >= 8) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 1) {
      return { score: 20, label: "Weak", color: COLORS.danger };
    }

    if (score === 2) {
      return { score: 40, label: "Fair", color: COLORS.warning };
    }

    if (score === 3) {
      return { score: 60, label: "Good", color: COLORS.primary };
    }

    if (score === 4) {
      return { score: 80, label: "Strong", color: COLORS.success };
    }

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

    const schemaErrors = result.errors as Partial<
      Record<keyof RegisterInput, string>
    >;

    // The schema validates a combined "name", while the UI has
    // separate first-name and last-name fields.
    const errors: Partial<Record<keyof RegisterFormValues, string>> = {
      email: schemaErrors.email,
      password: schemaErrors.password,
      confirmPassword: schemaErrors.confirmPassword,
    };

    if (schemaErrors.name) {
      errors.firstName = schemaErrors.name;
    }

    return errors;
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
      if (registrationRequestRef.current) {
        return;
      }

      registrationRequestRef.current = true;
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
            message:
              "Your account was created, but the verification email could not be sent. You can try resending it from the next screen.",
            type: "warning",
            buttons: [{ text: "Continue" }],
          });
        }

        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: normalizedEmail },
        } as any);
      } catch (err: any) {
        const status = err?.response?.status;
        const serverMessage = err?.response?.data?.error;

        let errorMessage = "Could not create your account. Please try again.";

        if (!err?.response) {
          errorMessage =
            "Network error. Check your internet connection and try again.";
        } else if (status === 409) {
          errorMessage =
            serverMessage ||
            "An account with these details may already exist. Try signing in or use another email address.";
        } else if (status === 429) {
          errorMessage =
            "Too many registration attempts. Please wait before trying again.";
        } else if (status >= 500) {
          errorMessage =
            "The server is temporarily unavailable. Please try again later.";
        } else if (serverMessage) {
          errorMessage = serverMessage;
        }

        setServerError(errorMessage);
        feedbackService.error(errorMessage);
      } finally {
        registrationRequestRef.current = false;
      }
    },
  });

  const pwdStats = useMemo(
    () => getPasswordStrength(form.values.password),
    [form.values.password, colors.textSecondary],
  );

  const clearServerError = () => {
    if (serverError) {
      setServerError(null);
    }
  };

  const handleRegisterPress = () => {
    if (registrationRequestRef.current || form.isSubmitting) {
      return;
    }

    setHasAttemptedSubmit(true);
    setServerError(null);

    const validationResult = validateSchema(registerSchema, {
      name: `${form.values.firstName.trim()} ${form.values.lastName.trim()}`,
      email: form.values.email.trim().toLowerCase(),
      password: form.values.password,
      confirmPassword: form.values.confirmPassword,
    });

    if (!validationResult.success) {
      const errors = validate(form.values);
      const firstError =
        errors.firstName ??
        errors.lastName ??
        errors.email ??
        errors.password ??
        errors.confirmPassword ??
        "Please complete all required fields correctly.";

      feedbackService.warning(firstError);
    }

    // useForm remains responsible for deciding whether onSubmit
    // can run according to the existing validation rules.
    form.handleSubmit();
  };

  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 24,
      paddingBottom: 32,
    },
    header: {
      alignItems: "center",
      marginBottom: 32,
      marginTop: 16,
    },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: "center",
    },
    errorText: {
      color: colors.error,
      marginBottom: 12,
      textAlign: "center",
      fontSize: 14,
    },
    strengthContainer: {
      marginBottom: 16,
      marginTop: Spacing.xs,
    },
    progressBarBackground: {
      height: 6,
      backgroundColor: colors.border,
      borderRadius: 3,
      overflow: "hidden",
      marginBottom: 6,
    },
    progressBarFill: {
      height: "100%",
      borderRadius: 3,
    },
    strengthLabel: {
      fontSize: 12,
      fontWeight: "600",
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

  const showFieldError = (field: keyof RegisterFormValues) =>
    form.touched[field] || hasAttemptedSubmit ? form.errors[field] : undefined;

  return (
    <AuthScreen
      title="Create Account"
      subtitle="Secure your personal identity documents today"
      icon="person-add-outline"
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

        <View style={{ gap: Spacing.sm }}>
          <Input
            label="First name"
            placeholder="John"
            value={form.values.firstName}
            onChangeText={(text) => {
              clearServerError();

              const cleanText = text.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");

              if (cleanText.length <= 50) {
                form.handleChange("firstName")(cleanText);
              }
            }}
            onBlur={form.handleBlur("firstName")}
            error={showFieldError("firstName")}
          />

          <Input
            label="Last name"
            placeholder="Doe"
            value={form.values.lastName}
            onChangeText={(text) => {
              clearServerError();

              const cleanText = text.replace(/[^A-Za-zÀ-ÿ\s'-]/g, "");

              if (cleanText.length <= 50) {
                form.handleChange("lastName")(cleanText);
              }
            }}
            onBlur={form.handleBlur("lastName")}
            error={showFieldError("lastName")}
          />
        </View>

        <Input
          label="Email address"
          placeholder="you@example.com"
          value={form.values.email}
          onChangeText={(text) => {
            clearServerError();
            form.handleChange("email")(text);
          }}
          onBlur={form.handleBlur("email")}
          error={showFieldError("email")}
          keyboardType="email-address"
        />

        <Input
          label="Password"
          placeholder="••••••••"
          value={form.values.password}
          onChangeText={(text) => {
            clearServerError();
            form.handleChange("password")(text);
          }}
          onBlur={form.handleBlur("password")}
          error={showFieldError("password")}
          secureTextEntry={!showPassword}
          rightIcon={showPassword ? "eye-off-outline" : "eye-outline"}
          onRightIconPress={() => setShowPassword((prev) => !prev)}
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
          onChangeText={(text) => {
            clearServerError();
            form.handleChange("confirmPassword")(text);
          }}
          onBlur={form.handleBlur("confirmPassword")}
          error={showFieldError("confirmPassword")}
          secureTextEntry={!showConfirmPassword}
          rightIcon={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
          onRightIconPress={() => setShowConfirmPassword((prev) => !prev)}
        />

        <View style={{ marginTop: Spacing.sm }}>
          <Button
            title="Create Account"
            onPress={handleRegisterPress}
            loading={form.isSubmitting}
            disabled={form.isSubmitting}
          />
        </View>
      </Card>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account? </Text>

        <Link href="/(auth)/login" asChild>
          <Text style={styles.link}>Sign in</Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
