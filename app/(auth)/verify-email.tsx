import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Button, Card } from "../../components/ui";
import { COLORS } from "../../constants";
import { api } from "../../services/api";

export default function VerifyEmailScreen() {
  const router = useRouter();
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

  useEffect(() => {
    if (verifiedParam) {
      setStatus("success");
      Alert.alert("Success", "Your email has been verified successfully!", [
        {
          text: "Continue",
          onPress: () => router.replace("/(tabs)/documents" as any),
        },
      ]);
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
      const authToken = response?.data?.token || response?.token;
      if (authToken) {
        await SecureStore.setItemAsync("userToken", authToken);
      }

      Alert.alert("Success", "Your email has been verified successfully!", [
        {
          text: "Continue",
          onPress: () => router.replace("/(tabs)/documents" as any),
        },
      ]);
    } catch (err: any) {
      setStatus("error");
      const errorMsg =
        err?.response?.data?.error || "Invalid or expired verification link.";
      setErrorMessage(errorMsg);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await api.auth.resendVerification({ email: emailParam });
      Alert.alert(
        "Link Sent",
        "A fresh verification link has been sent to your email.",
      );
    } catch (err: any) {
      Alert.alert(
        "Error",
        "Could not resend the verification link. Please try again later.",
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <Text style={styles.title}>
            {status === "success" ? "Email Verified" : "Verify your email"}
          </Text>
          <Text style={styles.subtitle}>
            {status === "verifying" &&
              "Verifying your secure token, please wait..."}
            {status === "success" &&
              "Your account is now fully activated and secured."}
            {status === "pending" && (
              <>
                We sent a verification link to{" "}
                <Text style={styles.boldText}>{emailParam}</Text>. Open your
                inbox to activate your account.
              </>
            )}
            {status === "error" &&
              (errorMessage ||
                "We couldn't verify your token. It may have expired.")}
          </Text>
        </View>

        <Card>
          <View style={{ gap: 16, alignItems: "center" }}>
            {status === "verifying" && (
              <ActivityIndicator
                size="large"
                color={COLORS.primary}
                style={{ marginVertical: 20 }}
              />
            )}

            {status !== "verifying" && (
              <>
                <Button
                  title="Resend verification link"
                  onPress={handleResend}
                  loading={resending}
                  feedbackType="info"
                />

                <Button
                  title="Return to sign in"
                  onPress={() => router.replace("/(auth)/login" as any)}
                  variant="secondary"
                  feedbackType="light"
                />
              </>
            )}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  content: {
    padding: 20,
    justifyContent: "center",
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: { alignItems: "center", marginBottom: 30, marginTop: 20 },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    paddingHorizontal: 10,
    lineHeight: 20,
  },
  boldText: { fontWeight: "600", color: COLORS.text },
});
