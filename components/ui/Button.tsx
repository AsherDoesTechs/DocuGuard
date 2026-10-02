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
  feedbackType?: "success" | "error" | "warning" | "info" | "light" | "medium" | "heavy" | "selection";
  disabled?: boolean;
}

export default function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  style,
  feedbackType = "selection",
  disabled = false,
}: ButtonProps) {
  const colors = useColors();
  const { custom: triggerFeedback } = useFeedbackTrigger();
  const isSecondary = variant === "secondary";
  const isDanger = variant === "danger";
  const isSuccess = variant === "success";
  const isWarning = variant === "warning";

  const handlePress = () => {
    if (!loading && !disabled && onPress) {
      triggerFeedback(feedbackType, { sound: false, haptic: true });
      onPress();
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        button: {
          backgroundColor: colors.primary,
          paddingVertical: Spacing.md,
          paddingHorizontal: Spacing.lg,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          marginVertical: Spacing.sm,
        },
        secondaryButton: {
          backgroundColor: "transparent",
          borderWidth: 1,
          borderColor: colors.border,
        },
        dangerButton: {
          backgroundColor: colors.error,
        },
        successButton: {
          backgroundColor: colors.success,
        },
        warningButton: {
          backgroundColor: colors.warning,
        },
        text: {
          color: "#fff",
          fontSize: 16,
          fontWeight: "600",
        },
        secondaryText: {
          color: colors.text,
        },
        disabledButton: {
          opacity: 0.5,
        },
      }),
    [colors],
  );

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isSecondary && styles.secondaryButton,
        isDanger && styles.dangerButton,
        isSuccess && styles.successButton,
        isWarning && styles.warningButton,
        (loading || disabled) && styles.disabledButton,
        style,
      ]}
      onPress={handlePress}
      disabled={loading || disabled}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.primary : "#fff"} />
      ) : (
        <Text style={[styles.text, isSecondary && styles.secondaryText]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}