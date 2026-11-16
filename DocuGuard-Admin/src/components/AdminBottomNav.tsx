import React, { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import { AdminColors } from "../theme/adminTheme";

const TABS = [
  { key: "dashboard", label: "Home", icon: "grid-outline", activeIcon: "grid", route: "/dashboard" },
  { key: "users", label: "Users", icon: "people-outline", activeIcon: "people", route: "/users" },
  { key: "documents", label: "Docs", icon: "folder-open-outline", activeIcon: "folder-open", route: "/documents" },
  { key: "logs", label: "Logs", icon: "shield-outline", activeIcon: "shield-checkmark", route: "/logs" },
  { key: "health", label: "Health", icon: "pulse-outline", activeIcon: "pulse", route: "/health" },
] as const;

export function AdminBottomNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isFloating = width >= 768;

  if (isFloating) {
    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.floatWrap,
          {
            top: Math.max(insets.top, 24),
            bottom: Math.max(insets.bottom, 24),
            right: Math.max(insets.right, 16),
          },
        ]}
      >
        <View style={styles.floatPill}>
          {TABS.map((tab) => {
            const active =
              pathname === tab.route || (tab.route !== "/dashboard" && pathname.startsWith(tab.route));
            return <TabButton key={tab.key} tab={tab} active={active} vertical onPress={() => router.replace(tab.route as any)} />;
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, Platform.OS === "web" ? 10 : 8) }]}>
      {TABS.map((tab) => {
        const active =
          pathname === tab.route || (tab.route !== "/dashboard" && pathname.startsWith(tab.route));
        return <TabButton key={tab.key} tab={tab} active={active} onPress={() => router.replace(tab.route as any)} />;
      })}
    </View>
  );
}

function TabButton({
  tab,
  active,
  onPress,
  vertical,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onPress: () => void;
  vertical?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      style={vertical ? styles.tabVertical : styles.tab}
      onPress={onPress}
      accessibilityRole="button"
      onPressIn={() => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 4 }).start()}
    >
      <Animated.View style={{ transform: [{ scale }], alignItems: "center", gap: 4 }}>
        <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
          <Ionicons
            name={(active ? tab.activeIcon : tab.icon) as any}
            size={20}
            color={active ? AdminColors.primary : AdminColors.textMuted}
          />
        </View>
        <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: 1,
    borderTopColor: AdminColors.border,
    paddingTop: 8,
    paddingHorizontal: 8,
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(12px)" } as any) : {}),
  },
  floatWrap: {
    position: "absolute",
    zIndex: 999,
    justifyContent: "center",
    alignItems: "flex-end",
    ...(Platform.OS === "web" ? ({ position: "fixed", pointerEvents: "none" } as any) : {}),
  },
  floatPill: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: AdminColors.border,
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 2,
    pointerEvents: "auto",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 12px 40px rgba(15,23,42,0.12)", backdropFilter: "blur(12px)" } as any)
      : { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 10 }),
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 4 },
  tabVertical: { alignItems: "center", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 8, minWidth: 60 },
  iconWrap: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: AdminColors.primarySoft },
  label: { fontSize: 10, fontWeight: "600", color: AdminColors.textMuted, textAlign: "center" },
  labelActive: { color: AdminColors.primary, fontWeight: "700" },
});
