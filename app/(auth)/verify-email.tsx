import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { Spacing } from "../../constants";
import { useColors } from "@/context/ThemeContext";
import { api } from "../../services/api";
import { feedbackService, useFeedbackService } from "../../services/feedbackService";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const colors = useColors();
  const params = useLocalSearchParams();

  const emailParam = (params.email as string) || "your email inbox";
  const rawToken = params.token;
  const tokenParam = typeof rawToken === "string" ? rawToken.trim() : "";
  const verifiedParam = params.verified === "true";

  const [status, setStatus] = useState<
    "pending" | "verifying" | "success" | "error"
  >(verifiedParam ? "success" : tokenParam ? "verifying" : "pending");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  // Initialize feedback service
  useFeedbackService();

  useEffect(() => {
    if (verifiedParam) {
      setStatus("success");
      feedbackService.confirm({
        title: "Success",
        message: "Your email has been verified successfully!",
        confirmText: "Continue",
        onConfirm: () => router.replace("/(tabs)/documents" as any),
      });
    } else if (tokenParam) {
      verifyTokenWithBackend(tokenParam);
    }
  }, [tokenParam, verifiedParam]);

  const verifyTokenWithBackend = async (token: string) => {
    setStatus("verifying");

    try {
      const response = await api.auth.verifyEmail({ token });
      setStatus("success");

      // Securely store authentication token if returned from backend
      const authToken = response?.token;
      if (authToken) {
        await SecureStore.setItemAsync("userToken", authToken);
      }

      await feedbackService.confirm({
        title: "Success",
        message: "Your email has been verified successfully!",
        confirmText: "Continue",
        onConfirm: () => router.replace("/(tabs)/documents" as any),
      });
    } catch (err: any) {
      setStatus("error");
      const errorMsg =
        err?.response?.data?.error || "Invalid or expired verification link.";
      setErrorMessage(errorMsg);
      feedbackService.error(errorMsg);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.auth.resendVerification({ email: emailParam });
      feedbackService.success("A fresh verification link has been sent to your email.");
    } catch (err: any) {
      feedbackService.error("Could not resend the verification link. Please try again later.");
    } finally {
      setResending(false);
    }
  };

  const subtitle =
    status === "verifying"
      ? "Verifying your secure token, please wait..."
      : status === "success"
        ? "Your account is now fully activated and secured."
        : status === "pending"
          ? (
            <>
              We sent a verification link to{" "}
              <Text style={styles.boldText}>{emailParam}</Text>. Open your
              inbox to activate your account.
            </>
          )
          : errorMessage || "We couldn't verify your token. It may have expired.";

  return (
    <AuthScreen
      title={status === "success" ? "Email Verified" : "Verify your email"}
      icon={status === "success" ? "checkmark-circle-outline" : "mail-outline"}
      subtitle={subtitle}
    >
        <Card>
          <View style={{ gap: 16, alignItems: "center" }}>
            {status === "verifying" && (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={{ marginVertical: Spacing.lg }}
              />
            )}

            {status !== "verifying" && (
              <>
                <Button
                  title="Resend verification link"
                  onPress={handleResend}
                  loading={resending}
                />

                <Button
                  title="Return to sign in"
                  onPress={() => router.replace("/(auth)/login" as any)}
                  variant="secondary"
                />
              </>
            )}
          </View>
        </Card>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  boldText: { fontWeight: "600" },
});
