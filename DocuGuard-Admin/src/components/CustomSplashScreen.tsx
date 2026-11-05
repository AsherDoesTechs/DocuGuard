import React, { useEffect } from "react";
import { StyleSheet, Text, View, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  runOnJS,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

const { width } = Dimensions.get("window");

interface CustomSplashScreenProps {
  onAnimationFinished: () => void;
}

export default function CustomSplashScreen({
  onAnimationFinished,
}: CustomSplashScreenProps) {
  const logoScale = useSharedValue(0.7);
  const logoOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(20);
  const textOpacity = useSharedValue(0);

  useEffect(() => {
    // Trigger animations sequentially for a high-end feel
    logoOpacity.value = withTiming(1, { duration: 600 });
    logoScale.value = withSpring(1, { damping: 12, stiffness: 90 });

    textTranslateY.value = withTiming(0, { duration: 700 });
    textOpacity.value = withSequence(
      withTiming(0, { duration: 200 }),
      withTiming(1, { duration: 600 }, (finished) => {
        if (finished && onAnimationFinished) {
          runOnJS(onAnimationFinished)();
        }
      })
    );
  }, []);

  const logoAnimatedStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  return (
    <LinearGradient
      colors={["#0A192F", "#15366B", "#1F4E9E"]}
      style={styles.container}
    >
      <View style={styles.centerContent}>
        {/* Animated Security Emblem */}
        <Animated.View style={[styles.emblemContainer, logoAnimatedStyle]}>
          <View style={styles.outerGlowRing} />
          <View style={styles.innerShield}>
            <Text style={styles.shieldSymbol}>◆</Text>
          </View>
        </Animated.View>

        {/* Brand Typography */}
        <Animated.View style={[styles.textContainer, textAnimatedStyle]}>
          <Text style={styles.brandTitle}>DocuGuard</Text>
          <View style={styles.badgeRow}>
            <View style={styles.secureDot} />
            <Text style={styles.brandSubtitle}>ADMINISTRATION PORTAL</Text>
          </View>
        </Animated.View>
      </View>

      <View style={styles.footerContainer}>
        <Text style={styles.footerText}>SECURE HARDWARE ENCLAVE</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centerContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  emblemContainer: {
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },
  outerGlowRing: {
    position: "absolute",
    width: 128,
    height: 128,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.25)",
  },
  innerShield: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  shieldSymbol: {
    color: "#15366B",
    fontSize: 28,
    fontWeight: "900",
  },
  textContainer: {
    alignItems: "center",
  },
  brandTitle: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  secureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34D399",
    marginRight: 6,
  },
  brandSubtitle: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.5,
  },
  footerContainer: {
    position: "absolute",
    bottom: 50,
  },
  footerText: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 3,
  },
});