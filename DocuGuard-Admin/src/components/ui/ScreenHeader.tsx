import React from "react";
import { Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors } from "../../theme/adminTheme";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
};

export function ScreenHeader({ title, subtitle, onBack, right, style }: Props) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.left}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.iconBtn} accessibilityRole="button">
            <Ionicons name="chevron-back" size={20} color={AdminColors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
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
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  label?: string;
  tone?: "default" | "primary" | "danger";
}) {
  const color = tone === "danger" ? AdminColors.danger : tone === "primary" ? AdminColors.primary : AdminColors.text;
  const bg = tone === "danger" ? AdminColors.dangerSoft : tone === "primary" ? AdminColors.primarySoft : AdminColors.surface;
  const border = tone === "danger" ? "#FECACA" : tone === "primary" ? "#BFDBFE" : AdminColors.border;
  return (
    <Pressable onPress={onPress} style={[styles.iconBtn, { backgroundColor: bg, borderColor: border }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 12,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AdminColors.border,
    backgroundColor: AdminColors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: AdminColors.textSecondary, marginTop: 1 },
});
