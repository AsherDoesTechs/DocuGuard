import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated as RNAnimated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";

interface TabItem {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabPress: (tabName: string) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const TAB_COUNT = 5;
const TAB_WIDTH = SCREEN_WIDTH / TAB_COUNT;

export const TabBar: React.FC<TabBarProps> = React.memo(
  ({ tabs, activeTab, onTabPress }) => {
    if (!tabs || tabs.length === 0) return null;

    const safeActiveTab = tabs.find((t) => t.name === activeTab)
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
        if (tab.name === activeTab) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        RNAnimated.sequence([
          RNAnimated.timing(scaleValues[tab.name], {
            toValue: 1.15,
            duration: 150,
            useNativeDriver: true,
          }),
          RNAnimated.spring(scaleValues[tab.name], {
            toValue: 1,
            friction: 5,
            tension: 100,
            useNativeDriver: true,
          }),
        ]).start();

        if (scaleValues[activeTab]) {
          RNAnimated.timing(scaleValues[activeTab], {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }

        onTabPress(tab.name);
      },
      [tabs, activeTab, scaleValues, onTabPress],
    );

    return (
      <View style={styles.container}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.name;
          const tabScale = scaleValues[tab.name] || new RNAnimated.Value(1);

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
              <TouchableOpacity
                style={styles.tabInner}
                onPress={() => handlePress(tab)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.label || tab.name}
              >
                <Ionicons
                  name={tab.icon}
                  size={isActive ? 26 : 22}
                  color={isActive ? COLORS.primary : COLORS.textSecondary}
                />
                {tab.label ? (
                  <Text
                    style={[styles.label, isActive && styles.labelActive]}
                  >
                    {tab.label}
                  </Text>
                ) : null}
                {isActive && <View style={styles.activeDot} />}
              </TouchableOpacity>
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
    height: 65,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: 10,
    position: "relative",
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
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  labelActive: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  activeDot: {
    position: "absolute",
    top: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
});
