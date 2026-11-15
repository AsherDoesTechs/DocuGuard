import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleProp, ViewStyle } from "react-native";

export function FadeInView({ children, delay = 0, duration = 320, translateY = 8, style }: { children: React.ReactNode; delay?: number; duration?: number; translateY?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(translateY)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [delay, duration, opacity, y]);
  return <Animated.View style={[style, { opacity, transform: [{ translateY: y }] }]}>{children}</Animated.View>;
}
