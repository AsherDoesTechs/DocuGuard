import { useCallback, useEffect, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { usePushNotifications } from "../hooks/usePushNotifications";
import { useAppLock, AppLockScreen } from "../hooks/useAppLock";
import { initDatabase } from "../services/localDatabase";
import { checkAndScheduleAlerts } from "../services/notificationScheduler";
import { syncWorker } from "@/services/syncWorker";

import { AlertProvider } from "@/components/ui/AlertService";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/components/ui/ToastProvider";
import SplashScreen from "@/components/ui/SplashScreen";
import OnboardingScreen, {
  ONBOARDING_STORAGE_KEY,
} from "@/components/ui/OnboardingScreen";
import { ENABLE_ONBOARDING } from "@/constants/featureFlags";

type OnboardingStatus = "checking" | "needed" | "complete";

export default function RootLayout() {
  usePushNotifications();

  const router = useRouter();

  const [onboardingStatus, setOnboardingStatus] =
    useState<OnboardingStatus>("checking");
  const [authChecked, setAuthChecked] = useState(false);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const {
    isLocked,
    biometricEnabled,
    unlockWithBiometric,
    unlockWithPassword,
    sessionExpired,
    sessionCheckComplete,
    resetSessionExpired,
    setIsLocked,
  } = useAppLock();

  // Check whether first-time onboarding should be displayed.
  useEffect(() => {
    let cancelled = false;

    const checkOnboarding = async () => {
      try {
        if (!ENABLE_ONBOARDING) {
          if (!cancelled) {
            setOnboardingStatus("complete");
          }
          return;
        }

        const completed = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);

        if (!cancelled) {
          setOnboardingStatus(completed === "true" ? "complete" : "needed");
        }
      } catch (error) {
        console.warn("Failed to check onboarding status:", error);

        if (!cancelled) {
          // Onboarding storage failure must not bypass authentication.
          setOnboardingStatus("complete");
        }
      }
    };

    void checkOnboarding();

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize the local database and schedule relevant alerts.
  useEffect(() => {
    let cancelled = false;

    const initializeApp = async () => {
      try {
        await initDatabase();

        if (cancelled) return;

        setDatabaseReady(true);

        try {
          await checkAndScheduleAlerts();
        } catch (error) {
          console.warn("Failed to schedule alerts:", error);
        }

        /*
         * Start the retry worker.
         *
         * Without it a document saved while offline stayed unsynchronised
         * until the user happened to open the Cloud Sync screen and press
         * "Sync now". The worker only pushes records that are already queued
         * and never removes local data.
         */
        syncWorker.start();
      } catch (error) {
        console.error("Failed to initialize local database:", error);

        if (!cancelled) {
          // Prevent an initialization error from blocking startup forever.
          // Database-dependent screens should still handle database errors.
          setDatabaseReady(true);
        }
      }
    };

    void initializeApp();

    return () => {
      cancelled = true;
    };
  }, []);

  // Check authentication only after onboarding and the persisted-session
  // startup check have completed.
  useEffect(() => {
    if (
      onboardingStatus !== "complete" ||
      !sessionCheckComplete ||
      sessionExpired
    ) {
      return;
    }

    let cancelled = false;

    const checkAuth = async () => {
      try {
        const token = await SecureStore.getItemAsync("userToken");

        if (cancelled) return;

        if (!token) {
          router.replace("/(auth)/login" as any);
        }
      } catch (error) {
        console.error("Failed to check authentication:", error);

        if (!cancelled) {
          router.replace("/(auth)/login" as any);
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    };

    void checkAuth();

    return () => {
      cancelled = true;
    };
  }, [onboardingStatus, sessionCheckComplete, sessionExpired, router]);

  // Handle session expiration in one place.
  // Expired sessions must return to login, not the app-lock screen.
  useEffect(() => {
    if (!sessionExpired || onboardingStatus !== "complete") {
      return;
    }

    setIsLocked(false);
    setAuthChecked(false);
    setShowSplash(false);

    router.replace("/(auth)/login" as any);

    // The hook remains responsible for expiring and clearing the session.
    // This resets the notification flag after requesting navigation.
    resetSessionExpired();
  }, [
    sessionExpired,
    onboardingStatus,
    router,
    setIsLocked,
    resetSessionExpired,
  ]);

  const isStartupLoading =
    onboardingStatus === "checking" ||
    !databaseReady ||
    (onboardingStatus === "complete" &&
      (!sessionCheckComplete || !authChecked));

  // Called when onboarding has finished.
  const handleOnboardingComplete = useCallback(() => {
    setAuthChecked(false);
    setShowSplash(true);
    setOnboardingStatus("complete");
  }, []);

  // SplashScreen owns its animation and calls this when its exit
  // animation finishes. It can safely dismiss the splash at that point.
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  // If startup finishes after the splash animation callback has already
  // fired, hide the splash once startup is ready. This avoids leaving a
  // completed splash visible indefinitely.

  return (
    <ThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AlertProvider>
            <ToastProvider>
              {onboardingStatus === "needed" ? (
                <OnboardingScreen onComplete={handleOnboardingComplete} />
              ) : (
                <>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      animation: "fade",
                    }}
                  >
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(auth)" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="add-document" />
                    <Stack.Screen name="edit-document/[id]" />
                    <Stack.Screen name="document-details/[id]" />
                    <Stack.Screen name="subscription-payment" />
                  </Stack>

                  {isLocked && !sessionExpired && (
                    <AppLockScreen
                      isLocked={isLocked}
                      biometricEnabled={biometricEnabled}
                      onUnlockBiometric={unlockWithBiometric}
                      onUnlockPassword={unlockWithPassword}
                    />
                  )}

                  {showSplash && (
                    <SplashScreen
                      isLoading={isStartupLoading}
                      onComplete={handleSplashComplete}
                    />
                  )}
                </>
              )}
            </ToastProvider>
          </AlertProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
