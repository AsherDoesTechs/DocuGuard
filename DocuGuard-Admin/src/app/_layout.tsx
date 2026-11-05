import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
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
