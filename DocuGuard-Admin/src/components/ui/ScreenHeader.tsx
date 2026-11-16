import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors } from "../../theme/adminTheme";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
  topSlot?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, onBack, right, style, topSlot }: Props) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.left}>
        {onBack ? <IconButton icon="chevron-back" onPress={onBack} label="Back" /> : null}
        <View style={{ flex: 1 }}>
          {topSlot}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  tone = "default",
  spinning = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  label?: string;
  tone?: "default" | "primary" | "danger";
  spinning?: boolean;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    spin.stopAnimation();
    if (spinning) {
      spin.setValue(0);
      const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
      return () => loop.stop();
    }
    spin.setValue(0);
  }, [spinning, spin]);

  const color = tone === "danger" ? AdminColors.danger : tone === "primary" ? AdminColors.primary : AdminColors.textSecondary;
  const bg = tone === "danger" ? AdminColors.dangerSoft : tone === "primary" ? AdminColors.primarySoft : AdminColors.surface;
  const border = tone === "danger" ? "#FECACA" : tone === "primary" ? "#BFDBFE" : AdminColors.border;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || spinning}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 4 }).start()}
    >
      <Animated.View style={[styles.iconBtn, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.6 : 1, transform: [{ scale }] }]}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name={icon} size={18} color={color} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
  },
  left: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 28, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 13, color: AdminColors.textSecondary, marginTop: 4, lineHeight: 18 },
});
