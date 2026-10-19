import React, { useEffect, useState, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import { getUserProfile, switchLocalUser } from "../services/localDatabase";
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

const DEFAULT_APP_LOCK_DELAY = 30_000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const APP_LOCK_ENABLED_KEY = "docuguard.appLock.enabled";
const APP_LOCK_TIMEOUT_KEY = "docuguard.appLock.timeout";
const SESSION_BACKGROUND_AT_KEY = "docuguard.session.backgroundAt";

export function useAppLock() {
  const [sessionCheckComplete, setSessionCheckComplete] = useState(false);
  const sessionCheckCompleteRef = useRef(false);

  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [lockTimeout, setLockTimeout] = useState(DEFAULT_APP_LOCK_DELAY);
  const [sessionExpired, setSessionExpired] = useState(false);

  // A successful expiration remains latched until RootLayout handles it.
  const sessionExpiredRef = useRef(false);

  // Prevent concurrent expiration operations.
  const expirationInProgressRef = useRef(false);

  // If security state cannot be verified, do not allow either unlock method.
  const sessionVerificationFailedRef = useRef(false);

  const lastActiveTimeRef = useRef(Date.now());
  const appLockEnabledRef = useRef(false);
  const biometricEnabledRef = useRef(false);
  const lockTimeoutRef = useRef(DEFAULT_APP_LOCK_DELAY);
  const mountedRef = useRef(true);

  const resetSessionExpired = useCallback(() => {
    sessionExpiredRef.current = false;
    setSessionExpired(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep refs synchronized with React state.
  useEffect(() => {
    appLockEnabledRef.current = appLockEnabled;
  }, [appLockEnabled]);

  useEffect(() => {
    biometricEnabledRef.current = biometricEnabled;
  }, [biometricEnabled]);

  useEffect(() => {
    lockTimeoutRef.current = lockTimeout;
  }, [lockTimeout]);

  // Load persisted app-lock preferences before checking the session.
  useEffect(() => {
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const [storedEnabled, storedTimeout] = await Promise.all([
          SecureStore.getItemAsync(APP_LOCK_ENABLED_KEY),
          SecureStore.getItemAsync(APP_LOCK_TIMEOUT_KEY),
        ]);

        if (cancelled || !mountedRef.current) return;

        if (storedEnabled !== null) {
          const enabled = storedEnabled === "true";

          setAppLockEnabled(enabled);
          appLockEnabledRef.current = enabled;
        }

        if (storedTimeout !== null) {
          const parsedTimeout = Number.parseInt(storedTimeout, 10);

          if (Number.isFinite(parsedTimeout) && parsedTimeout >= 0) {
            setLockTimeout(parsedTimeout);
            lockTimeoutRef.current = parsedTimeout;
          }
        }
      } catch (error) {
        console.error("Failed to load app-lock preferences:", error);

        // Do not silently disable protection when preferences
        // cannot be read.
        sessionVerificationFailedRef.current = true;

        if (mountedRef.current) {
          setAppLockEnabled(true);
          appLockEnabledRef.current = true;
          setIsLocked(true);
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setPreferencesLoaded(true);
        }
      }
    };

    void loadPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  const checkBiometricSupport = useCallback(async () => {
    try {
      const [hasHardware, isEnrolled, token] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        SecureStore.getItemAsync("userToken"),
      ]);

      const enabled = hasHardware && isEnrolled && !!token;

      if (mountedRef.current) {
        setBiometricEnabled(enabled);
        biometricEnabledRef.current = enabled;
      }

      return enabled;
    } catch (error) {
      console.warn("Biometric availability check failed:", error);

      if (mountedRef.current) {
        setBiometricEnabled(false);
        biometricEnabledRef.current = false;
      }

      return false;
    }
  }, []);

  useEffect(() => {
    void checkBiometricSupport();
  }, [checkBiometricSupport]);

  /**
   * Expire the current session.
   *
   * Returns true only when the existing session is no longer available
   * in SecureStore. If token access or deletion fails, the app stays
   * locked and the caller receives false.
   */
  const expireSession = useCallback(async (): Promise<boolean> => {
    if (sessionExpiredRef.current) {
      return true;
    }

    if (expirationInProgressRef.current) {
      return false;
    }

    expirationInProgressRef.current = true;

    try {
      const token = await SecureStore.getItemAsync("userToken");

      if (token) {
        await SecureStore.deleteItemAsync("userToken");

        // Confirm that the token is actually gone.
        const remainingToken = await SecureStore.getItemAsync("userToken");

        if (remainingToken) {
          throw new Error("The authentication token still exists.");
        }
      }

      // Clear the timestamp separately. Timestamp cleanup failure
      // must not reverse a confirmed token deletion.
      try {
        await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
      } catch (error) {
        console.warn("Failed to clear the background timestamp:", error);
      }

      sessionExpiredRef.current = true;
      sessionVerificationFailedRef.current = false;

      if (mountedRef.current) {
        setIsLocked(false);
        setBiometricEnabled(false);
        biometricEnabledRef.current = false;
        setSessionExpired(true);
      }

      return true;
    } catch (error) {
      console.error("Failed to expire the session:", error);

      sessionVerificationFailedRef.current = true;

      if (mountedRef.current) {
        setIsLocked(true);
      }

      return false;
    } finally {
      expirationInProgressRef.current = false;
    }
  }, []);

  // Verify the previous session before RootLayout finishes its
  // initial authentication check.
  useEffect(() => {
    if (!preferencesLoaded) return;

    let cancelled = false;

    const checkPreviousSession = async () => {
      try {
        const [token, storedBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
        ]);

        if (cancelled || !mountedRef.current) return;

        if (!token) {
          if (storedBackgroundAt) {
            await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
          }

          setIsLocked(false);
          setBiometricEnabled(false);
          biometricEnabledRef.current = false;
          return;
        }

        if (!storedBackgroundAt) {
          // A missing timestamp cannot prove how long the app was
          // closed. Do not invent an elapsed time.
          //
          // If app lock is enabled, require unlocking before exposing
          // the vault. The 30-minute timeout cannot be reconstructed
          // without a persisted timestamp.
          if (appLockEnabledRef.current) {
            setIsLocked(true);
          }

          lastActiveTimeRef.current = Date.now();
          return;
        }

        const backgroundAt = Number(storedBackgroundAt);

        if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
          // We cannot establish the session's previous background time.
          // Fail closed rather than silently trusting this session.
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
          return;
        }

        const timeAway = Math.max(0, Date.now() - backgroundAt);

        if (timeAway >= SESSION_TIMEOUT_MS) {
          const expired = await expireSession();

          if (!expired) {
            sessionVerificationFailedRef.current = true;
            setIsLocked(true);
          }

          return;
        }

        if (appLockEnabledRef.current && timeAway >= lockTimeoutRef.current) {
          setIsLocked(true);
        }

        lastActiveTimeRef.current = Date.now();

        await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
      } catch (error) {
        console.error("Failed to verify the previous session:", error);

        sessionVerificationFailedRef.current = true;

        if (!cancelled && mountedRef.current) {
          setIsLocked(true);
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          sessionCheckCompleteRef.current = true;
          setSessionCheckComplete(true);
        }
      }
    };

    void checkPreviousSession();

    return () => {
      cancelled = true;
    };
  }, [expireSession, preferencesLoaded]);

  const handleAppStateChange = useCallback(
    async (nextAppState: AppStateStatus) => {
      if (!mountedRef.current) return;

      // APP ENTERS BACKGROUND
      if (nextAppState === "background" || nextAppState === "inactive") {
        const backgroundAt = Date.now();
        lastActiveTimeRef.current = backgroundAt;

        try {
          const token = await SecureStore.getItemAsync("userToken");

          if (!mountedRef.current) return;

          if (token) {
            await SecureStore.setItemAsync(
              SESSION_BACKGROUND_AT_KEY,
              String(backgroundAt),
            );
          } else {
            await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
          }
        } catch (error) {
          console.error("Failed to record the background timestamp:", error);

          // We cannot safely trust the session without knowing
          // when the app entered the background.
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);

          const expired = await expireSession();

          if (!expired && mountedRef.current) {
            setIsLocked(true);
          }
        }

        return;
      }

      // Ignore transitions that are not a return to the foreground.
      if (nextAppState !== "active") return;

      // Startup must finish its first security check first.
      if (!sessionCheckCompleteRef.current) return;

      try {
        const [token, storedBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
        ]);

        if (!mountedRef.current) return;

        // No authentication token means there is no session to unlock.
        if (!token) {
          if (storedBackgroundAt) {
            await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
          }

          setIsLocked(false);
          setBiometricEnabled(false);
          biometricEnabledRef.current = false;
          lastActiveTimeRef.current = Date.now();
          return;
        }

        if (sessionVerificationFailedRef.current) {
          setIsLocked(true);
          return;
        }

        if (storedBackgroundAt) {
          const backgroundAt = Number(storedBackgroundAt);

          if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
            sessionVerificationFailedRef.current = true;
            setIsLocked(true);
            return;
          }

          const timeAway = Math.max(0, Date.now() - backgroundAt);

          // Session expiration always takes precedence over app lock.
          if (timeAway >= SESSION_TIMEOUT_MS) {
            const expired = await expireSession();

            if (!expired && mountedRef.current) {
              setIsLocked(true);
            }

            return;
          }

          if (appLockEnabledRef.current && timeAway >= lockTimeoutRef.current) {
            setIsLocked(true);
          }

          await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
        }

        if (!mountedRef.current) return;

        await checkBiometricSupport();

        if (!mountedRef.current) return;

        // Keep the existing in-process app-lock behavior as a fallback.
        const now = Date.now();
        const timeAway = Math.max(0, now - lastActiveTimeRef.current);

        if (appLockEnabledRef.current && timeAway >= lockTimeoutRef.current) {
          setIsLocked(true);
        }

        lastActiveTimeRef.current = now;
      } catch (error) {
        console.error("Failed to check the session on app resume:", error);

        sessionVerificationFailedRef.current = true;

        if (mountedRef.current) {
          setIsLocked(true);
        }
      }
    },
    [checkBiometricSupport, expireSession],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [handleAppStateChange]);

  // BIOMETRIC UNLOCK
  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    try {
      if (
        sessionExpiredRef.current ||
        expirationInProgressRef.current ||
        sessionVerificationFailedRef.current
      ) {
        return false;
      }

      const [token, storedBackgroundAt, hasHardware, isEnrolled] =
        await Promise.all([
          SecureStore.getItemAsync("userToken"),
          SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);

      if (
        !token ||
        sessionExpiredRef.current ||
        sessionVerificationFailedRef.current
      ) {
        return false;
      }

      if (storedBackgroundAt) {
        const backgroundAt = Number(storedBackgroundAt);

        if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
          return false;
        }

        if (Date.now() - backgroundAt >= SESSION_TIMEOUT_MS) {
          const expired = await expireSession();

          if (!expired) {
            setIsLocked(true);
          }

          return false;
        }
      }

      if (!hasHardware || !isEnrolled) return false;

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock DocuGuard to access your vault",
        fallbackLabel: "Use Password",
        disableDeviceFallback: false,
      });

      if (!authResult.success) return false;

      // Recheck token and timestamp after the biometric prompt.
      // The session may have expired while authentication was open.
      const [currentToken, currentBackgroundAt] = await Promise.all([
        SecureStore.getItemAsync("userToken"),
        SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
      ]);

      if (
        !currentToken ||
        sessionExpiredRef.current ||
        expirationInProgressRef.current ||
        sessionVerificationFailedRef.current
      ) {
        return false;
      }

      if (currentBackgroundAt) {
        const backgroundAt = Number(currentBackgroundAt);

        if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
          return false;
        }

        if (Date.now() - backgroundAt >= SESSION_TIMEOUT_MS) {
          const expired = await expireSession();

          if (!expired) {
            setIsLocked(true);
          }

          return false;
        }
      }

      if (mountedRef.current) {
        setIsLocked(false);
      }

      return true;
    } catch (error) {
      console.error("Biometric unlock failed:", error);
      return false;
    }
  }, [expireSession]);

  // PASSWORD UNLOCK
  const unlockWithPassword = useCallback(
    async (password: string): Promise<boolean> => {
      try {
        if (
          !password ||
          sessionExpiredRef.current ||
          expirationInProgressRef.current ||
          sessionVerificationFailedRef.current
        ) {
          return false;
        }

        const [storedToken, storedBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
        ]);

        if (
          !storedToken ||
          sessionExpiredRef.current ||
          sessionVerificationFailedRef.current
        ) {
          return false;
        }

        if (storedBackgroundAt) {
          const backgroundAt = Number(storedBackgroundAt);

          if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
            sessionVerificationFailedRef.current = true;
            setIsLocked(true);
            return false;
          }

          if (Date.now() - backgroundAt >= SESSION_TIMEOUT_MS) {
            const expired = await expireSession();

            if (!expired) {
              setIsLocked(true);
            }

            return false;
          }
        }

        const profile = await getUserProfile();
        const email = profile?.email?.trim();

        if (!email) return false;

        const response = await api.auth.login({
          email,
          password,
        });

        // Never let an in-progress expiration or 2FA requirement
        // be bypassed by the password-unlock flow.
        if (
          !response.token ||
          response.requiresTwoFactor ||
          sessionExpiredRef.current ||
          expirationInProgressRef.current ||
          sessionVerificationFailedRef.current
        ) {
          return false;
        }

        // Recheck the original session before replacing its token.
        const [currentToken, currentBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
        ]);

        if (
          !currentToken ||
          sessionExpiredRef.current ||
          expirationInProgressRef.current ||
          sessionVerificationFailedRef.current
        ) {
          return false;
        }

        if (currentBackgroundAt) {
          const backgroundAt = Number(currentBackgroundAt);

          if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
            sessionVerificationFailedRef.current = true;
            setIsLocked(true);
            return false;
          }

          if (Date.now() - backgroundAt >= SESSION_TIMEOUT_MS) {
            const expired = await expireSession();

            if (!expired) {
              setIsLocked(true);
            }

            return false;
          }
        }

        await SecureStore.setItemAsync("userToken", response.token);

        if (response.user?.id != null) {
          await switchLocalUser(response.user.id);
        }

        const verifiedToken = await SecureStore.getItemAsync("userToken");

        if (
          !verifiedToken ||
          sessionExpiredRef.current ||
          expirationInProgressRef.current ||
          sessionVerificationFailedRef.current
        ) {
          return false;
        }

        // The password flow only unlocks a still-valid session.
        if (mountedRef.current) {
          setIsLocked(false);
        }

        return true;
      } catch (error) {
        console.error("Password unlock failed:", error);
        return false;
      }
    },
    [expireSession],
  );

  return {
    isLocked,
    appLockEnabled,
    biometricEnabled,
    sessionExpired,
    sessionCheckComplete,
    resetSessionExpired,
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

    scaleAnim.value = withSpring(1, {
      damping: 18,
      stiffness: 120,
    });

    buttonScale.value = withSpring(1, {
      damping: 14,
      stiffness: 100,
    });
  }, [fadeAnim, scaleAnim, buttonScale]);

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
  }, [iconScale, iconOpacity]);

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
    if (authenticating) return;

    setAuthenticating(true);
    setErrorMsg("");

    try {
      const success = await onUnlockBiometric();

      if (!success) {
        setErrorMsg(
          "Unable to unlock. Your session may have expired. Please sign in again if prompted.",
        );
      }
    } catch (error) {
      console.error("Biometric unlock action failed:", error);
      setErrorMsg("Unable to verify your identity. Try again.");
    } finally {
      setAuthenticating(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!passwordInput || authenticating) return;

    setAuthenticating(true);
    setErrorMsg("");

    try {
      const success = await onUnlockPassword(passwordInput);

      if (success) {
        setPasswordInput("");
      } else {
        setErrorMsg(
          "Unable to unlock. Check your password or sign in again if your session has expired.",
        );
      }
    } catch (error) {
      console.error("Password unlock action failed:", error);
      setErrorMsg("Unable to unlock your vault. Please try again.");
    } finally {
      setAuthenticating(false);
    }
  };

  if (!isLocked) return null;

  return (
    <LinearGradient
      colors={["#0B1120", "#0F172A", "#1E293B"]}
      style={[styles.gradient, StyleSheet.absoluteFill, { zIndex: 9999 }]}
    >
      <BlurView intensity={30} tint="dark" style={styles.blurOverlay} />

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
                onPress={() => {
                  setUsePasswordMode(true);
                  setErrorMsg("");
                }}
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
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handlePasswordSubmit}
                returnKeyType="done"
              />

              <TouchableOpacity
                style={styles.button}
                onPress={handlePasswordSubmit}
                disabled={authenticating || !passwordInput}
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
                  setPasswordInput("");
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
  gradient: {
    flex: 1,
  },
  blurOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
  safeArea: {
    flex: 1,
  },
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
