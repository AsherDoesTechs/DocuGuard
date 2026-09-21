import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";
import { Platform } from "react-native";
import { useAppLock, AppLockScreen } from "../../hooks/useAppLock";
import { useEffect, useState } from "react";

export default function TabsLayout() {
  const { isLocked, biometricEnabled, unlockWithBiometric, unlockWithPassword } = useAppLock();
  const [showLockScreen, setShowLockScreen] = useState(false);

  useEffect(() => {
    if (isLocked) {
      setShowLockScreen(true);
    }
  }, [isLocked]);

  const handleUnlock = async () => {
    const success = await unlockWithBiometric();
    if (success) {
      setShowLockScreen(false);
    }
  };

  const handleUsePassword = () => {
    unlockWithPassword();
    setShowLockScreen(false);
  };

  if (showLockScreen) {
    return (
      <AppLockScreen
        isLocked={true}
        biometricEnabled={biometricEnabled}
        onUnlock={handleUnlock}
        onUsePassword={handleUsePassword}
      />
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 85 : 65,
          paddingBottom: Platform.OS === "ios" ? 25 : 10,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <Ionicons name="home" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: "Documents",
          tabBarIcon: ({ color }) => (
            <Ionicons name="document-text" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reminders"
        options={{
          title: "Reminders",
          tabBarIcon: ({ color }) => (
            <Ionicons name="notifications" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <Ionicons name="person" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: "Sync",
          tabBarIcon: ({ color }) => (
            <Ionicons name="cloud-upload" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
