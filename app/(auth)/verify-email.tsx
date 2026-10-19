import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button, Card } from "../../components/ui";
import { AuthScreen } from "../../components/ui/AuthScreen";
import { Spacing } from "../../constants";
import { useColors } from "@/context/ThemeContext";
import { api, setAuthToken } from "../../services/api";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";

type VerificationStatus = "pending" | "verifying" | "success" | "error";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const colors = useColors();
  const params = useLocalSearchParams();

  const emailParam =
    typeof params.email === "string" ? params.email.trim() : "";

  const rawToken = params.token;
  const tokenParam = typeof rawToken === "string" ? rawToken.trim() : "";

  // The web verification page redirects here after verifying the account.
  // Web verification does not issue a mobile authentication token.
  const verifiedParam = params.verified === "true";

  const [status, setStatus] = useState<VerificationStatus>(
    verifiedParam ? "success" : tokenParam ? "verifying" : "pending",
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  // Prevent duplicate verification requests during re-renders.
  const verificationStarted = useRef(false);

  // Prevent duplicate success dialogs.
  const successDialogShown = useRef(false);

  useFeedbackService();

  const goToSignIn = () => {
    router.replace("/(auth)/login" as any);
  };

  const goToDocuments = () => {
    router.replace("/(tabs)/documents" as any);
  };

  const showSuccessDialog = (authenticated: boolean) => {
    if (successDialogShown.current) {
      return;
    }

    successDialogShown.current = true;

    if (authenticated) {
      feedbackService.confirm({
        title: "Email Verified",
        message:
          "Your email has been verified successfully. You can now continue to DocuGuard.",
        confirmText: "Continue",
        onConfirm: goToDocuments,
        onCancel: goToDocuments,
      });

      return;
    }

    feedbackService.confirm({
      title: "Email Verified",
      message:
        "Your email has been verified successfully. Please sign in to continue.",
      confirmText: "Sign in",
      onConfirm: goToSignIn,
      onCancel: goToSignIn,
    });
  };

  useEffect(() => {
    if (verifiedParam) {
      setStatus("success");
      showSuccessDialog(false);
      return;
    }

    if (!tokenParam || verificationStarted.current) {
      return;
    }

    verificationStarted.current = true;
    void verifyTokenWithBackend(tokenParam);
  }, [tokenParam, verifiedParam]);

  const verifyTokenWithBackend = async (token: string) => {
    setStatus("verifying");
    setErrorMessage(null);

    try {
      const response = await api.auth.verifyEmail({ token });
      const authToken = response?.token;

      // Only enter protected screens if the backend issued a JWT
      // and the app successfully saved the authentication session.
      if (authToken) {
        try {
          await setAuthToken(authToken);
        } catch (storageError) {
          setStatus("success");
          setErrorMessage(
            "Your email was verified, but DocuGuard couldn't save your login session. Please sign in manually.",
          );

          feedbackService.error(
            "Your email was verified, but your login session could not be saved. Please sign in manually.",
          );

          return;
        }

        setStatus("success");
        showSuccessDialog(true);
        return;
      }

      // The account was verified, but no JWT was returned.
      // Require sign-in instead of entering protected screens.
      setStatus("success");
      showSuccessDialog(false);
    } catch (err: any) {
      const errorMsg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        "This verification link is invalid, expired, or has already been used.";

      setStatus("error");
      setErrorMessage(errorMsg);

      feedbackService.error(errorMsg);
    }
  };

  const handleResend = async () => {
    if (!emailParam) {
      feedbackService.error(
        "Your email address is missing. Return to sign in and try again.",
      );
      return;
    }

    if (resending) {
      return;
    }

    setResending(true);

    try {
      await api.auth.resendVerification({
        email: emailParam.toLowerCase(),
      });

      feedbackService.success(
        "If your account needs verification, a fresh verification email will be sent.",
      );
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        "Could not resend the verification email. Please try again later.";

      feedbackService.error(message);
    } finally {
      setResending(false);
    }
  };

  const subtitle =
    status === "verifying" ? (
      "Verifying your secure link. Please wait..."
    ) : status === "success" ? (
      errorMessage || "Your email verification is complete."
    ) : status === "pending" ? (
      <>
        We sent a verification link to{" "}
        <Text style={styles.boldText}>
          {emailParam || "your email address"}
        </Text>
        . Open your inbox and follow the link to activate your account.
      </>
    ) : (
      errorMessage ||
      "We couldn't verify this link. It may have expired or already been used."
    );

  return (
    <AuthScreen
      title={
        status === "success"
          ? "Email Verified"
          : status === "error"
            ? "Verification Failed"
            : "Verify your email"
      }
      icon={
        status === "success"
          ? "checkmark-circle-outline"
          : status === "error"
            ? "alert-circle-outline"
            : "mail-outline"
      }
      subtitle={subtitle}
    >
      <Card>
        <View style={styles.content}>
          {status === "verifying" && (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              style={styles.loader}
            />
          )}

          {(status === "pending" || status === "error") && (
            <Button
              title="Resend verification email"
              onPress={handleResend}
              loading={resending}
              disabled={resending || !emailParam}
            />
          )}

          {status === "success" && errorMessage && (
            <Button title="Sign in" onPress={goToSignIn} variant="primary" />
          )}

          {status !== "verifying" && (
            <Button
              title={
                status === "success" ? "Go to sign in" : "Return to sign in"
              }
              onPress={goToSignIn}
              variant="secondary"
            />
          )}
        </View>
      </Card>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    alignItems: "center",
  },
  loader: {
    marginVertical: Spacing.lg,
  },
  boldText: {
    fontWeight: "600",
  },
});
