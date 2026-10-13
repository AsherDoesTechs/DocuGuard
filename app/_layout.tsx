// app/_layout.tsx
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useAppLock, AppLockScreen } from "../hooks/useAppLock";
import { initDatabase } from "../services/localDatabase";
import { checkAndScheduleAlerts } from "../services/notificationScheduler";
import { AlertProvider } from "@/components/ui/AlertService";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/components/ui/ToastProvider";
import * as SecureStore from "expo-secure-store";
import * as NativeSplashScreen from "expo-splash-screen";
import { useRouter } from "expo-router";
import SplashScreen from "@/components/ui/SplashScreen";

NativeSplashScreen.preventAutoHideAsync().catch(() => {
  // Native splash state can already be initialized during fast refresh.
});

export default function RootLayout() {
  usePushNotifications();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [splashDelayDone, setSplashDelayDone] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const {
    isLocked,
    biometricEnabled,
    unlockWithBiometric,
    unlockWithPassword,
  } = useAppLock();

  useEffect(() => {
    NativeSplashScreen.hideAsync().catch(() => {
      // The native splash may already be hidden after a hot reload.
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSplashDelayDone(true), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Sequential, not parallel. The scheduler reads documents straight after
    // init, so running them concurrently let the scheduler query tables that
    // CREATE TABLE had not yet committed: the first launch after a fresh
    // install scheduled nothing, or threw "no such table".
    let cancelled = false;

    (async () => {
      try {
        await initDatabase();
      } catch (err) {
        console.warn("Failed to initialize local database:", err);
        return;
      }

      if (cancelled) return;

      try {
        await checkAndScheduleAlerts();
      } catch (err) {
        console.warn("Failed to schedule alerts:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Auth guard - check for token and redirect to login if not authenticated
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await SecureStore.getItemAsync("userToken");
        if (!token) {
          router.replace("/(auth)/login" as any);
        }
      } catch (err) {
        console.warn("Auth check failed:", err);
      } finally {
        setAuthChecked(true);
      }
    };

    checkAuth();
  }, [router]);

  return (
    <ThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AlertProvider>
            <ToastProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="add-document" />
                <Stack.Screen name="edit-document/[id]" />
                <Stack.Screen name="document-details/[id]" />
                <Stack.Screen name="subscription-payment" />
              </Stack>
              {isLocked && (
                <AppLockScreen
                  isLocked={isLocked}
                  biometricEnabled={biometricEnabled}
                  onUnlockBiometric={unlockWithBiometric}
                  onUnlockPassword={unlockWithPassword}
                />
              )}
              {showSplash && (
                <SplashScreen
                  isLoading={!authChecked || !splashDelayDone}
                  onComplete={() => setShowSplash(false)}
                />
              )}
            </ToastProvider>
          </AlertProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
