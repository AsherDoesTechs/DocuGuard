import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated as RNAnimated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";

export interface TabItem {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  badge?: number;
  isCenterAction?: boolean; // Highlights this tab as a prominent main button
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabPress: (tabName: string) => void;
  disabled?: boolean;
}

export const TabBar: React.FC<TabBarProps> = React.memo(
  ({ tabs, activeTab, onTabPress, disabled = false }) => {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  if (!tabs || tabs.length === 0) return null;

    const safeActiveTab = tabs.some((t) => t.name === activeTab)
      ? activeTab
      : tabs[0].name;

    const scaleValues = useRef<Record<string, RNAnimated.Value>>({}).current;

    tabs.forEach((tab) => {
      if (!scaleValues[tab.name]) {
        scaleValues[tab.name] = new RNAnimated.Value(1);
      }
    });

    const handlePress = useCallback(
      (tab: TabItem) => {
        if (disabled) return;
        // For action buttons, we might want to allow pressing even if it's the "active" tab
        if (!tab.isCenterAction && tab.name === safeActiveTab) return;

        const currentAnim = scaleValues[tab.name];
        const prevAnim = scaleValues[safeActiveTab];

        if (currentAnim) {
          RNAnimated.sequence([
            RNAnimated.timing(currentAnim, {
              toValue: tab.isCenterAction ? 1.12 : 1.08,
              duration: 150,
              useNativeDriver: true,
            }),
            RNAnimated.spring(currentAnim, {
              toValue: 1,
              friction: 5,
              tension: 100,
              useNativeDriver: true,
            }),
          ]).start();
        }

        if (prevAnim && prevAnim !== currentAnim && !tab.isCenterAction) {
          RNAnimated.timing(prevAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }

        onTabPress(tab.name);
      },
      [disabled, safeActiveTab, scaleValues, onTabPress],
    );

    const bottomPadding = Math.max(insets.bottom, 8);
    const containerHeight = 56 + bottomPadding;

    return (
      <View
        style={[
          styles.container,
        { backgroundColor: colors.tabBarBackground, borderTopColor: colors.tabBarBorder },
        { height: containerHeight, paddingBottom: bottomPadding },
        ]}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const isActive = safeActiveTab === tab.name;
          const tabScale = scaleValues[tab.name] || new RNAnimated.Value(1);

          if (tab.isCenterAction) {
            return (
              <RNAnimated.View
                key={tab.name}
                style={[
                  styles.centerTabWrapper,
                  {
                    transform: [{ scale: tabScale }],
                  },
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.centerButton,
                    { backgroundColor: colors.primary },
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => handlePress(tab)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  accessibilityLabel={tab.label || tab.name}
                  accessibilityHint={`Activate ${tab.label || tab.name}`}
                >
                  <Ionicons name={tab.icon} size={28} color="#FFFFFF" />
                </Pressable>
              </RNAnimated.View>
            );
          }

          return (
            <RNAnimated.View
              key={tab.name}
              style={[
                styles.tab,
                {
                  transform: [{ scale: tabScale }],
                },
              ]}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.tabInner,
                  pressed && styles.tabPressed,
                ]}
                onPress={() => handlePress(tab)}
                disabled={disabled}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive, disabled }}
                accessibilityLabel={tab.label || tab.name}
                accessibilityHint={
                  isActive
                    ? "Currently selected tab"
                    : `Switch to ${tab.label || tab.name} tab`
                }
              >
                <View style={styles.iconContainer}>
                  <Ionicons
                    name={tab.icon}
                    size={isActive ? 24 : 22}
                    color={isActive ? colors.primary : colors.textSecondary}
                  />
                  {typeof tab.badge === "number" && tab.badge > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.error }]}>
                      <Text style={styles.badgeText}>
                        {tab.badge > 99 ? "99+" : tab.badge}
                      </Text>
                    </View>
                  )}
                </View>

                {tab.label ? (
                  <Text
                    style={[
                      styles.label,
                      { color: isActive ? colors.primary : colors.textSecondary },
                      isActive && styles.labelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                ) : null}

                {isActive && <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />}
              </Pressable>
            </RNAnimated.View>
          );
        })}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderTopWidth: 1,
    position: "relative",
    width: "100%",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
    width: "100%",
  },
  tabPressed: {
    opacity: 0.7,
  },
  centerTabWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -16, // Elevates the main action button above the tab bar line
  },
  centerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5, // Android shadow
  },
  iconContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
  },
  labelActive: {
    fontWeight: "700",
  },
  activeDot: {
    position: "absolute",
    top: 0,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    borderRadius: 8,
    paddingHorizontal: 4,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
});
