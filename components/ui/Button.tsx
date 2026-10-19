import React, { useMemo } from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
} from "react-native";
import { useColors } from "@/context/ThemeContext";
import { useFeedbackTrigger } from "./FeedbackButton";
import { Spacing } from "@/constants/spacing";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "success" | "warning";
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  feedbackType?:
    | "success"
    | "error"
    | "warning"
    | "info"
    | "light"
    | "medium"
    | "heavy"
    | "selection";
  disabled?: boolean;
}

export default function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  style,
  feedbackType,
  disabled = false,
}: ButtonProps) {
  const colors = useColors();
  const { custom: triggerFeedback } = useFeedbackTrigger();

  const isSecondary = variant === "secondary";
  const isDanger = variant === "danger";
  const isSuccess = variant === "success";
  const isWarning = variant === "warning";
  const isUnavailable = loading || disabled;

  const backgroundColor = isSecondary
    ? colors.buttonSecondary
    : isDanger
      ? colors.buttonDanger
      : isSuccess
        ? colors.success
        : isWarning
          ? colors.warning
          : colors.buttonPrimary;

  const textColor = isSecondary
    ? colors.buttonSecondaryText
    : isDanger
      ? colors.buttonDangerText
      : isSuccess
        ? "#FFFFFF"
        : isWarning
          ? "#FFFFFF"
          : colors.buttonPrimaryText;

  const handlePress = () => {
    if (isUnavailable) return;

    if (feedbackType) {
      triggerFeedback(feedbackType, { sound: false, haptic: true });
    }

    onPress();
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        button: {
          backgroundColor,
          paddingVertical: Spacing.md,
          paddingHorizontal: Spacing.lg,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          marginVertical: Spacing.sm,
          minHeight: 48,
          borderWidth: isSecondary ? 1 : 0,
          borderColor: isSecondary ? colors.border : "transparent",
        },
        text: {
          color: textColor,
          fontSize: 16,
          fontWeight: "600",
          textAlign: "center",
        },
        disabledButton: {
          opacity: 0.5,
        },
      }),
    [backgroundColor, colors.border, isSecondary, textColor],
  );

  return (
    <TouchableOpacity
      style={[styles.button, isUnavailable && styles.disabledButton, style]}
      onPress={handlePress}
      disabled={isUnavailable}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{
        disabled: isUnavailable,
        busy: loading,
      }}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={styles.text}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}
