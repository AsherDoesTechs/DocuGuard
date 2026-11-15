import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { AdminColors, AdminRadii } from "../../theme/adminTheme";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, { bg: string; text: string }> = {
  neutral: { bg: AdminColors.surfaceAlt, text: AdminColors.textSecondary },
  primary: { bg: AdminColors.primarySoft, text: AdminColors.primaryDark },
  success: { bg: AdminColors.successSoft, text: AdminColors.successText },
  warning: { bg: AdminColors.warningSoft, text: AdminColors.warningText },
  danger: { bg: AdminColors.dangerSoft, text: AdminColors.dangerText },
  info: { bg: AdminColors.infoSoft, text: "#0369A1" },
};

export function Badge({ label, tone = "neutral", style }: { label: string; tone?: Tone; style?: ViewStyle }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.text, { color: t.text }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: AdminRadii.pill,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
