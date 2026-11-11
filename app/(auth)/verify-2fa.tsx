import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Button, Input, Card } from "@/components/ui";
import { useColors } from "@/context/ThemeContext";
import { api } from "@/services/api";
import { establishAuthenticatedSession } from "@/services/authSession";
import { registerPushTokenWithBackend } from "@/hooks/usePushNotifications";
import {
  feedbackService,
  useFeedbackService,
} from "@/services/feedbackService";

export default function Verify2FAScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    email?: string;
    password?: string;
  }>();
  useFeedbackService();

  const colors = useColors();
  const COLORS = useMemo(
    () => ({
      primary: colors.primary,
      background: colors.background,
      surface: colors.surface,
      text: colors.text,
      textSecondary: colors.textSecondary,
      border: colors.border,
      danger: colors.error,
    }),
    [colors],
  );

  const styles = useMemo(() => createStyles(COLORS), [COLORS]);

  const [code, setCode] = useState("");
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = useCallback(async () => {
    const rawCode = code.trim();
    const normalizedCode = isRecoveryMode
      ? rawCode.replace(/[\s-]/g, "").toUpperCase()
      : rawCode.replace(/\s/g, "");

    if (!normalizedCode) {
      setError(
        isRecoveryMode
          ? "Please enter a recovery code."
          : "Please enter the 6-digit authentication code.",
      );
      return;
    }

    if (!isRecoveryMode && !/^\d{6}$/.test(normalizedCode)) {
      setError("Enter the 6-digit authentication code.");
      return;
    }

    if (isRecoveryMode && !/^[A-F0-9]{32}$/.test(normalizedCode)) {
      setError("Enter a valid recovery code.");
      return;
    }

    if (!params.email || !params.password) {
      const message =
        "Your sign-in session is missing. Please sign in again to verify.";
      setError(message);
      await feedbackService.alert({
        title: "Verification Failed",
        message,
        type: "error",
      });
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const payload: {
        email: string;
        password: string;
        totpCode?: string;
        recoveryCode?: string;
      } = {
        email: String(params.email).trim().toLowerCase(),
        password: String(params.password),
      };

      if (isRecoveryMode) {
        payload.recoveryCode = normalizedCode;
      } else {
        payload.totpCode = normalizedCode;
      }

      const response = await api.auth.login(payload);

      if (response?.requiresTwoFactor) {
        throw new Error("Invalid authentication code.");
      }

      if (!response?.token || !response?.user?.id) {
        throw new Error("Failed to establish session after 2FA verification.");
      }

      await establishAuthenticatedSession(response.token, response.user.id);

      try {
        await registerPushTokenWithBackend();
      } catch (pushErr) {
        console.warn("Push token registration skipped/failed:", pushErr);
      }

      router.replace("/(tabs)" as any);
    } catch (err: any) {
      console.error("2FA verification failed:", err);
      const message =
        err?.response?.data?.error ||
        (err instanceof Error
          ? err.message
          : "Verification failed. Please try again.");
      setError(message);
      await feedbackService.alert({
        title: "Verification Failed",
        message,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [code, isRecoveryMode, params.email, params.password, router]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerIconContainer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={48}
              color={COLORS.primary}
            />
          </View>

          <Text style={styles.title}>Two-Factor Authentication</Text>
          <Text style={styles.subtitle}>
            {isRecoveryMode
              ? "Enter one of your emergency backup recovery codes."
              : "Open your Google Authenticator app and enter the 6-digit code for DocuGuard."}
          </Text>

          <Card style={styles.card}>
            <Input
              label={isRecoveryMode ? "Recovery Code" : "Authentication Code"}
              placeholder={isRecoveryMode ? "Enter backup code" : "123456"}
              value={code}
              onChangeText={(text: string) => {
                setCode(
                  isRecoveryMode
                    ? text.replace(/[^A-Fa-f0-9\s-]/g, "").toUpperCase()
                    : text.replace(/[^0-9]/g, "").slice(0, 6),
                );
                if (error) setError("");
              }}
              autoCapitalize={isRecoveryMode ? "characters" : "none"}
              keyboardType={isRecoveryMode ? "default" : "number-pad"}
              maxLength={isRecoveryMode ? 64 : 6}
              error={error}
            />

            <View style={styles.buttonContainer}>
              <Button
                title={isLoading ? "Verifying..." : "Verify Code"}
                onPress={handleVerify}
                loading={isLoading}
                disabled={isLoading || !code.trim()}
              />
            </View>

            <TouchableOpacity
              style={styles.switchModeButton}
              onPress={() => {
                setIsRecoveryMode(!isRecoveryMode);
                setCode("");
                setError("");
              }}
            >
              <Text style={styles.switchModeText}>
                {isRecoveryMode
                  ? "Use Authenticator App Code"
                  : "Use a Recovery Code instead"}
              </Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (COLORS: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: COLORS.background,
    },
    keyboardContainer: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      padding: 24,
      justifyContent: "center",
      alignItems: "center",
    },
    headerIconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: "rgba(37, 99, 235, 0.08)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    title: {
      fontSize: 22,
      fontWeight: "700",
      color: COLORS.text,
      textAlign: "center",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: COLORS.textSecondary,
      textAlign: "center",
      marginBottom: 24,
      maxWidth: 320,
    },
    card: {
      width: "100%",
      maxWidth: 400,
      padding: 20,
    },
    buttonContainer: {
      marginTop: 16,
    },
    switchModeButton: {
      marginTop: 16,
      alignItems: "center",
    },
    switchModeText: {
      fontSize: 13,
      fontWeight: "600",
      color: COLORS.primary,
    },
  });
