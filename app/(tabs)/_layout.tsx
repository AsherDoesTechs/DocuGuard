import { Tabs, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";
import { Platform } from "react-native";
import { useAppLock, AppLockScreen } from "../../hooks/useAppLock";
import { useEffect, useState, useCallback } from "react";
import { TabBar } from "../../components/ui/TabBar";

const TAB_ITEMS = [
  { name: "home", icon: "home" as const, label: "Home" },
  { name: "documents", icon: "document-text" as const, label: "Docs" },
  { name: "reminders", icon: "notifications" as const, label: "Alerts" },
  { name: "profile", icon: "person" as const, label: "Profile" },
  { name: "sync", icon: "cloud-upload" as const, label: "Sync" },
];

export default function TabsLayout() {
  const router = useRouter();
  const { isLocked, biometricEnabled, unlockWithBiometric, unlockWithPassword } = useAppLock();
  const [showLockScreen, setShowLockScreen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (isLocked) {
      setShowLockScreen(true);
    }
  }, [isLocked]);

  const handleUnlock = useCallback(async () => {
    const success = await unlockWithBiometric();
    if (success) {
      setShowLockScreen(false);
    }
  }, [unlockWithBiometric]);

  const handleUsePassword = useCallback(() => {
    unlockWithPassword();
    setShowLockScreen(false);
  }, [unlockWithPassword]);

  const handleTabPress = useCallback(
    (tabName: string) => {
      router.push(`/(tabs)/${tabName}` as any);
    },
    [router],
  );

  const activeTabName = pathname.split("/").pop() || "index";

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
      tabBar={(props) => (
        <TabBar
          tabs={TAB_ITEMS}
          activeTab={activeTabName}
          onTabPress={handleTabPress}
        />
      )}
    >
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
