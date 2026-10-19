import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

interface Props {
  isLoading: boolean;
  onComplete: () => void;
}

const FADE_DURATION = 280;

export default function SplashScreen({ isLoading, onComplete }: Props) {
  const opacity = useSharedValue(1);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.92);
  const progress = useSharedValue(0);

  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Soft entrance animation for the logo.
  useEffect(() => {
    logoOpacity.value = withTiming(1, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });

    logoScale.value = withSpring(1, {
      damping: 18,
      stiffness: 150,
      mass: 0.8,
    });

    return () => {
      cancelAnimation(logoOpacity);
      cancelAnimation(logoScale);
    };
  }, [logoOpacity, logoScale]);

  // A subtle, continuous loading indicator.
  useEffect(() => {
    cancelAnimation(progress);

    if (isLoading) {
      completed.current = false;
      opacity.value = 1;
      progress.value = 0;

      progress.value = withRepeat(
        withTiming(1, {
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        false,
      );
    } else {
      cancelAnimation(progress);
      progress.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.ease),
      });
    }

    return () => {
      cancelAnimation(progress);
    };
  }, [isLoading, opacity, progress]);

  // Fade away when real startup checks are complete.
  useEffect(() => {
    if (isLoading || completed.current) {
      return;
    }

    completed.current = true;

    opacity.value = withTiming(0, {
      duration: FADE_DURATION,
      easing: Easing.out(Easing.cubic),
    });

    const timer = setTimeout(() => {
      onCompleteRef.current();
    }, FADE_DURATION);

    return () => clearTimeout(timer);
  }, [isLoading, opacity]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: -72 + progress.value * 190,
      },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="auto"
      accessibilityViewIsModal
      style={[styles.container, containerStyle]}
    >
      <View style={styles.content}>
        <Animated.View style={[styles.logo, logoStyle]}>
          <MaterialCommunityIcons
            name="shield-check"
            size={38}
            color="#2563EB"
          />
        </Animated.View>

        <Animated.View style={logoStyle}>
          <Text style={styles.appName}>DocuGuard</Text>
        </Animated.View>

        <Animated.View style={logoStyle}>
          <Text style={styles.tagline}>Your documents. Your control.</Text>
        </Animated.View>

        <View style={styles.loadingContainer}>
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel={
              isLoading ? "Preparing DocuGuard" : "DocuGuard ready"
            }
            accessibilityState={{ busy: isLoading }}
          >
            {isLoading ? (
              <Animated.View
                style={[styles.progressIndicator, progressStyle]}
              />
            ) : (
              <View style={styles.progressComplete} />
            )}
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>SECURE DOCUMENT MANAGEMENT</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    elevation: 10000,
  },
  content: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  appName: {
    color: "#172554",
    fontSize: 29,
    fontWeight: "700",
    letterSpacing: -0.9,
    textAlign: "center",
  },
  tagline: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0.1,
    textAlign: "center",
    marginTop: 8,
  },
  loadingContainer: {
    width: 136,
    marginTop: 42,
  },
  progressTrack: {
    height: 3,
    width: "100%",
    borderRadius: 3,
    backgroundColor: "#EAF0F8",
    overflow: "hidden",
  },
  progressIndicator: {
    height: 3,
    width: 54,
    borderRadius: 3,
    backgroundColor: "#2563EB",
  },
  progressComplete: {
    height: 3,
    width: "100%",
    borderRadius: 3,
    backgroundColor: "#2563EB",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  footerText: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.4,
    textAlign: "center",
  },
});
