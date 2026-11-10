import { useCallback, useEffect, useMemo, useState } from "react";
import { InteractionManager } from "react-native";
import { Stack, useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreenModule from "expo-splash-screen";

import { useAppLock, AppLockScreen } from "../hooks/useAppLock";
import { initDatabase } from "../services/localDatabase";
import { checkAndScheduleAlerts } from "../services/notificationScheduler";
import { syncWorker } from "@/services/syncWorker";

import { AlertProvider } from "@/components/ui/AlertService";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/components/ui/ToastProvider";
import PushNotificationToastBridge from "@/components/PushNotificationToastBridge";
import SplashScreen from "@/components/ui/SplashScreen";
import OnboardingScreen, {
  ONBOARDING_STORAGE_KEY,
} from "@/components/ui/OnboardingScreen";
import PrivacyConsentScreen, {
  PRIVACY_CONSENT_STORAGE_KEY,
  PRIVACY_NOTICE_VERSION,
} from "@/components/ui/PrivacyConsentScreen";
import { ENABLE_ONBOARDING } from "@/constants/featureFlags";

SplashScreenModule.preventAutoHideAsync().catch(() => {});

type StartupStep = "checking" | "privacy" | "onboarding" | "ready";

export default function RootLayout() {
  const router = useRouter();

  const [startupStep, setStartupStep] = useState<StartupStep>("checking");
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

  // Single strict waterfall check for Privacy -> Onboarding -> Ready
  useEffect(() => {
    let cancelled = false;

    const checkStartupSequence = async () => {
      try {
        // --- Step 1: Check Privacy Consent ---
        const storedPrivacy = await AsyncStorage.getItem(
          PRIVACY_CONSENT_STORAGE_KEY,
        );
        let privacyAccepted = false;

        if (storedPrivacy) {
          try {
            const record = JSON.parse(storedPrivacy);
            privacyAccepted =
              record?.noticeVersion === PRIVACY_NOTICE_VERSION &&
              record?.noticeAcknowledged === true &&
              record?.processingAgreed === true &&
              typeof record?.acceptedAt === "string" &&
              !Number.isNaN(Date.parse(record.acceptedAt));
          } catch {
            privacyAccepted = false;
          }
        }

        if (!privacyAccepted) {
          if (!cancelled) setStartupStep("privacy");
          return;
        }

        // --- Step 2: Check Onboarding (only if Privacy complete) ---
        if (ENABLE_ONBOARDING) {
          const completedOnboarding = await AsyncStorage.getItem(
            ONBOARDING_STORAGE_KEY,
          );
          if (completedOnboarding !== "true") {
            if (!cancelled) setStartupStep("onboarding");
            return;
          }
        }

        // --- Step 3: All prerequisites complete ---
        if (!cancelled) {
          setStartupStep("ready");
        }
      } catch (error) {
        console.warn("Failed to check startup sequence:", error);
        if (!cancelled) {
          setStartupStep("privacy");
        }
      }
    };

    void checkStartupSequence();

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize the local database and background services
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
      } catch (error) {
        console.error("Failed to initialize local database:", error);

        if (!cancelled) {
          setDatabaseReady(true);
        }
      }
    };

    void initializeApp();

    return () => {
      cancelled = true;
    };
  }, []);

  // Hide system splash after the first post-startup screen has had a chance to paint
  useEffect(() => {
    if (databaseReady && startupStep !== "checking") {
      let cancelled = false;

      const hide = () => {
        if (!cancelled) {
          SplashScreenModule.hideAsync().catch(() => {});
        }
      };

      const task = InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(hide);
      });

      return () => {
        cancelled = true;
        task.cancel();
      };
    }
  }, [databaseReady, startupStep]);

  // Execute Auth routing only after startup checks reach "ready"
  useEffect(() => {
    if (startupStep !== "ready" || !sessionCheckComplete || sessionExpired) {
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
  }, [startupStep, sessionCheckComplete, sessionExpired, router]);

  // Handle session expiration routing
  useEffect(() => {
    if (!sessionExpired || startupStep !== "ready") {
      return;
    }

    setIsLocked(false);
    setAuthChecked(false);
    setShowSplash(false);

    router.replace("/(auth)/login" as any);

    resetSessionExpired();
  }, [sessionExpired, startupStep, router, setIsLocked, resetSessionExpired]);

  const isStartupLoading =
    startupStep === "checking" ||
    !databaseReady ||
    (startupStep === "ready" && (!sessionCheckComplete || !authChecked));

  const handlePrivacyComplete = useCallback(() => {
    setAuthChecked(false);
    setShowSplash(true);

    // Verify if Onboarding is required immediately after Privacy Consent
    AsyncStorage.getItem(ONBOARDING_STORAGE_KEY).then((completed) => {
      if (ENABLE_ONBOARDING && completed !== "true") {
        setStartupStep("onboarding");
      } else {
        setStartupStep("ready");
      }
    });
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setAuthChecked(false);
    setShowSplash(true);
    setStartupStep("ready");
  }, []);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  return (
    <ThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AlertProvider>
            <ToastProvider>
              {/* 
                Enforced Waterfall Sequence: 
                1. Checking / Loading -> SplashScreen
                2. Privacy Consent incomplete -> PrivacyConsentScreen
                3. Privacy complete, Onboarding incomplete -> OnboardingScreen
                4. Prerequisites complete -> Stack & App Lock
              */}
              {startupStep === "checking" || !databaseReady ? (
                <SplashScreen isLoading={true} onComplete={() => {}} />
              ) : startupStep === "privacy" ? (
                <PrivacyConsentScreen onComplete={handlePrivacyComplete} />
              ) : startupStep === "onboarding" ? (
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
              <PushNotificationToastBridge
                enabled={
                  startupStep === "ready" &&
                  !showSplash &&
                  !isLocked &&
                  !sessionExpired
                }
              />
            </ToastProvider>
          </AlertProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
