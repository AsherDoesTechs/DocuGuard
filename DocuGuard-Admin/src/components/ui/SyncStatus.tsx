import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors } from "../../theme/adminTheme";

export function SyncPulse({ active, syncing }: { active: boolean; syncing?: boolean }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulse.stopAnimation();
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.35, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0.35);
  }, [active, pulse]);

  useEffect(() => {
    spin.stopAnimation();
    if (syncing) {
      spin.setValue(0);
      const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
      return () => loop.stop();
    }
    spin.setValue(0);
  }, [syncing, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, { opacity: active ? pulse : 0.35, backgroundColor: active ? AdminColors.success : AdminColors.textMuted }]} />
      {syncing ? (
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="sync-outline" size={13} color={AdminColors.primary} />
        </Animated.View>
      ) : null}
    </View>
  );
}

export function SyncBanner({ text, syncing }: { text: string; syncing?: boolean }) {
  const fade = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    if (!syncing) {
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fade, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0.6, duration: 550, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [syncing, fade]);
  return (
    <Animated.View style={[styles.banner, { opacity: fade }]}>
      <SyncPulse active syncing={syncing} />
      <Text style={styles.bannerText} numberOfLines={1}>{text}</Text>
    </Animated.View>
  );
}

export function SyncLine({ syncing }: { syncing: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    if (syncing) {
      opacity.setValue(1);
      progress.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: false }),
        ])
      );
      animRef.current = loop;
      loop.start();
    } else {
      Animated.parallel([
        Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 0, duration: 360, delay: 120, useNativeDriver: false }),
      ]).start();
    }
    return () => { animRef.current?.stop(); };
  }, [syncing, progress, opacity]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ["8%", "100%"] });
  return (
    <Animated.View pointerEvents="none" style={[styles.lineTrack, { opacity }]}>
      <Animated.View style={[styles.lineFill, { width }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: AdminColors.primarySoft, borderWidth: 1, borderColor: "#BFDBFE" },
  bannerText: { fontSize: 12, fontWeight: "600", color: AdminColors.primaryDark },
  lineTrack: { height: 3, width: "100%", backgroundColor: "rgba(37,99,235,0.12)", overflow: "hidden" },
  lineFill: { height: "100%", backgroundColor: AdminColors.primary, borderRadius: 2 },
});
