import React, { useEffect, useState, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
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

const DEFAULT_APP_LOCK_DELAY = 30000;
const APP_LOCK_ENABLED_KEY = "docuguard.appLock.enabled";
const APP_LOCK_TIMEOUT_KEY = "docuguard.appLock.timeout";

export function useAppLock() {
  const [isLocked, setIsLocked] = useState(false);
  const [appLockEnabled, setAppLockEnabled] = useState(true);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [lockTimeout, setLockTimeout] = useState<number>(
    DEFAULT_APP_LOCK_DELAY,
  );

  const lastActiveTimeRef = useRef<number>(Date.now());
  const appLockEnabledRef = useRef(true);
  const biometricEnabledRef = useRef(false);
  const lockTimeoutRef = useRef(DEFAULT_APP_LOCK_DELAY);
  const mountedRef = useRef(true);

  // Keep refs in sync with state
  useEffect(() => {
    appLockEnabledRef.current = appLockEnabled;
  }, [appLockEnabled]);

  useEffect(() => {
    biometricEnabledRef.current = biometricEnabled;
  }, [biometricEnabled]);

  useEffect(() => {
    lockTimeoutRef.current = lockTimeout;
  }, [lockTimeout]);

  // Load preferences from SecureStore on startup
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const storedEnabled =
          await SecureStore.getItemAsync(APP_LOCK_ENABLED_KEY);
        if (storedEnabled !== null) {
          const enabled = storedEnabled === "true";
          setAppLockEnabled(enabled);
          appLockEnabledRef.current = enabled;
        }

        const storedTimeout =
          await SecureStore.getItemAsync(APP_LOCK_TIMEOUT_KEY);
        if (storedTimeout !== null) {
          const timeout = parseInt(storedTimeout, 10);
          setLockTimeout(timeout);
          lockTimeoutRef.current = timeout;
        }
      } catch (err) {
        console.warn("Failed to load app lock preferences:", err);
      }
    };
    loadPreferences();
  }, []);

  const checkBiometricSupport = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const token = await SecureStore.getItemAsync("userToken");

      const enabled = hasHardware && isEnrolled && !!token;
      if (mountedRef.current) {
        setBiometricEnabled(enabled);
      }
    } catch (err) {
      console.warn("Biometric check failed:", err);
      if (mountedRef.current) {
        setBiometricEnabled(false);
      }
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
        lastActiveTimeRef.current = Date.now();
      } else if (nextAppState === "active") {
        checkBiometricSupport();
        const now = Date.now();
        const timeAway = now - lastActiveTimeRef.current;

        if (appLockEnabledRef.current && timeAway > lockTimeoutRef.current) {
          setIsLocked(true);
        }
        lastActiveTimeRef.current = now;
      }
    },
    [checkBiometricSupport],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, [handleAppStateChange]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return false;

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock DocuGuard to access your vault",
        fallbackLabel: "Use Password",
        disableDeviceFallback: false,
      });

      if (authResult.success) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Biometric unlock failed:", err);
      return false;
    }
  }, []);

  const unlockWithPassword = useCallback(
    async (password: string): Promise<boolean> => {
      try {
        // Retrieve the stored user password or token to validate against
        // Replace this check with your secure password validation logic
        const storedToken = await SecureStore.getItemAsync("userToken");
        if (!storedToken) return false;

        // Simple validation example (In production, verify against your auth state/hash)
        if (password.length > 0) {
          setIsLocked(false);
          return true;
        }
        return false;
      } catch (err) {
        console.error("Password unlock failed:", err);
        return false;
      }
    },
    [],
  );

  return {
    isLocked,
    appLockEnabled,
    biometricEnabled,
    unlockWithBiometric,
    unlockWithPassword,
    setIsLocked,
  };
}

interface AppLockScreenProps {
  isLocked: boolean;
  biometricEnabled: boolean;
  onUnlockBiometric: () => Promise<boolean>;
  onUnlockPassword: (password: string) => Promise<boolean>;
}

export function AppLockScreen({
  isLocked,
  biometricEnabled,
  onUnlockBiometric,
  onUnlockPassword,
}: AppLockScreenProps) {
  const [authenticating, setAuthenticating] = useState(false);
  const [usePasswordMode, setUsePasswordMode] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

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
    setErrorMsg("");
    const success = await onUnlockBiometric();
    if (!success) {
      setErrorMsg("Biometric verification failed. Try again.");
    }
    setAuthenticating(false);
  };

  const handlePasswordSubmit = async () => {
    if (!passwordInput) return;
    setAuthenticating(true);
    setErrorMsg("");
    const success = await onUnlockPassword(passwordInput);
    if (!success) {
      setErrorMsg("Incorrect password. Please try again.");
    }
    setAuthenticating(false);
  };

  if (!isLocked) return null;

  return (
    <LinearGradient
      colors={["#0B1120", "#0F172A", "#1E293B"]}
      style={[styles.gradient, StyleSheet.absoluteFill, { zIndex: 9999 }]}
    >
      <BlurView
        intensity={30}
        tint="dark"
        style={{ position: "absolute", top: 0, left: 0, bottom: 0, right: 0 }}
      />
      <SafeAreaView style={styles.safeArea}>
        <Animated.View style={[styles.content, containerAnimatedStyle]}>
          <Animated.View style={[styles.iconRing, iconAnimatedStyle]}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed" size={36} color={COLORS.primary} />
            </View>
          </Animated.View>
          <Text style={styles.title}>App Locked</Text>
          <Text style={styles.subtitle}>
            Your vault is protected. Authenticate to continue.
          </Text>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {!usePasswordMode ? (
            <>
              {biometricEnabled && (
                <Animated.View
                  style={[styles.buttonWrapper, buttonAnimatedStyle]}
                >
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
                onPress={() => setUsePasswordMode(true)}
                activeOpacity={0.6}
              >
                <Text style={styles.fallbackText}>Use Password Instead</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter password"
                placeholderTextColor="#64748B"
                secureTextEntry
                value={passwordInput}
                onChangeText={setPasswordInput}
                autoFocus
              />
              <TouchableOpacity
                style={styles.button}
                onPress={handlePasswordSubmit}
                disabled={authenticating}
                activeOpacity={0.85}
              >
                {authenticating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Unlock Vault</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.fallbackButton}
                onPress={() => {
                  setUsePasswordMode(false);
                  setErrorMsg("");
                }}
                activeOpacity={0.6}
              >
                <Text style={styles.fallbackText}>Use Biometrics Instead</Text>
              </TouchableOpacity>
            </View>
          )}
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
  errorText: {
    color: "#EF4444",
    fontSize: 13,
    marginBottom: Spacing.md,
    textAlign: "center",
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
    width: "100%",
    maxWidth: 300,
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
  passwordContainer: {
    width: "100%",
    maxWidth: 300,
    alignItems: "center",
  },
  passwordInput: {
    width: "100%",
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(100, 116, 139, 0.3)",
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: "#F1F5F9",
    fontSize: 15,
    marginBottom: Spacing.md,
  },
  fallbackButton: {
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  fallbackText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "500",
  },
});
