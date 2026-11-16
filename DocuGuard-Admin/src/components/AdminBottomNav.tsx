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
  const isSidebar = width >= 900;

  if (isSidebar) {
    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.sidebarWrap,
          {
            top: Math.max(insets.top, 16),
            bottom: Math.max(insets.bottom, 16),
            left: Math.max(insets.left, 16),
          },
        ]}
      >
        <View style={styles.sidebar}>
          <View style={styles.brandBlock}>
            <View style={styles.brandDot} />
            <Text style={styles.brandTitle}>DocuGuard</Text>
            <Text style={styles.brandSub}>Admin</Text>
          </View>
          <View style={styles.sidebarTabs}>
            {TABS.map((tab) => {
              const active =
                pathname === tab.route || (tab.route !== "/dashboard" && pathname.startsWith(tab.route));
              return <TabButton key={tab.key} tab={tab} active={active} sidebar onPress={() => router.replace(tab.route as any)} />;
            })}
          </View>
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
  sidebar,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onPress: () => void;
  sidebar?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      style={[sidebar ? styles.tabSidebar : styles.tab, active && sidebar && styles.tabSidebarActive]}
      onPress={onPress}
      accessibilityRole="button"
      onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 4 }).start()}
    >
      <Animated.View style={{ transform: [{ scale }], flexDirection: sidebar ? "row" : "column", alignItems: "center", gap: sidebar ? 10 : 4 }}>
        <View style={[styles.iconWrap, active && !sidebar && styles.iconWrapActive]}>
          <Ionicons
            name={(active ? tab.activeIcon : tab.icon) as any}
            size={sidebar ? 18 : 20}
            color={active ? AdminColors.primary : AdminColors.textMuted}
          />
        </View>
        <Text style={[styles.label, sidebar && styles.labelSidebar, active && styles.labelActive]} numberOfLines={1}>
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
  sidebarWrap: {
    position: "absolute",
    zIndex: 999,
    width: 220,
    ...(Platform.OS === "web" ? ({ position: "fixed", pointerEvents: "none" } as any) : {}),
  },
  sidebar: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 14,
    pointerEvents: "auto",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 12px 40px rgba(15,23,42,0.08)", backdropFilter: "blur(12px)" } as any)
      : { shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 8 }),
  },
  brandBlock: { paddingHorizontal: 10, paddingVertical: 10, marginBottom: 8 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: AdminColors.primary, marginBottom: 10 },
  brandTitle: { fontSize: 16, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.3 },
  brandSub: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2 },
  sidebarTabs: { gap: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 4 },
  tabSidebar: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  tabSidebarActive: { backgroundColor: AdminColors.primarySoft },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: AdminColors.primarySoft },
  label: { fontSize: 10, fontWeight: "600", color: AdminColors.textMuted, textAlign: "center" },
  labelSidebar: { fontSize: 13, fontWeight: "600", textAlign: "left", color: AdminColors.textSecondary },
  labelActive: { color: AdminColors.primary, fontWeight: "700" },
});
