import React, { useEffect, useState, useCallback, useRef } from "react";
import { AppState, AppStateStatus, DeviceEventEmitter } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import {
  getActiveLocalUserIdStrict,
  getLocalDataOwnerIdForSessionExpiration,
  getUserProfile,
  switchLocalUser,
} from "../services/localDatabase";
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

const APP_LOCK_ENABLED_KEY = "docuguard.appLock.enabled"; // legacy/global
const APP_LOCK_TIMEOUT_KEY = "docuguard.appLock.timeout";
const SESSION_BACKGROUND_AT_KEY = "docuguard.session.backgroundAt";

const getBiometricEnabledKey = (userId: number) =>
  `docuguard.security.biometricEnabled.user.${userId}`;
const getAppLockEnabledKey = (userId: number) =>
  `docuguard.security.appLockEnabled.user.${userId}`;

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
  const appStateRef = useRef<AppStateStatus>(AppState.currentState ?? "active");
  const backgroundTransitionIdRef = useRef(0);
  const foregroundCheckInProgressRef = useRef(false);
  const pendingForegroundCheckRef = useRef(false);
  const foregroundCheckHandlerRef = useRef<
    ((nextAppState: AppStateStatus) => Promise<void>) | null
  >(null);
  const backgroundTimestampWriteRef = useRef<Promise<void> | null>(null);
  const appLockEnabledRef = useRef(false);
  const biometricEnabledRef = useRef(false);
  const lockTimeoutRef = useRef(DEFAULT_APP_LOCK_DELAY);
  const mountedRef = useRef(true);

  // Serialize all access to the persisted background timestamp.
  const backgroundTimestampQueueRef = useRef<Promise<void>>(Promise.resolve());

  const runBackgroundTimestampOperation = async <T,>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previousOperation = backgroundTimestampQueueRef.current;

    let releaseOperation: (() => void) | undefined;
    const currentOperation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });

    backgroundTimestampQueueRef.current = currentOperation;

    await previousOperation;

    try {
      return await operation();
    } finally {
      releaseOperation?.();
    }
  };

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
        const activeUserId = await getActiveLocalUserIdStrict();
        const [storedTimeout, perUserEnabled, legacyEnabled] = await Promise.all([
          SecureStore.getItemAsync(APP_LOCK_TIMEOUT_KEY),
          activeUserId !== null
            ? SecureStore.getItemAsync(getAppLockEnabledKey(activeUserId))
            : Promise.resolve(null),
          SecureStore.getItemAsync(APP_LOCK_ENABLED_KEY),
        ]);

        if (cancelled || !mountedRef.current) return;

        let enabled = false;
        if (perUserEnabled !== null) {
          enabled = perUserEnabled === "true";
        } else if (legacyEnabled !== null) {
          enabled = legacyEnabled === "true";
          if (activeUserId !== null) {
            await SecureStore.setItemAsync(
              getAppLockEnabledKey(activeUserId),
              String(enabled),
            );
          }
        }

        setAppLockEnabled(enabled);
        appLockEnabledRef.current = enabled;

        // App Lock uses the confirmed fixed 30-second background delay.
        // Migrate any older saved timeout so it cannot override this policy.
        setLockTimeout(DEFAULT_APP_LOCK_DELAY);
        lockTimeoutRef.current = DEFAULT_APP_LOCK_DELAY;

        if (storedTimeout !== String(DEFAULT_APP_LOCK_DELAY)) {
          await SecureStore.setItemAsync(
            APP_LOCK_TIMEOUT_KEY,
            String(DEFAULT_APP_LOCK_DELAY),
          );
        }
      } catch (error) {
        console.error("Failed to load app-lock preferences:", error);

        // Preserve prior protection state on transient read failures.
        sessionVerificationFailedRef.current = true;
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
      const activeUserId = await getActiveLocalUserIdStrict();
      const [hasHardware, isEnrolled, token, biometricPreference, appLockPreference, legacyBiometric, legacyAppLock] =
        await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          SecureStore.getItemAsync("userToken"),
          activeUserId !== null
            ? SecureStore.getItemAsync(getBiometricEnabledKey(activeUserId))
            : Promise.resolve(null),
          activeUserId !== null
            ? SecureStore.getItemAsync(getAppLockEnabledKey(activeUserId))
            : Promise.resolve(null),
          SecureStore.getItemAsync("docuguard.security.biometricEnabled"),
          SecureStore.getItemAsync(APP_LOCK_ENABLED_KEY),
        ]);

      let resolvedBiometricPreference = biometricPreference;
      let resolvedAppLockPreference = appLockPreference;

      if (activeUserId !== null) {
        if (resolvedBiometricPreference === null && legacyBiometric !== null) {
          resolvedBiometricPreference = legacyBiometric;
          await SecureStore.setItemAsync(
            getBiometricEnabledKey(activeUserId),
            legacyBiometric,
          );
        }
        if (resolvedAppLockPreference === null && legacyAppLock !== null) {
          resolvedAppLockPreference = legacyAppLock;
          await SecureStore.setItemAsync(
            getAppLockEnabledKey(activeUserId),
            legacyAppLock,
          );
        }
      }

      const enabled =
        activeUserId !== null &&
        resolvedBiometricPreference === "true" &&
        hasHardware &&
        isEnrolled &&
        !!token;

      if (mountedRef.current) {
        setBiometricEnabled(enabled);
        biometricEnabledRef.current = enabled;
        const appLock =
          activeUserId !== null && resolvedAppLockPreference === "true";
        setAppLockEnabled(appLock);
        appLockEnabledRef.current = appLock;
      }

      return enabled;
    } catch (error) {
      console.warn("Biometric availability check failed:", error);

      return biometricEnabledRef.current;
    }
  }, []);

  useEffect(() => {
    void checkBiometricSupport();

    const subscription = DeviceEventEmitter.addListener(
      "docuguard.securityPreferencesChanged",
      () => {
        void checkBiometricSupport();
      },
    );

    return () => subscription.remove();
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
      // Capture a consistent token and account-owner snapshot before logout.
      const [token, ownerId] = await Promise.all([
        api.getStoredToken(),
        getLocalDataOwnerIdForSessionExpiration(),
      ]);

      const logoutConfirmed = await api.auth.logout(token, ownerId);

      // A false result means the token or owner changed while expiration
      // was pending. Preserve the current session and its timestamp.
      if (!logoutConfirmed) {
        if (mountedRef.current) {
          setIsLocked(true);
        }

        return false;
      }

      // Confirm that the persisted token is actually gone.
      const remainingToken = await SecureStore.getItemAsync("userToken");

      if (remainingToken !== null) {
        throw new Error("The authentication token still exists.");
      }

      // Timestamp cleanup failure must not reverse confirmed token deletion.
      try {
        await runBackgroundTimestampOperation(() =>
          SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY),
        );
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
    const startupTransitionId = backgroundTransitionIdRef.current;

    const isStartupCurrent = () =>
      !cancelled &&
      mountedRef.current &&
      appStateRef.current === "active" &&
      backgroundTransitionIdRef.current === startupTransitionId;

    const clearStartupTimestamp = () =>
      runBackgroundTimestampOperation(async () => {
        if (!isStartupCurrent()) return;

        await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
      });

    const checkPreviousSession = async () => {
      try {
        const [token, storedBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          runBackgroundTimestampOperation(() =>
            SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          ),
        ]);

        if (!isStartupCurrent()) return;

        if (!token) {
          if (storedBackgroundAt) {
            await clearStartupTimestamp();

            if (!isStartupCurrent()) return;
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
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
          return;
        }

        const timeAway = Math.max(0, Date.now() - backgroundAt);

        if (timeAway >= SESSION_TIMEOUT_MS) {
          const expired = await expireSession();

          if (!expired) {
            sessionVerificationFailedRef.current = true;

            if (mountedRef.current) {
              setIsLocked(true);
            }
          }

          return;
        }

        if (appLockEnabledRef.current && timeAway >= lockTimeoutRef.current) {
          setIsLocked(true);
        }

        await clearStartupTimestamp();

        if (!isStartupCurrent()) return;

        lastActiveTimeRef.current = Date.now();
      } catch (error) {
        console.error("Failed to verify the previous session:", error);

        if (isStartupCurrent()) {
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          sessionCheckCompleteRef.current = true;
          setSessionCheckComplete(true);

          if (
            pendingForegroundCheckRef.current &&
            appStateRef.current === "active"
          ) {
            pendingForegroundCheckRef.current = false;
            void Promise.resolve().then(() =>
              foregroundCheckHandlerRef.current?.("active"),
            );
          }
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

      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      // Record only the first transition away from active.
      // Preserve the timestamp through inactive -> background.
      if (nextAppState === "background" || nextAppState === "inactive") {
        if (previousAppState === "active") {
          const backgroundAt = Date.now();
          const transitionId = ++backgroundTransitionIdRef.current;

          lastActiveTimeRef.current = backgroundAt;

          const writePromise = (async () => {
            try {
              await runBackgroundTimestampOperation(async () => {
                if (
                  !mountedRef.current ||
                  backgroundTransitionIdRef.current !== transitionId
                )
                  return;

                const token = await SecureStore.getItemAsync("userToken");

                if (
                  !mountedRef.current ||
                  backgroundTransitionIdRef.current !== transitionId
                )
                  return;

                if (token) {
                  await SecureStore.setItemAsync(
                    SESSION_BACKGROUND_AT_KEY,
                    String(backgroundAt),
                  );
                } else {
                  await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
                }
              });
            } catch (error) {
              console.error(
                "Failed to record the background timestamp:",
                error,
              );

              sessionVerificationFailedRef.current = true;

              if (mountedRef.current) {
                setIsLocked(true);
              }

              const expired = await expireSession();

              if (!expired && mountedRef.current) {
                setIsLocked(true);
              }
            }
          })();

          backgroundTimestampWriteRef.current = writePromise;
          await writePromise;

          // Do not clear a newer transition's pending write.
          if (
            backgroundTransitionIdRef.current === transitionId &&
            backgroundTimestampWriteRef.current === writePromise
          ) {
            backgroundTimestampWriteRef.current = null;
          }
        }

        return;
      }

      if (nextAppState !== "active") return;

      if (!sessionCheckCompleteRef.current) {
        pendingForegroundCheckRef.current = true;
        return;
      }

      if (foregroundCheckInProgressRef.current) {
        pendingForegroundCheckRef.current = true;
        return;
      }

      pendingForegroundCheckRef.current = false;
      foregroundCheckInProgressRef.current = true;

      const resumeTransitionId = backgroundTransitionIdRef.current;

      const isForegroundCurrent = () =>
        mountedRef.current &&
        appStateRef.current === "active" &&
        backgroundTransitionIdRef.current === resumeTransitionId;

      try {
        // Finish any pending background timestamp write first.
        const pendingWrite = backgroundTimestampWriteRef.current;

        if (pendingWrite) {
          await pendingWrite;

          if (backgroundTimestampWriteRef.current === pendingWrite) {
            backgroundTimestampWriteRef.current = null;
          }
        }

        if (!isForegroundCurrent()) return;

        const [token, storedBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          runBackgroundTimestampOperation(() =>
            SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          ),
        ]);

        if (!isForegroundCurrent()) return;

        if (!token) {
          if (storedBackgroundAt) {
            await runBackgroundTimestampOperation(async () => {
              if (!isForegroundCurrent()) return;
              await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
            });
          }

          if (!isForegroundCurrent()) return;

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

          // The 30-minute session expiration takes precedence.
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
        } else if (appLockEnabledRef.current) {
          // A missing timestamp cannot establish how long the app
          // was away. Require authentication without inventing a timeout.
          setIsLocked(true);
        }

        if (!isForegroundCurrent()) return;

        await checkBiometricSupport();

        if (!isForegroundCurrent()) return;

        // Never delete a timestamp if another background transition
        // occurred while this foreground check was running.
        if (
          appStateRef.current !== "active" ||
          backgroundTransitionIdRef.current !== resumeTransitionId
        ) {
          return;
        }

        if (storedBackgroundAt) {
          await runBackgroundTimestampOperation(async () => {
            if (!isForegroundCurrent()) return;
            await SecureStore.deleteItemAsync(SESSION_BACKGROUND_AT_KEY);
          });
        }

        if (!isForegroundCurrent()) return;

        lastActiveTimeRef.current = Date.now();
      } catch (error) {
        console.error("Failed to check the session on app resume:", error);

        if (isForegroundCurrent()) {
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
        }
      } finally {
        foregroundCheckInProgressRef.current = false;

        if (
          pendingForegroundCheckRef.current &&
          mountedRef.current &&
          appStateRef.current === "active" &&
          sessionCheckCompleteRef.current
        ) {
          pendingForegroundCheckRef.current = false;
          void Promise.resolve().then(() =>
            foregroundCheckHandlerRef.current?.("active"),
          );
        }
      }
    },
    [checkBiometricSupport, expireSession],
  );

  foregroundCheckHandlerRef.current = handleAppStateChange;

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

      const activeUserId = await getActiveLocalUserIdStrict();
      const [
        token,
        storedBackgroundAt,
        hasHardware,
        isEnrolled,
        biometricPreference,
      ] = await Promise.all([
        SecureStore.getItemAsync("userToken"),
        runBackgroundTimestampOperation(() =>
          SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
        ),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        activeUserId !== null
          ? SecureStore.getItemAsync(getBiometricEnabledKey(activeUserId))
          : Promise.resolve(null),
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

      if (biometricPreference !== "true" || !hasHardware || !isEnrolled)
        return false;

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock DocuGuard to access your vault",
        fallbackLabel: "Use Password",
        disableDeviceFallback: false,
      });

      if (!authResult.success) return false;

      // Recheck token and timestamp after the biometric prompt.
      // The session may have expired while authentication was open.
      const currentUserId = await getActiveLocalUserIdStrict();
      const [currentToken, currentBackgroundAt, currentBiometricPreference] =
        await Promise.all([
          SecureStore.getItemAsync("userToken"),
          runBackgroundTimestampOperation(() =>
            SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          ),
          currentUserId !== null
            ? SecureStore.getItemAsync(getBiometricEnabledKey(currentUserId))
            : Promise.resolve(null),
        ]);

      if (currentBiometricPreference !== "true") {
        if (mountedRef.current) {
          setBiometricEnabled(false);
          biometricEnabledRef.current = false;
        }
        return false;
      }

      if (
        !currentToken ||
        currentToken !== token ||
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

      const sessionValid = await api.validateStoredSession(token);
      if (!sessionValid) return false;

      const [verifiedToken, verifiedBackgroundAt, verifiedBiometricPreference] =
        await Promise.all([
          SecureStore.getItemAsync("userToken"),
          runBackgroundTimestampOperation(() =>
            SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          ),
          SecureStore.getItemAsync("biometricEnabled"),
        ]);

      if (
        verifiedToken !== token ||
        verifiedBiometricPreference !== "true" ||
        sessionExpiredRef.current ||
        expirationInProgressRef.current ||
        sessionVerificationFailedRef.current
      ) {
        return false;
      }

      if (verifiedBackgroundAt) {
        const backgroundAt = Number(verifiedBackgroundAt);

        if (!Number.isFinite(backgroundAt) || backgroundAt <= 0) {
          sessionVerificationFailedRef.current = true;
          setIsLocked(true);
          return false;
        }

        if (Date.now() - backgroundAt >= SESSION_TIMEOUT_MS) {
          const expired = await expireSession();

          if (!expired) setIsLocked(true);
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
          runBackgroundTimestampOperation(() =>
            SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          ),
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

        // Type-safe check using casting for potential server extension properties like tempToken
        const loginResponse = response as any;

        // Never let an in-progress expiration or strict 2FA challenge
        // be bypassed by the password-unlock flow if 2FA is active.
        if (
          !response.token ||
          loginResponse.requiresTwoFactor ||
          typeof response.user?.id !== "number" ||
          !Number.isSafeInteger(response.user.id) ||
          response.user.id <= 0 ||
          sessionExpiredRef.current ||
          expirationInProgressRef.current ||
          sessionVerificationFailedRef.current
        ) {
          return false;
        }

        // Recheck the original session before replacing its token.
        const [currentToken, currentBackgroundAt] = await Promise.all([
          SecureStore.getItemAsync("userToken"),
          runBackgroundTimestampOperation(() =>
            SecureStore.getItemAsync(SESSION_BACKGROUND_AT_KEY),
          ),
        ]);

        if (
          !currentToken ||
          currentToken !== storedToken ||
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

        // Safely assert response.token is present for replacement
        const newToken = response.token;
        if (!newToken) return false;

        const tokenReplaced = await api.replaceAuthTokenIfCurrent(
          storedToken,
          newToken,
        );

        if (!tokenReplaced) return false;

        try {
          await switchLocalUser(response.user!.id);
        } catch (error) {
          try {
            await api.clearAuthTokenIfMatches(newToken);
          } catch (cleanupError) {
            console.error(
              "Password unlock token cleanup failed:",
              cleanupError,
            );
          }
          throw error;
        }

        const verifiedToken = await SecureStore.getItemAsync("userToken");

        if (verifiedToken !== newToken) {
          try {
            await api.clearAuthTokenIfMatches(newToken);
          } catch (cleanupError) {
            console.error(
              "Password unlock token cleanup failed:",
              cleanupError,
            );
          }
          return false;
        }

        if (
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


  // Inactivity timeout (FR-003): lock after 30 minutes without interaction while app is active
  useEffect(() => {
    if (!appLockEnabled) return;
    const interval = setInterval(() => {
      if (appStateRef.current !== "active" || isLocked || sessionExpiredRef.current) return;
      const idleMs = Date.now() - lastActiveTimeRef.current;
      if (idleMs >= SESSION_TIMEOUT_MS) {
        setIsLocked(true);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [appLockEnabled, isLocked]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") lastActiveTimeRef.current = Date.now();
    });
    // touch/activity updates can be wired from UI; at minimum update on resume
    return () => sub.remove();
  }, []);
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
