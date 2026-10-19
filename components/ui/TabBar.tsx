import React, { useCallback, useEffect, useMemo, useRef } from "react";
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
  isCenterAction?: boolean;
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

    const scaleValues = useRef<Record<string, RNAnimated.Value>>({});
    const animations = useRef<Record<string, RNAnimated.CompositeAnimation>>(
      {},
    );

    // Keep an animated value for each tab without changing hook order.
    tabs.forEach((tab) => {
      if (!scaleValues.current[tab.name]) {
        scaleValues.current[tab.name] = new RNAnimated.Value(1);
      }
    });

    useEffect(() => {
      return () => {
        Object.values(animations.current).forEach((animation) => {
          animation.stop();
        });

        Object.values(scaleValues.current).forEach((value) => {
          value.stopAnimation();
        });
      };
    }, []);

    const safeActiveTab = useMemo(() => {
      if (tabs.some((tab) => tab.name === activeTab)) {
        return activeTab;
      }

      return tabs[0]?.name ?? "";
    }, [tabs, activeTab]);

    const handlePress = useCallback(
      (tab: TabItem) => {
        if (disabled) return;

        if (!tab.isCenterAction && tab.name === safeActiveTab) {
          return;
        }

        const currentAnim = scaleValues.current[tab.name];
        const previousAnim = scaleValues.current[safeActiveTab];

        // Stop any previous animation for this tab before starting another.
        animations.current[tab.name]?.stop();

        if (currentAnim) {
          const animation = RNAnimated.sequence([
            RNAnimated.timing(currentAnim, {
              toValue: tab.isCenterAction ? 1.1 : 1.06,
              duration: 120,
              useNativeDriver: true,
            }),
            RNAnimated.spring(currentAnim, {
              toValue: 1,
              friction: 6,
              tension: 110,
              useNativeDriver: true,
            }),
          ]);

          animations.current[tab.name] = animation;
          animation.start(({ finished }) => {
            if (finished) {
              delete animations.current[tab.name];
            }
          });
        }

        if (
          previousAnim &&
          previousAnim !== currentAnim &&
          !tab.isCenterAction
        ) {
          animations.current[safeActiveTab]?.stop();

          const resetAnimation = RNAnimated.timing(previousAnim, {
            toValue: 1,
            duration: 120,
            useNativeDriver: true,
          });

          animations.current[safeActiveTab] = resetAnimation;
          resetAnimation.start(({ finished }) => {
            if (finished) {
              delete animations.current[safeActiveTab];
            }
          });
        }

        onTabPress(tab.name);
      },
      [disabled, safeActiveTab, onTabPress],
    );

    const bottomPadding = Math.max(insets.bottom, 8);
    const containerHeight = 56 + bottomPadding;

    if (!tabs || tabs.length === 0) {
      return null;
    }

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.tabBarBackground,
            borderTopColor: colors.tabBarBorder,
            height: containerHeight,
            paddingBottom: bottomPadding,
          },
        ]}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const isActive = safeActiveTab === tab.name;
          const tabScale = scaleValues.current[tab.name];

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
                    {
                      backgroundColor: colors.primary,
                      shadowColor: colors.shadow,
                    },
                    pressed && styles.centerButtonPressed,
                  ]}
                  onPress={() => handlePress(tab)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  accessibilityLabel={tab.label || tab.name}
                  accessibilityHint={`Activate ${tab.label || tab.name}`}
                >
                  <Ionicons
                    name={tab.icon}
                    size={28}
                    color={colors.buttonPrimaryText}
                  />
                </Pressable>
              </RNAnimated.View>
            );
          }

          const badgeCount =
            typeof tab.badge === "number" && Number.isFinite(tab.badge)
              ? Math.max(0, Math.floor(tab.badge))
              : 0;

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
                accessibilityState={{
                  selected: isActive,
                  disabled,
                }}
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

                  {badgeCount > 0 && (
                    <View
                      style={[styles.badge, { backgroundColor: colors.error }]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          { color: colors.buttonDangerText },
                        ]}
                      >
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </Text>
                    </View>
                  )}
                </View>

                {tab.label ? (
                  <Text
                    style={[
                      styles.label,
                      {
                        color: isActive ? colors.primary : colors.textSecondary,
                      },
                      isActive && styles.labelActive,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {tab.label}
                  </Text>
                ) : null}

                {isActive && (
                  <View
                    style={[
                      styles.activeDot,
                      { backgroundColor: colors.primary },
                    ]}
                  />
                )}
              </Pressable>
            </RNAnimated.View>
          );
        })}
      </View>
    );
  },
);

TabBar.displayName = "TabBar";

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    position: "relative",
    width: "100%",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
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
    marginTop: -16,
  },
  centerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  centerButtonPressed: {
    opacity: 0.85,
  },
  iconContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
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
    fontSize: 9,
    fontWeight: "700",
  },
});
