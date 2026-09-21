import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";

interface Props {
  text?: string;
}

export default function Loading({ text }: Props) {
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);

  React.useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    scale.value = withRepeat(
      withTiming(1.15, { duration: 500, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, []);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.spinner, spinStyle, scaleStyle]}>
        <View style={styles.spinnerCircle} />
      </Animated.View>
      <Text style={styles.label}>{text || "Please wait..."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center", gap: 16 },
  spinner: { alignItems: "center", justifyContent: "center" },
  spinnerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: "#E5E7EB",
    borderTopColor: "#2563EB",
  },
  label: { fontSize: 14, color: "#6b7280", fontWeight: "500" },
});
