// app/_layout.tsx
import { useEffect } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { initDatabase } from "../services/localDatabase";
import { checkAndScheduleAlerts } from "../services/notificationScheduler";
import { AlertProvider } from "@/components/ui/AlertService";

export default function RootLayout() {
  usePushNotifications();

  useEffect(() => {
    initDatabase().catch((err) => {
      console.warn("Failed to initialize local database:", err);
    });

    checkAndScheduleAlerts().catch((err) => {
      console.warn("Failed to schedule alerts:", err);
    });
  }, []);

  return (
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
        </AlertProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
