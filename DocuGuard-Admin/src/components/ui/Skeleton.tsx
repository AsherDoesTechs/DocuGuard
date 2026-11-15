import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { AdminColors, AdminRadii } from "../../theme/adminTheme";

export function Skeleton({ width, height, radius = 8, style }: { width?: number | string; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.95, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.4, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.base, { width: width ?? "100%", height: height ?? 14, borderRadius: radius, opacity }, style]} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
        <Skeleton width="42%" height={14} />
        <Skeleton width={48} height={20} radius={10} />
      </View>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "58%" : "100%"} height={12} style={{ marginBottom: 8 }} />
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
            <Skeleton width={`${72 - (i % 3) * 10}%`} height={13} />
            <Skeleton width={`${48 - (i % 2) * 8}%`} height={11} />
          </View>
          <Skeleton width={64} height={24} radius={8} />
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
      <View style={styles.card}><Skeleton width="30%" height={14} style={{ marginBottom: 10 }} /><Skeleton width="100%" height={90} radius={12} /></View>
      <SkeletonCard lines={4} />
      <SkeletonList count={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: "#DDE3EA" },
  card: { backgroundColor: AdminColors.surface, borderRadius: AdminRadii.lg, borderWidth: 1, borderColor: AdminColors.border, padding: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: AdminColors.surface, borderRadius: AdminRadii.lg, borderWidth: 1, borderColor: AdminColors.border, padding: 14 },
});
