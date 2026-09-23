import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { API_BASE_URL } from "../../services/api";
import { COLORS } from "@/constants";

export default function BiometricLoginScreen() {
  const router = useRouter();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [pin, setPin] = useState("");
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem("biometricEnabled");
      setBiometricsEnabled(stored === "true");
    })();
  }, []);

  const handlePinSubmit = async () => {
    if (!pin) return;
    const storedPin = await AsyncStorage.getItem("biometricPin");
    if (storedPin !== pin) {
      setPinError("Incorrect PIN");
      setPin("");
      return;
    }
    setShowPinEntry(false);
    setPinError("");
    await performBiometricAuth();
  };

  const performBiometricAuth = async () => {
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
        fallbackLabel: "Use PIN",
      });

      if (result.success) {
        const token = await SecureStore.getItemAsync("userToken");
        if (!token) {
          Alert.alert(
            "Session Expired",
            "Please log in with your password first.",
          );
          router.replace("/(auth)/login" as any);
          return;
        }

        const response = await fetch(`${API_BASE_URL}/profile`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          await SecureStore.deleteItemAsync("userToken").catch(() => {});
          Alert.alert("Session Expired", "Please sign in again.");
          router.replace("/(auth)/login" as any);
          return;
        }

        router.replace("/(tabs)/documents" as any);
      }
    } catch (err) {
      Alert.alert("Authentication Error", "Biometric login failed.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (biometricsEnabled) {
      setShowPinEntry(true);
      setPinError("");
      return;
    }
    await performBiometricAuth();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="finger-print" size={80} color={COLORS.primary} />
        </View>

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Unlock your document vault securely</Text>

        {showPinEntry ? (
          <View style={styles.pinContainer}>
            <Text style={styles.pinLabel}>Enter your PIN to continue</Text>
            <View style={styles.pinRow}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    i < pin.length && styles.pinDotActive,
                  ]}
                />
              ))}
            </View>
            <TextInput
              style={styles.pinInput}
              placeholder="Enter PIN"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              maxLength={6}
              value={pin}
              onChangeText={setPin}
              autoCorrect={false}
              secureTextEntry
              onSubmitEditing={handlePinSubmit}
            />
            {pinError ? (
              <Text style={styles.pinError}>{pinError}</Text>
            ) : null}
            <TouchableOpacity
              style={styles.pinSubmit}
              onPress={handlePinSubmit}
            >
              <Text style={styles.pinSubmitText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelPin}
              onPress={() => {
                setShowPinEntry(false);
                setPin("");
                setPinError("");
              }}
            >
              <Text style={styles.cancelPinText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
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
          </>
        )}

        {!showPinEntry && (
          <TouchableOpacity
            style={styles.fallbackButton}
            onPress={() => router.replace("/(auth)/login" as any)}
          >
            <Text style={styles.fallbackText}>Use Password Instead</Text>
          </TouchableOpacity>
        )}
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
  pinContainer: {
    alignItems: "center",
    width: "100%",
    maxWidth: 280,
  },
  pinLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  pinRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  pinDotActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pinInput: {
    width: "100%",
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlign: "center",
    fontSize: 18,
    letterSpacing: 4,
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  pinError: {
    color: COLORS.danger,
    fontSize: 12,
    marginBottom: 12,
  },
  pinSubmit: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 12,
    alignItems: "center",
  },
  pinSubmitText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  cancelPin: {
    paddingVertical: 8,
  },
  cancelPinText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
});
