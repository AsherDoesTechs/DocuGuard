import React, { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, Platform.OS === "web" ? 10 : 8) }]}>
      {TABS.map((tab) => {
        const active = pathname === tab.route || (tab.route !== "/dashboard" && pathname.startsWith(tab.route));
        return <TabButton key={tab.key} tab={tab} active={active} onPress={() => router.replace(tab.route as any)} />;
      })}
    </View>
  );
}

function TabButton({ tab, active, onPress }: { tab: (typeof TABS)[number]; active: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(lift, { toValue: active ? 1 : 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  }, [active, lift]);
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
      accessibilityRole="button"
      onPressIn={() => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 4 }).start()}
    >
      <Animated.View style={[styles.iconWrap, active && styles.iconWrapActive, { transform: [{ scale }, { translateY }] }]}>
        <Ionicons name={(active ? tab.activeIcon : tab.icon) as any} size={19} color={active ? AdminColors.primary : AdminColors.textMuted} />
      </Animated.View>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>{tab.label}</Text>
      <Animated.View style={[styles.activeDot, { opacity: lift, transform: [{ scale: lift }] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    backgroundColor: AdminColors.surface,
    borderTopWidth: 1,
    borderTopColor: AdminColors.border,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 2 },
  iconWrap: { width: 36, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: AdminColors.primarySoft },
  label: { fontSize: 10, fontWeight: "600", color: AdminColors.textMuted },
  labelActive: { color: AdminColors.primary, fontWeight: "700" },
  activeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: AdminColors.primary, marginTop: 1 },
});
