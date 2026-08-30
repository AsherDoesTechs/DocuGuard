import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import { API_BASE_URL } from "../../services/api";
import { COLORS } from "@/constants";

export default function BiometricLoginScreen() {
  const router = useRouter();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleBiometricLogin = async () => {
    try {
      setIsAuthenticating(true);

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        Alert.alert(
          "Not Available",
          "Biometric authentication is not set up on this device.",
        );
        setIsAuthenticating(false);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to access your vault",
        fallbackLabel: "Use passcode",
      });

      if (result.success) {
        // Retrieve stored secure token
        const token = await SecureStore.getItemAsync("userToken");
        if (!token) {
          Alert.alert(
            "Session Expired",
            "Please log in with your password first.",
          );
          router.replace("/(auth)/login" as any);
          return;
        }

        // Validate token with backend profile route
        const response = await fetch(`${API_BASE_URL}/profile`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          // Token expired or invalid on the backend
          const savedToken = await SecureStore.getItemAsync("userToken");
          Alert.alert("Session Expired", "Please sign in again.");
          router.replace("/(auth)/login" as any);
          return;
        }

        // Token is valid! Proceed to main dashboard
        router.replace("/(tabs)/documents" as any);
      }
    } catch (err) {
      Alert.alert("Authentication Error", "Biometric login failed.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="finger-print" size={80} color={COLORS.primary} />
        </View>

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Unlock your document vault securely</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleBiometricLogin}
          disabled={isAuthenticating}
        >
          {isAuthenticating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons
                name="scan"
                size={20}
                color="#fff"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.buttonText}>Authenticate</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.fallbackButton}
          onPress={() => router.replace("/(auth)/login" as any)}
        >
          <Text style={styles.fallbackText}>Use Password Instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: `${COLORS.primary}15`,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary || "#777",
    marginBottom: 40,
    textAlign: "center",
  },
  button: {
    flexDirection: "row",
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: 280,
    marginBottom: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  fallbackButton: {
    paddingVertical: 10,
  },
  fallbackText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
});
