import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { useColors } from "@/context/ThemeContext";
import { SHADOWS, BORDER_RADIUS } from "@/constants";

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  shadow?: "sm" | "md" | "lg";
  rounded?: "xs" | "sm" | "md" | "lg" | "xl" | "full";
}

const SHADOW_MAP = { sm: SHADOWS.sm, md: SHADOWS.md, lg: SHADOWS.lg };
const RADIUS_MAP = {
  xs: BORDER_RADIUS.xs,
  sm: BORDER_RADIUS.sm,
  md: BORDER_RADIUS.md,
  lg: BORDER_RADIUS.lg,
  xl: BORDER_RADIUS.xl,
  full: BORDER_RADIUS.full,
};

export default function Card({
  children,
  style,
  shadow = "md",
  rounded = "md",
}: CardProps) {
  const colors = useColors();

  const flattenedStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: colors.surface },
    { borderRadius: RADIUS_MAP[rounded] },
    SHADOW_MAP[shadow],
    style,
  ]);

  return <View style={flattenedStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    overflow: "hidden",
  },
});
