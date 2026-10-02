// app/_layout.tsx
import { useEffect } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useAppLock, AppLockScreen } from "../hooks/useAppLock";
import { initDatabase } from "../services/localDatabase";
import { checkAndScheduleAlerts } from "../services/notificationScheduler";
import { AlertProvider } from "@/components/ui/AlertService";
import { ThemeProvider } from "@/context/ThemeContext";

export default function RootLayout() {
  usePushNotifications();
  const {
    isLocked,
    biometricEnabled,
    unlockWithBiometric,
    unlockWithPassword,
  } = useAppLock();

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

  return (
    <ThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AlertProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="add-document" />
              <Stack.Screen name="edit-document/[id]" />
              <Stack.Screen name="document-details/[id]" />
              <Stack.Screen name="subscription-payment" />
              <Stack.Screen name="biometric-login" />
            </Stack>
            {isLocked && (
              <AppLockScreen
                isLocked={isLocked}
                biometricEnabled={biometricEnabled}
                onUnlockBiometric={unlockWithBiometric}
                onUnlockPassword={unlockWithPassword}
              />
            )}
          </AlertProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
