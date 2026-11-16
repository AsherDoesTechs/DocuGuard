import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import CustomSplashScreen from "../components/CustomSplashScreen";
import { PhoneLayout } from "../components/PhoneLayout";
import { AdminToastProvider } from "../components/AdminToast";
import { AdminSensitiveAuthProvider } from "../components/AdminSensitiveAuthModal";
import { AdminColors } from "../theme/adminTheme";

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (Platform.OS === "web" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[PWA] Service worker registration failed", err);
      });
    }
  }, []);

  if (showSplash) {
    return (
      <PhoneLayout>
        <CustomSplashScreen onAnimationFinished={() => setShowSplash(false)} />
      </PhoneLayout>
    );
  }

  return (
    <AdminToastProvider>
      <AdminSensitiveAuthProvider>
        <PhoneLayout>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "slide_from_right",
              contentStyle: { backgroundColor: AdminColors.background },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="dashboard" />
            <Stack.Screen name="documents" />
            <Stack.Screen name="health" />
            <Stack.Screen name="logs" />
            <Stack.Screen name="users" />
          </Stack>
        </PhoneLayout>
      </AdminSensitiveAuthProvider>
    </AdminToastProvider>
  );
}
