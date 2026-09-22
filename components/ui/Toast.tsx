import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ViewStyle,
  PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeInUp,
  FadeOutUp,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { COLORS } from "@/constants";

export type ToastType = "success" | "error" | "info" | "warning";

const TOAST_CONFIG: Record<
  ToastType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  success: { icon: "checkmark-circle", color: "#FFFFFF", bg: COLORS.success },
  error: { icon: "alert-circle", color: "#FFFFFF", bg: COLORS.danger },
  info: { icon: "information-circle", color: "#FFFFFF", bg: COLORS.primary },
  warning: {
    icon: "warning",
    color: "#FFFFFF",
    bg: COLORS.warning,
  },
};

const DEFAULT_DURATION = 5000;
const DISMISS_THRESHOLD = 100;

export interface ToastProps {
  visible: boolean;
  message: string;
  type?: ToastType;
  duration?: number;
  onDismiss?: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  visible,
  message,
  type = "success",
  duration = DEFAULT_DURATION,
  onDismiss,
}) => {
  const safeMessage = typeof message === "string" && message.trim() ? message : "";
  const safeDuration =
    typeof duration === "number" && duration > 0 ? duration : DEFAULT_DURATION;
  const safeType: ToastType =
    TOAST_CONFIG[type as ToastType] ? (type as ToastType) : "success";

  const insets = useSafeAreaInsets();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);
  const pauseStartRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);
  const dismissProgress = useSharedValue(0);

  const config = TOAST_CONFIG[safeType];

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    dismissProgress.value = 0;
    const remaining = safeDuration - elapsedBeforePauseRef.current;
    if (remaining <= 0) {
      onDismiss?.();
      return;
    }
    timeoutRef.current = setTimeout(() => {
      onDismiss?.();
    }, remaining);
  }, [safeDuration, onDismiss, clearTimer]);

  useEffect(() => {
    if (visible && safeMessage) {
      elapsedBeforePauseRef.current = 0;
      dismissProgress.value = withTiming(1, { duration: safeDuration });
      startTimer();
    } else {
      clearTimer();
    }
    return () => {
      clearTimer();
    };
  }, [visible, safeDuration, onDismiss, startTimer, clearTimer, dismissProgress, safeMessage]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          dismissProgress.value = Math.abs(gestureState.dx) / DISMISS_THRESHOLD;
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -DISMISS_THRESHOLD) {
          clearTimer();
          onDismiss?.();
        } else {
          dismissProgress.value = withTiming(0, { duration: 200 });
        }
      },
    }),
  ).current;

  const handleClose = useCallback(() => {
    clearTimer();
    onDismiss?.();
  }, [onDismiss, clearTimer]);

  const handlePressIn = useCallback(() => {
    setPaused(true);
    pauseStartRef.current = Date.now();
    clearTimer();
  }, [clearTimer]);

  const handlePressOut = useCallback(() => {
    setPaused(false);
    const pausedDuration = Date.now() - pauseStartRef.current;
    elapsedBeforePauseRef.current += pausedDuration;
    startTimer();
  }, [startTimer]);

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    height: 3,
    backgroundColor: config.color,
    opacity: 0.7,
    transform: [{ scaleX: dismissProgress.value }],
  }));

  if (!visible || !safeMessage) return null;

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(20).stiffness(300)}
      exiting={FadeOutUp.duration(250)}
      style={[
        styles.container,
        { top: Platform.OS === "ios" ? insets.top + 12 : insets.top + 8 },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={[styles.toast, { backgroundColor: config.bg }]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
        {...panResponder.panHandlers}
      >
        <View style={styles.toastContent}>
          <Ionicons name={config.icon} size={22} color={config.color} />
          <Text style={styles.text} numberOfLines={3}>
            {safeMessage}
          </Text>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color={config.color} />
          </TouchableOpacity>
        </View>
        <Animated.View
          style={[styles.progressBar, progressAnimatedStyle]}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 20,
    right: 20,
    zIndex: 9999,
    elevation: 6,
  } as ViewStyle,
  toast: {
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
    overflow: "hidden",
  } as ViewStyle,
  toastContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  text: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  closeButton: {
    padding: 6,
  },
  progressBar: {
    width: "100%",
    overflow: "hidden",
  },
});
