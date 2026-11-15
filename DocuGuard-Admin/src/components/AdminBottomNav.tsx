import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
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
        return (
          <Pressable key={tab.key} style={styles.tab} onPress={() => router.replace(tab.route as any)} accessibilityRole="button">
            <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
              <Ionicons name={(active ? tab.activeIcon : tab.icon) as any} size={19} color={active ? AdminColors.primary : AdminColors.textMuted} />
            </View>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 2 },
  iconWrap: { width: 36, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: AdminColors.primarySoft },
  label: { fontSize: 10, fontWeight: "600", color: AdminColors.textMuted },
  labelActive: { color: AdminColors.primary, fontWeight: "700" },
});
