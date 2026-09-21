import { useEffect, useState, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";

const APP_LOCK_DELAY = 30000;

export function useAppLock() {
  const [isLocked, setIsLocked] = useState(false);
  const [lastActiveTime, setLastActiveTime] = useState<number>(Date.now());
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const mountedRef = useRef(true);

  const checkBiometricSupport = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const token = await SecureStore.getItemAsync("userToken");
      setBiometricEnabled(hasHardware && isEnrolled && !!token);
    } catch (err) {
      console.warn("Biometric check failed:", err);
      setBiometricEnabled(false);
    }
  }, []);

  useEffect(() => {
    checkBiometricSupport();
    return () => {
      mountedRef.current = false;
    };
  }, [checkBiometricSupport]);

  const handleAppStateChange = useCallback(
    (nextAppState: AppStateStatus) => {
      if (!mountedRef.current) return;
      if (nextAppState === "background" || nextAppState === "inactive") {
        setLastActiveTime(Date.now());
      } else if (nextAppState === "active") {
        const now = Date.now();
        const timeAway = now - lastActiveTime;
        if (timeAway > APP_LOCK_DELAY && biometricEnabled) {
          setIsLocked(true);
        }
        setLastActiveTime(now);
      }
    },
    [lastActiveTime, biometricEnabled],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [handleAppStateChange]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return false;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock DocuGuard to access your vault",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
      });
      if (result.success) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Biometric unlock failed:", err);
      return false;
    }
  }, []);

  const unlockWithPassword = useCallback(() => {
    router.replace("/(auth)/login" as any);
  }, []);

  return { isLocked, biometricEnabled, unlockWithBiometric, unlockWithPassword };
}

interface AppLockScreenProps {
  isLocked: boolean;
  biometricEnabled: boolean;
  onUnlock: () => Promise<void>;
  onUsePassword: () => void;
}

export function AppLockScreen({ isLocked, biometricEnabled, onUnlock, onUsePassword }: AppLockScreenProps) {
  const [authenticating, setAuthenticating] = useState(false);

  const handleBiometricPress = async () => {
    setAuthenticating(true);
    await onUnlock();
    setAuthenticating(false);
  };

  if (!isLocked) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="lock-closed" size={80} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>App Locked</Text>
        <Text style={styles.subtitle}>Your vault is protected. Authenticate to continue.</Text>
        {biometricEnabled && (
          <TouchableOpacity style={styles.button} onPress={handleBiometricPress} disabled={authenticating}>
            {authenticating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="finger-print" size={24} color="#fff" style={{ marginRight: 10 }} />
                <Text style={styles.buttonText}>Unlock with Biometrics</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.fallbackButton} onPress={onUsePassword}>
          <Text style={styles.fallbackText}>Use Password Instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  iconContainer: { width: 120, height: 120, borderRadius: 60, backgroundColor: `${COLORS.primary}15`, justifyContent: "center", alignItems: "center", marginBottom: 24 },
  title: { fontSize: 26, fontWeight: "700", color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 40, textAlign: "center" },
  button: { flexDirection: "row", backgroundColor: COLORS.primary, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, alignItems: "center", justifyContent: "center", width: "100%", maxWidth: 300, marginBottom: 16 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fallbackButton: { paddingVertical: 10 },
  fallbackText: { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
});
