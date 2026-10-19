import React, { useEffect, useRef, useCallback } from "react";
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
  cancelAnimation,
} from "react-native-reanimated";
import { useColors } from "@/context/ThemeContext";

export type ToastType = "success" | "error" | "info" | "warning";

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
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const safeMessage =
    typeof message === "string" && message.trim() ? message : "";

  const safeDuration =
    typeof duration === "number" && duration > 0 ? duration : DEFAULT_DURATION;

  const safeType: ToastType =
    type === "success" ||
    type === "error" ||
    type === "info" ||
    type === "warning"
      ? type
      : "success";

  const config = {
    success: {
      icon: "checkmark-circle" as const,
      color: colors.success,
      background: colors.successLight,
    },
    error: {
      icon: "alert-circle" as const,
      color: colors.error,
      background: colors.errorLight,
    },
    info: {
      icon: "information-circle" as const,
      color: colors.primary,
      background: colors.primaryLight,
    },
    warning: {
      icon: "warning" as const,
      color: colors.warning,
      background: colors.warningLight,
    },
  }[safeType];

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(safeDuration);
  const startedAtRef = useRef(0);
  const dismissRef = useRef(onDismiss);
  const durationRef = useRef(safeDuration);
  const dismissProgress = useSharedValue(0);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    durationRef.current = safeDuration;
  }, [safeDuration]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    cancelAnimation(dismissProgress);
    dismissRef.current?.();
  }, [clearTimer, dismissProgress]);

  const startTimer = useCallback(
    (reset = false) => {
      clearTimer();

      if (reset) {
        remainingRef.current = durationRef.current;
        dismissProgress.value = 0;
      }

      const remaining = Math.max(0, remainingRef.current);

      if (remaining <= 0) {
        dismiss();
        return;
      }

      startedAtRef.current = Date.now();

      dismissProgress.value = withTiming(1, {
        duration: remaining,
      });

      timeoutRef.current = setTimeout(() => {
        remainingRef.current = 0;
        dismiss();
      }, remaining);
    },
    [clearTimer, dismiss, dismissProgress],
  );

  useEffect(() => {
    if (visible && safeMessage) {
      startTimer(true);
    } else {
      clearTimer();
      cancelAnimation(dismissProgress);
      dismissProgress.value = 0;
    }

    return () => {
      clearTimer();
      cancelAnimation(dismissProgress);
    };
  }, [
    visible,
    safeMessage,
    safeDuration,
    startTimer,
    clearTimer,
    dismissProgress,
  ]);

  const pauseTimer = useCallback(() => {
    if (!timeoutRef.current) return;

    const elapsed = Date.now() - startedAtRef.current;

    remainingRef.current = Math.max(0, remainingRef.current - elapsed);

    clearTimer();
    cancelAnimation(dismissProgress);
  }, [clearTimer, dismissProgress]);

  const resumeTimer = useCallback(() => {
    if (visible && safeMessage) {
      startTimer(false);
    }
  }, [visible, safeMessage, startTimer]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        gestureState.dx < -8 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,

      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          dismissProgress.value = Math.min(
            1,
            Math.abs(gestureState.dx) / DISMISS_THRESHOLD,
          );
        }
      },

      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -DISMISS_THRESHOLD) {
          dismiss();
        } else {
          dismissProgress.value = withTiming(0, {
            duration: 180,
          });
        }
      },

      onPanResponderTerminate: () => {
        dismissProgress.value = withTiming(0, {
          duration: 180,
        });
      },
    }),
  ).current;

  const handleClose = useCallback(() => {
    dismiss();
  }, [dismiss]);

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: dismissProgress.value }],
  }));

  const styles = StyleSheet.create({
    container: {
      position: "absolute",
      top: Platform.OS === "ios" ? insets.top + 12 : insets.top + 8,
      left: 20,
      right: 20,
      zIndex: 9999,
      elevation: 6,
    } as ViewStyle,

    toast: {
      backgroundColor: config.background,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 14,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 4,
      overflow: "hidden",
    } as ViewStyle,

    toastContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },

    text: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: "600",
      lineHeight: 20,
    },

    closeButton: {
      padding: 6,
      alignItems: "center",
      justifyContent: "center",
    },

    progressTrack: {
      height: 3,
      width: "100%",
      backgroundColor: colors.borderLight,
      overflow: "hidden",
    },

    progressFill: {
      height: 3,
      width: "100%",
      backgroundColor: config.color,
      opacity: 0.85,
    },
  });

  if (!visible || !safeMessage) return null;

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(20).stiffness(300)}
      exiting={FadeOutUp.duration(250)}
      style={styles.container}
      pointerEvents="box-none"
    >
      <Animated.View style={styles.toast} {...panResponder.panHandlers}>
        <View
          onTouchStart={pauseTimer}
          onTouchEnd={resumeTimer}
          onTouchCancel={resumeTimer}
        >
          <View style={styles.toastContent}>
            <Ionicons name={config.icon} size={22} color={config.color} />

            <Text
              style={styles.text}
              numberOfLines={3}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {safeMessage}
            </Text>

            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Dismiss notification"
              accessibilityRole="button"
              style={styles.closeButton}
            >
              <Ionicons name="close" size={21} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, progressAnimatedStyle]} />
        </View>
      </Animated.View>
    </Animated.View>
  );
};
