import React, { useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";

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

const ICON_ANIMATION_CONFIG: Record<
  AlertType,
  { scale: number; rotate: string }
> = {
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
  const colors = useColors();

  const typeConfig = useMemo(() => {
    const config = {
      default: {
        icon: "chatbubble-outline" as const,
        color: colors.primary,
        bg: colors.primaryLight,
      },
      success: {
        icon: "checkmark-circle" as const,
        color: colors.success,
        bg: colors.successLight,
      },
      warning: {
        icon: "warning" as const,
        color: colors.warning,
        bg: colors.warningLight,
      },
      error: {
        icon: "alert-circle" as const,
        color: colors.error,
        bg: colors.errorLight,
      },
      info: {
        icon: "information-circle" as const,
        color: colors.primary,
        bg: colors.primaryLight,
      },
    };

    return config[type];
  }, [colors, type]);

  const iconConfig = ICON_ANIMATION_CONFIG[type];

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const iconScaleAnim = useRef(new Animated.Value(0)).current;

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
            toValue: iconConfig.scale,
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
      ]).start();
    }
  }, [
    visible,
    fadeAnim,
    scaleAnim,
    slideAnim,
    iconScaleAnim,
    iconConfig.scale,
  ]);

  const handleButtonPress = async (button: AlertButton) => {
    onDismiss?.();
    await button.onPress?.();
  };

  const handleDismiss = () => {
    onDismiss?.();
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: colors.modalOverlay,
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
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 24,
          paddingVertical: 30,
          paddingHorizontal: 24,
          width: "100%",
          maxWidth: 340,
          alignItems: "center",
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          elevation: 12,
        },
        iconRing: {
          width: 72,
          height: 72,
          borderRadius: 36,
          justifyContent: "center",
          alignItems: "center",
          marginBottom: 20,
        },
        title: {
          fontSize: 21,
          fontWeight: "700",
          color: colors.text,
          textAlign: "center",
          marginBottom: 10,
          letterSpacing: -0.3,
        },
        message: {
          fontSize: 15,
          color: colors.textSecondary,
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
          minHeight: 48,
          paddingHorizontal: 8,
          borderRadius: 14,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.buttonSecondary,
        },
        buttonPrimary: {
          backgroundColor: colors.buttonPrimary,
        },
        buttonCancel: {
          backgroundColor: "transparent",
          borderWidth: 1,
          borderColor: colors.border,
        },
        buttonDestructive: {
          backgroundColor: colors.errorLight,
          borderWidth: 1,
          borderColor: colors.error,
        },
        buttonText: {
          fontSize: 15,
          fontWeight: "600",
          color: colors.buttonSecondaryText,
          textAlign: "center",
        },
        buttonTextPrimary: {
          color: colors.buttonPrimaryText,
          fontWeight: "700",
        },
        buttonTextCancel: {
          color: colors.textSecondary,
        },
        buttonTextDestructive: {
          color: colors.error,
          fontWeight: "700",
        },
      }),
    [colors],
  );

  const animatedStyle = {
    opacity: fadeAnim,
    transform: [{ scale: scaleAnim }, { translateY: slideAnim }],
  };

  const iconAnimatedStyle = {
    transform: [{ scale: iconScaleAnim }],
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Pressable
          style={styles.overlayPressable}
          onPress={handleDismiss}
          accessible={false}
        >
          <Animated.View
            style={[styles.cardContainer, animatedStyle]}
            onStartShouldSetResponder={() => true}
          >
            <Animated.View
              style={[
                styles.iconRing,
                { backgroundColor: typeConfig.bg },
                iconAnimatedStyle,
              ]}
            >
              <Ionicons
                name={typeConfig.icon}
                size={28}
                color={typeConfig.color}
              />
            </Animated.View>

            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>

            {message ? <Text style={styles.message}>{message}</Text> : null}

            <View style={styles.buttonRow}>
              {buttons.map((button, index) => {
                const isLast = index === buttons.length - 1;
                const isDestructive = button.style === "destructive";
                const isCancel = button.style === "cancel";
                const isPrimary = isLast && !isCancel && !isDestructive;

                return (
                  <TouchableOpacity
                    key={`${button.text}-${index}`}
                    style={[
                      styles.button,
                      isPrimary && styles.buttonPrimary,
                      isCancel && styles.buttonCancel,
                      isDestructive && styles.buttonDestructive,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleButtonPress(button)}
                    accessibilityRole="button"
                    accessibilityLabel={button.text}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        isPrimary && styles.buttonTextPrimary,
                        isCancel && styles.buttonTextCancel,
                        isDestructive && styles.buttonTextDestructive,
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
