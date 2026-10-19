import { Tabs, usePathname, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
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
    name: "add-document",
    icon: "add" as const,
    label: "Scan",
    isActionBtn: true, // Special flag to style this item differently in your custom TabBar component
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

// Actual navigable tab routes used for swipe gesture navigation (excludes the action button)
const TAB_ROUTES = ["/", "/documents", "/reminders", "/profile"] as const;

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const handleTabPress = useCallback(
    (tabName: string) => {
      // If the middle action button is clicked, navigate to add document
      if (tabName === "add-document") {
        router.push("/add-document" as any);
        return;
      }

      // Home/index route
      if (tabName === "index") {
        router.push("/");
        return;
      }

      // Other standard tab routes
      router.push(`/${tabName}` as any);
    },
    [router],
  );

  const activeTabName =
    pathname === "/" || pathname.endsWith("/index")
      ? "index"
      : pathname.split("/").filter(Boolean).pop() || "index";

  const activeTabIndex = Math.max(
    0,
    TAB_ROUTES.findIndex((route) => {
      if (route === "/") return activeTabName === "index";
      return route === `/${activeTabName}`;
    }),
  );

  const navigateBySwipe = useCallback(
    (direction: "next" | "previous") => {
      const nextIndex =
        direction === "next" ? activeTabIndex + 1 : activeTabIndex - 1;

      if (nextIndex < 0 || nextIndex >= TAB_ROUTES.length) {
        return;
      }

      router.push(TAB_ROUTES[nextIndex] as any);
    },
    [activeTabIndex, router],
  );

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-50, 50])
        .failOffsetY([-24, 24])
        .onEnd((event) => {
          const horizontalDistance = event.translationX;

          runOnJS(console.log)("[TabSwipe] Gesture ended:", horizontalDistance);

          if (Math.abs(horizontalDistance) < 80) {
            return;
          }

          runOnJS(navigateBySwipe)(
            horizontalDistance < 0 ? "next" : "previous",
          );
        }),
    [navigateBySwipe],
  );

  return (
    <GestureDetector gesture={swipeGesture}>
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
    </GestureDetector>
  );
}
