import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Easing,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";

export type AlertType = "default" | "success" | "warning" | "error" | "info";

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

export interface AlertModalProps {
  visible: boolean;
  title: string;
  message?: string;
  type?: AlertType;
  buttons?: AlertButton[];
  onDismiss?: () => void;
}

const TYPE_CONFIG: Record<
  AlertType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  default: { icon: "chatbubble-outline", color: COLORS.primary, bg: `${COLORS.primary}15` },
  success: { icon: "checkmark-circle", color: COLORS.success, bg: `${COLORS.success}15` },
  warning: { icon: "warning", color: COLORS.warning, bg: `${COLORS.warning}15` },
  error: { icon: "alert-circle", color: COLORS.danger, bg: `${COLORS.danger}15` },
  info: { icon: "information-circle", color: COLORS.primary, bg: `${COLORS.primary}15` },
};

const ICON_ANIMATION_CONFIG: Record<AlertType, { scale: number; rotate: string }> = {
  default: { scale: 1, rotate: "0deg" },
  success: { scale: 1.1, rotate: "0deg" },
  warning: { scale: 1, rotate: "0deg" },
  error: { scale: 1, rotate: "0deg" },
  info: { scale: 1, rotate: "0deg" },
};

export const AlertModal = ({
  visible,
  title,
  message,
  type = "default",
  buttons = [{ text: "OK" }],
  onDismiss,
}: AlertModalProps) => {
  const cfg = TYPE_CONFIG[type];
  const iconConfig = ICON_ANIMATION_CONFIG[type];

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const iconScaleAnim = useRef(new Animated.Value(0)).current;
  const iconRotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.back(1.2)),
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(80),
          Animated.timing(iconScaleAnim, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.elastic(1)),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 120,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 120,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 20,
          duration: 120,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(iconScaleAnim, {
          toValue: 0,
          duration: 100,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        onDismiss?.();
      });
    }
  }, [visible, fadeAnim, scaleAnim, slideAnim, iconScaleAnim, onDismiss]);

  const handleButtonPress = async (button: AlertButton) => {
    if (Platform.OS !== "web") {
      try {
        const Haptics = await import("expo-haptics");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
    if (button.onPress) {
      await button.onPress();
    }
  };

  const handleDismiss = () => {
    onDismiss?.();
  };

  const animatedStyle = {
    opacity: fadeAnim,
    transform: [
      { scale: scaleAnim },
      { translateY: slideAnim },
    ],
  };

  const iconAnimatedStyle = {
    transform: [
      { scale: iconScaleAnim },
    ],
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={handleDismiss}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Pressable
          style={styles.overlayPressable}
          onPress={handleDismiss}
        >
          <Animated.View style={[styles.cardContainer, animatedStyle]}>
            <Animated.View style={[styles.iconRing, { backgroundColor: cfg.bg }, iconAnimatedStyle]}>
              <Ionicons name={cfg.icon} size={28} color={cfg.color} />
            </Animated.View>
            <Text style={styles.title}>{title}</Text>
            {message ? (
              <Text style={styles.message}>{message}</Text>
            ) : null}

            <View style={styles.buttonRow}>
              {buttons.map((button, index) => {
                const isLast = index === buttons.length - 1;
                const isDestructive = button.style === "destructive";
                const isCancel = button.style === "cancel";

                return (
                  <TouchableOpacity
                    key={`${button.text}-${index}`}
                    style={[
                      styles.button,
                      isLast && styles.buttonPrimary,
                      isCancel && styles.buttonCancel,
                      isDestructive && styles.buttonDestructive,
                      !isLast && !isCancel && !isDestructive && styles.buttonSecondary,
                    ]}
                    activeOpacity={0.75}
                    onPress={() => handleButtonPress(button)}
                    accessibilityRole="button"
                    accessibilityLabel={button.text}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        isLast && styles.buttonTextPrimary,
                        isCancel && styles.buttonTextCancel,
                        isDestructive && styles.buttonTextDestructive,
                        !isLast && !isCancel && !isDestructive && styles.buttonTextSecondary,
                      ]}
                    >
                      {button.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  overlayPressable: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  cardContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    paddingVertical: 30,
    paddingHorizontal: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 40,
    elevation: 20,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 21,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 26,
    maxWidth: 280,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonSecondary: {
    backgroundColor: "#F1F5F9",
  },
  buttonCancel: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: COLORS.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonDestructive: {
    backgroundColor: `${COLORS.danger}12`,
    borderWidth: 1,
    borderColor: `${COLORS.danger}40`,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
  },
  buttonTextPrimary: {
    color: "#fff",
    fontWeight: "700",
  },
  buttonTextSecondary: {
    color: COLORS.text,
  },
  buttonTextCancel: {
    color: COLORS.textSecondary,
  },
  buttonTextDestructive: {
    color: COLORS.danger,
    fontWeight: "700",
  },
});