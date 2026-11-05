import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import CustomSplashScreen from "../components/CustomSplashScreen";

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <CustomSplashScreen onAnimationFinished={() => setShowSplash(false)} />;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
          contentStyle: { backgroundColor: "#F5F7FB" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="documents" />
        <Stack.Screen name="health" />
        <Stack.Screen name="logs" />
        <Stack.Screen name="users" />
      </Stack>
    </>
  );
}
