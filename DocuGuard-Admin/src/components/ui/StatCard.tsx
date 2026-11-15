import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
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

export function StatCard({ label, value, icon, color = AdminColors.primary, bg = AdminColors.primarySoft, hint, delay = 0 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 340, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 340, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [delay, opacity, y]);
  return (
    <Animated.View style={[styles.card, { opacity, transform: [{ translateY: y }] }]}>
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      {hint ? <Text style={styles.hint} numberOfLines={1}>{hint}</Text> : null}
    </Animated.View>
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
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontSize: 22,
    fontWeight: "800",
    color: AdminColors.text,
    letterSpacing: -0.4,
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
