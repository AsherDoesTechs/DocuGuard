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
import { ThemeProvider, useColors, useIsDark } from "@/context/ThemeContext";
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

function RootLayoutNav() {
  const router = useRouter();
  const isDark = useIsDark();
  const colors = useColors();

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

  useEffect(() => {
    let cancelled = false;

    const isPrivacyConsentAccepted = (
      storedPrivacy: string | null,
    ): boolean => {
      if (!storedPrivacy) return false;
      try {
        const record = JSON.parse(storedPrivacy);
        return (
          record?.noticeVersion === PRIVACY_NOTICE_VERSION &&
          record?.noticeAcknowledged === true &&
          record?.processingAgreed === true &&
          typeof record?.acceptedAt === "string" &&
          !Number.isNaN(Date.parse(record.acceptedAt))
        );
      } catch {
        return false;
      }
    };

    const checkStartupSequence = async () => {
      try {
        const storedPrivacy = await AsyncStorage.getItem(
          PRIVACY_CONSENT_STORAGE_KEY,
        );
        const privacyAccepted = isPrivacyConsentAccepted(storedPrivacy);
        if (!privacyAccepted) {
          if (!cancelled) setStartupStep("privacy");
          return;
        }
        if (ENABLE_ONBOARDING) {
          const completedOnboarding = await AsyncStorage.getItem(
            ONBOARDING_STORAGE_KEY,
          );
          if (completedOnboarding !== "true") {
            if (!cancelled) setStartupStep("onboarding");
            return;
          }
        }
        if (!cancelled) setStartupStep("ready");
      } catch (error) {
        console.warn("Failed to check startup sequence:", error);
        if (!cancelled) setStartupStep("privacy");
      }
    };

    void checkStartupSequence();
    return () => {
      cancelled = true;
    };
  }, []);

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
        if (!cancelled) setDatabaseReady(true);
      }
    };
    void initializeApp();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (databaseReady && startupStep !== "checking") {
      let cancelled = false;
      const hide = () => {
        if (!cancelled) SplashScreenModule.hideAsync().catch(() => {});
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

  useEffect(() => {
    if (
      startupStep !== "ready" ||
      !databaseReady ||
      !sessionCheckComplete ||
      sessionExpired ||
      authChecked
    ) {
      return;
    }
    let cancelled = false;
    const checkAuthAndSync = async () => {
      try {
        const token = await SecureStore.getItemAsync("userToken");
        if (!token) {
          if (!cancelled) router.replace("/(auth)/login" as any);
          return;
        }
        void (syncWorker as any).kick?.().catch((error: any) => {
          console.warn("Background sync kick failed:", error);
        });
      } catch (error) {
        console.error("Auth check failed:", error);
        if (!cancelled) router.replace("/(auth)/login" as any);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    void checkAuthAndSync();
    return () => {
      cancelled = true;
    };
  }, [
    startupStep,
    databaseReady,
    sessionCheckComplete,
    sessionExpired,
    authChecked,
    router,
  ]);

  useEffect(() => {
    if (!sessionExpired || startupStep !== "ready") return;
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

  const handlePrivacyComplete = useCallback(async () => {
    setAuthChecked(false);
    setShowSplash(true);
    try {
      if (ENABLE_ONBOARDING) {
        const completed = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        setStartupStep(completed === "true" ? "ready" : "onboarding");
        return;
      }
    } catch (error) {
      console.warn(
        "Failed to check onboarding status after privacy consent:",
        error,
      );
    }
    setStartupStep("ready");
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
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <SafeAreaProvider>
        <AlertProvider>
          <ToastProvider>
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
                    contentStyle: { backgroundColor: colors.background },
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="add-document" />
                  <Stack.Screen name="edit-document/[id]" />
                  <Stack.Screen name="document-details/[id]" />
                  <Stack.Screen name="subscription-payment" />
                  <Stack.Screen name="document-activity-history" />
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
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutNav />
    </ThemeProvider>
  );
}
