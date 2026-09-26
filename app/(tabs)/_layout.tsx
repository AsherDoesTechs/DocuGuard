import { Tabs, usePathname, useRouter } from "expo-router";
import { useAppLock, AppLockScreen } from "../../hooks/useAppLock";
import { useEffect, useState, useCallback } from "react";
import { TabBar } from "../../components/ui/TabBar";

const TAB_ITEMS = [
  {
    name: "index",
    icon: "home" as const,
    label: "Home",
  },
  {
    name: "documents",
    icon: "document-text" as const,
    label: "Docs",
  },
  {
    name: "reminders",
    icon: "notifications" as const,
    label: "Alerts",
  },
  {
    name: "profile",
    icon: "person" as const,
    label: "Profile",
  },
];

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const {
    isLocked,
    biometricEnabled,
    unlockWithBiometric,
    unlockWithPassword,
  } = useAppLock();

  const [showLockScreen, setShowLockScreen] = useState(false);

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
    return success;
  }, [unlockWithBiometric]);

  const handleUsePassword = useCallback(
    async (password: string) => {
      const success = await unlockWithPassword(password);
      if (success) {
        setShowLockScreen(false);
      }
      return success;
    },
    [unlockWithPassword],
  );

  const handleTabPress = useCallback(
    (tabName: string) => {
      // Home/index route
      if (tabName === "index") {
        router.push("/");
        return;
      }

      // Other tab routes
      router.push(`/${tabName}` as any);
    },
    [router],
  );

  const activeTabName =
    pathname === "/" || pathname.endsWith("/index")
      ? "index"
      : pathname.split("/").filter(Boolean).pop() || "index";

  if (showLockScreen) {
    return (
      <AppLockScreen
        isLocked={true}
        biometricEnabled={biometricEnabled}
        onUnlockBiometric={handleUnlock}
        onUnlockPassword={handleUsePassword}
      />
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={() => (
        <TabBar
          tabs={TAB_ITEMS}
          activeTab={activeTabName}
          onTabPress={handleTabPress}
        />
      )}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
        }}
      />

      <Tabs.Screen
        name="documents"
        options={{
          title: "Documents",
        }}
      />

      <Tabs.Screen
        name="reminders"
        options={{
          title: "Reminders",
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
        }}
      />
    </Tabs>
  );
}
