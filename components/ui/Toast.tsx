import React, { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeInUp,
  FadeOutUp,
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

const DEFAULT_DURATION = 3000;

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
  const insets = useSafeAreaInsets();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = TOAST_CONFIG[type];

  useEffect(() => {
    if (visible) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        onDismiss?.();
      }, duration);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [visible, duration, onDismiss]);

  const handleClose = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onDismiss?.();
  }, [onDismiss]);

  if (!visible) return null;

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
      <View style={[styles.toast, { backgroundColor: config.bg }]}>
        <Ionicons name={config.icon} size={20} color={config.color} />
        <Text style={styles.text} numberOfLines={3}>
          {message}
        </Text>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={18} color={config.color} />
        </TouchableOpacity>
      </View>
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
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  } as ViewStyle,
  text: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
