import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from "react-native";
import { AdminColors, AdminRadii, AdminShadow } from "../../theme/adminTheme";

type Props = {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: ViewStyle;
  noPadding?: boolean;
  delay?: number;
};

export function Card({ title, subtitle, right, children, style, noPadding, delay = 0 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(6)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [delay, opacity, y]);
  return (
    <Animated.View style={[styles.card, noPadding ? { padding: 0 } : null, style, { opacity, transform: [{ translateY: y }] }]}>
      {(title || subtitle || right) && (
        <View style={[styles.header, noPadding ? { paddingHorizontal: 16, paddingTop: 16 } : null]}>
          <View style={{ flex: 1 }}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      )}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 16,
    ...AdminShadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: AdminColors.text,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    color: AdminColors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
});
