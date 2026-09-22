import React, { useEffect, useState, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import { COLORS, Spacing } from "@/constants";

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

export function AppLockScreen({
  isLocked,
  biometricEnabled,
  onUnlock,
  onUsePassword,
}: AppLockScreenProps) {
  const [authenticating, setAuthenticating] = useState(false);

  const fadeAnim = useSharedValue(0);
  const scaleAnim = useSharedValue(0.92);
  const iconScale = useSharedValue(1);
  const iconOpacity = useSharedValue(0.5);
  const buttonScale = useSharedValue(0.96);

  useEffect(() => {
    fadeAnim.value = withTiming(1, { duration: 450 });
    scaleAnim.value = withSpring(1, { damping: 18, stiffness: 120 });
    buttonScale.value = withSpring(1, { damping: 14, stiffness: 100 });
  }, []);

  useEffect(() => {
    iconScale.value = withRepeat(
      withTiming(1.06, {
        duration: 2200,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
    iconOpacity.value = withRepeat(
      withTiming(0.65, {
        duration: 2200,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, []);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ scale: scaleAnim.value }],
  }));

  const iconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handleBiometricPress = async () => {
    setAuthenticating(true);
    await onUnlock();
    setAuthenticating(false);
  };

  if (!isLocked) return null;

  return (
    <LinearGradient
      colors={["#0B1120", "#0F172A", "#1E293B"]}
      style={styles.gradient}
    >
      <BlurView
        intensity={30}
        tint="dark"
        style={{ position: "absolute", top: 0, left: 0, bottom: 0, right: 0 }}
      />
      <SafeAreaView style={styles.safeArea}>
        <Animated.View style={[styles.content, containerAnimatedStyle]}>
          <Animated.View
            style={[styles.iconRing, iconAnimatedStyle]}
          >
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed" size={36} color={COLORS.primary} />
            </View>
          </Animated.View>
          <Text style={styles.title}>App Locked</Text>
          <Text style={styles.subtitle}>
            Your vault is protected. Authenticate to continue.
          </Text>
          {biometricEnabled && (
            <Animated.View style={[styles.buttonWrapper, buttonAnimatedStyle]}>
              <TouchableOpacity
                style={styles.button}
                onPress={handleBiometricPress}
                disabled={authenticating}
                activeOpacity={0.85}
              >
                {authenticating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <View style={styles.buttonContent}>
                    <Ionicons
                      name="finger-print"
                      size={20}
                      color="#fff"
                      style={{ marginRight: Spacing.sm }}
                    />
                    <Text style={styles.buttonText}>
                      Unlock with Biometrics
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}
          <TouchableOpacity
            style={styles.fallbackButton}
            onPress={onUsePassword}
            activeOpacity={0.6}
          >
            <Text style={styles.fallbackText}>Use Password Instead</Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(37, 99, 235, 0.2)",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: `${COLORS.primary}18`,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#F1F5F9",
    marginBottom: Spacing.sm,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: "#94A3B8",
    marginBottom: Spacing.xl,
    textAlign: "center",
    lineHeight: 20,
  },
  buttonWrapper: {
    width: "100%",
    maxWidth: 300,
    marginBottom: Spacing.md,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  fallbackButton: {
    paddingVertical: Spacing.sm,
  },
  fallbackText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "500",
  },
});
