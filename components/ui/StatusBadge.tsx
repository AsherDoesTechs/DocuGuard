import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants";
import Spacing from "@/constants/spacing";
import { useColors } from "@/context/ThemeContext";

interface StatusBadgeProps {
  status: string;
  text?: string;
}

interface BadgeConfig {
  bg: string;
  text: string;
  dot?: string;
}

const STATUS_CONFIG: Record<string, BadgeConfig> = {
  approved: { bg: "#DCFCE7", text: COLORS.success, dot: COLORS.success },
  verified: { bg: "#DCFCE7", text: COLORS.success, dot: COLORS.success },
  active: { bg: "#DCFCE7", text: COLORS.success, dot: COLORS.success },
  success: { bg: "#DCFCE7", text: COLORS.success, dot: COLORS.success },
  stable: { bg: "#DCFCE7", text: COLORS.success, dot: COLORS.success },
  low: { bg: "#DCFCE7", text: COLORS.success, dot: COLORS.success },
  pending: { bg: "#FEF3C7", text: COLORS.warning, dot: COLORS.warning },
  processing: { bg: "#FEF3C7", text: COLORS.warning, dot: COLORS.warning },
  warning: { bg: "#FEF3C7", text: COLORS.warning, dot: COLORS.warning },
  medium: { bg: "#FEF3C7", text: COLORS.warning, dot: COLORS.warning },
  rejected: { bg: "#FEE2E2", text: COLORS.danger, dot: COLORS.danger },
  expired: { bg: "#FEE2E2", text: COLORS.danger, dot: COLORS.danger },
  danger: { bg: "#FEE2E2", text: COLORS.danger, dot: COLORS.danger },
  critical: { bg: "#FEE2E2", text: COLORS.danger, dot: COLORS.danger },
  high: { bg: "#FEE2E2", text: COLORS.danger, dot: COLORS.danger },
  failed: { bg: "#FEE2E2", text: COLORS.danger, dot: COLORS.danger },
};

const LABEL_MAP: Record<string, string> = {
  approved: "Approved",
  verified: "Verified",
  active: "Active",
  success: "Verified",
  stable: "Stable",
  low: "Low",
  pending: "Pending",
  processing: "Processing",
  warning: "Warning",
  medium: "Medium",
  rejected: "Rejected",
  expired: "Expired",
  danger: "Critical",
  critical: "Critical",
  high: "High",
  failed: "Failed",
};
export default function StatusBadge({ status, text }: StatusBadgeProps) {
  const colors = useColors();
  const statusColors = {
    success: { bg: colors.successLight, text: colors.success, dot: colors.success },
    warning: { bg: colors.warningLight, text: colors.warning, dot: colors.warning },
    error: { bg: colors.errorLight, text: colors.error, dot: colors.error },
  };
  if (!status) {
    return (
      <View style={[styles.badge, { backgroundColor: statusColors.warning.bg }]}>
        <Text style={[styles.text, { color: statusColors.warning.text }]}>Unknown</Text>
      </View>
    );
  }
  const normalized = status.toLowerCase().trim();
  const baseConfig = STATUS_CONFIG[normalized] || {
    bg: colors.warningLight,
    text: colors.warning,
    dot: colors.warning,
  };
  const config = baseConfig.text === COLORS.success
    ? { ...baseConfig, ...statusColors.success }
    : baseConfig.text === COLORS.danger
      ? { ...baseConfig, ...statusColors.error }
      : { ...baseConfig, ...statusColors.warning };
  const label = text || LABEL_MAP[normalized] || status;

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: config.dot }]} />
        <Text style={[styles.text, { color: config.text }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});
