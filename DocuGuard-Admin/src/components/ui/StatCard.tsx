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
};

export function StatCard({ label, value, icon, color = AdminColors.primary, bg = AdminColors.primarySoft, hint }: Props) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      {hint ? <Text style={styles.hint} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 14,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  value: {
    fontSize: 22,
    fontWeight: "800",
    color: AdminColors.text,
    letterSpacing: -0.3,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: AdminColors.textSecondary,
    marginTop: 2,
  },
  hint: {
    fontSize: 11,
    color: AdminColors.textMuted,
    marginTop: 4,
  },
});
