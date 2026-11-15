import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { AdminColors, AdminRadii } from "../../theme/adminTheme";

export function Skeleton({ width, height, radius = 8, style }: { width?: number | string; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.base, { width: width ?? "100%", height: height ?? 14, borderRadius: radius }, style]} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.card}>
      <Skeleton width="45%" height={14} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={12} style={{ marginBottom: 8 }} />
      ))}
    </View>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={42} height={42} radius={12} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="70%" height={13} />
            <Skeleton width="45%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function SkeletonScreen() {
  return (
    <View style={{ paddingHorizontal: 20, gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}><SkeletonCard lines={2} /></View>
        <View style={{ flex: 1 }}><SkeletonCard lines={2} /></View>
      </View>
      <SkeletonCard lines={4} />
      <SkeletonList count={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: AdminColors.surfaceAlt },
  card: {
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 14,
  },
});
