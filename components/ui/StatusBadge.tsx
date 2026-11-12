import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Spacing from "@/constants/spacing";
import { useColors } from "@/context/ThemeContext";

interface StatusBadgeProps {
  status: string;
  text?: string;
}

const SUCCESS = new Set(["approved", "verified", "active", "success", "stable", "low", "valid"]);
const ERROR = new Set(["rejected", "expired", "danger", "critical", "high", "failed", "error"]);
const LABEL_MAP: Record<string, string> = {
  approved: "Approved",
  verified: "Verified",
  active: "Active",
  success: "Verified",
  stable: "Stable",
  low: "Low",
  valid: "Valid",
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
  error: "Error",
};

export default function StatusBadge({ status, text }: StatusBadgeProps) {
  const colors = useColors();
  if (!status) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.warningLight }]}>
        <Text style={[styles.text, { color: colors.warning }]}>Unknown</Text>
      </View>
    );
  }
  const normalized = status.toLowerCase().trim();
  const kind = SUCCESS.has(normalized) ? "success" : ERROR.has(normalized) ? "error" : "warning";
  const config =
    kind === "success"
      ? { bg: colors.successLight, fg: colors.success }
      : kind === "error"
        ? { bg: colors.errorLight, fg: colors.error }
        : { bg: colors.warningLight, fg: colors.warning };
  const label = text || LABEL_MAP[normalized] || status;

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: config.fg }]} />
        <Text style={[styles.text, { color: config.fg }]}>{label}</Text>
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
