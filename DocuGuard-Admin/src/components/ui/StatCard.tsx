import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors, AdminRadii } from "../../theme/adminTheme";

type Props = {
  label: string;
  value: string | number;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
  bg?: string;
  hint?: string;
  delay?: number;
};

export function StatCard({ label, value, icon, color = AdminColors.primary, bg = AdminColors.primarySoft, hint }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 150,
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
    padding: 16,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontSize: 24,
    fontWeight: "800",
    color: AdminColors.text,
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: AdminColors.textSecondary,
    marginTop: 3,
  },
  hint: {
    fontSize: 12,
    color: AdminColors.textMuted,
    marginTop: 6,
  },
});
