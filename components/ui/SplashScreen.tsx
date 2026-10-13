import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

interface Props {
  isLoading: boolean;
  onComplete: () => void;
}

const MIN_SPLASH_DURATION = 3000;
const FADE_DURATION = 300;

export default function SplashScreen({ isLoading, onComplete }: Props) {
  const opacity = useSharedValue(1);
  const progress = useSharedValue(0);

  const startTime = useRef(Date.now());
  const completed = useRef(false);

  // Animate the loading indicator only while initialization is running.
  useEffect(() => {
    if (isLoading) {
      progress.value = 0;

      progress.value = withRepeat(
        withTiming(1, {
          duration: 1100,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    } else {
      cancelAnimation(progress);
      progress.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.ease),
      });
    }

    return () => cancelAnimation(progress);
  }, [isLoading, progress]);

  // Wait for initialization and the minimum splash duration.
  useEffect(() => {
    if (isLoading || completed.current) {
      return;
    }

    completed.current = true;

    const elapsed = Date.now() - startTime.current;
    const remaining = Math.max(0, MIN_SPLASH_DURATION - elapsed);

    let finished = false;

    const fadeTimer = setTimeout(() => {
      opacity.value = withTiming(0, {
        duration: FADE_DURATION,
        easing: Easing.out(Easing.ease),
      });
    }, remaining);

    const completeTimer = setTimeout(() => {
      finished = true;
      onComplete();
    }, remaining + FADE_DURATION);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);

      // Allow another attempt if loading restarts before dismissal.
      if (!finished) {
        completed.current = false;
      }
    };
  }, [isLoading, onComplete, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const progressStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: -85 + progress.value * 250,
      },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="auto"
      accessibilityViewIsModal
      style={[styles.container, fadeStyle]}
    >
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <MaterialCommunityIcons
            name="shield-check-outline"
            size={46}
            color="#3984F5"
          />
        </View>

        <Text style={styles.appName}>DocuGuard</Text>

        <View style={styles.accentLine} />

        <Text style={styles.tagline}>Your documents, protected.</Text>

        <View style={styles.loadingSection}>
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel={
              isLoading ? "Preparing DocuGuard" : "Loading complete"
            }
            accessibilityState={{
              busy: isLoading,
            }}
          >
            {isLoading ? (
              <Animated.View
                style={[styles.progressIndicator, progressStyle]}
              />
            ) : (
              <View style={styles.progressComplete} />
            )}
          </View>

          <View style={styles.statusRow}>
            {isLoading ? (
              <MaterialCommunityIcons
                name="shield-sync-outline"
                size={15}
                color="#3984F5"
              />
            ) : (
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={15}
                color="#3984F5"
              />
            )}

            <Text style={styles.statusText}>
              {isLoading
                ? "Preparing your secure workspace..."
                : "Your workspace is ready"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerDot} />
        <Text style={styles.footerText}>PRIVATE. SECURE. ORGANIZED.</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#F8FBFF",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10000,
    elevation: 10000,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    width: "100%",
  },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 26,
    backgroundColor: "#E8F2FF",
    borderWidth: 1,
    borderColor: "#D7E8FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 22,
  },
  appName: {
    fontSize: 29,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: "#17365D",
  },
  accentLine: {
    width: 30,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#3984F5",
    marginTop: 13,
  },
  tagline: {
    fontSize: 14,
    fontWeight: "400",
    color: "#71839B",
    marginTop: 10,
    letterSpacing: 0.15,
  },
  loadingSection: {
    width: "100%",
    maxWidth: 250,
    marginTop: 42,
    alignItems: "center",
  },
  progressTrack: {
    width: "100%",
    height: 4,
    borderRadius: 4,
    backgroundColor: "#E3EDFA",
    overflow: "hidden",
  },
  progressIndicator: {
    width: 85,
    height: 4,
    borderRadius: 4,
    backgroundColor: "#3984F5",
  },
  progressComplete: {
    width: "100%",
    height: 4,
    borderRadius: 4,
    backgroundColor: "#3984F5",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 14,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#71839B",
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#3984F5",
  },
  footerText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.5,
    color: "#8295AD",
  },
});
