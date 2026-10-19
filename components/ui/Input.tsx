import React, { useMemo, useState } from "react";
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  KeyboardTypeOptions,
  StyleProp,
  TextStyle,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants/spacing";

interface InputProps {
  label?: string | React.ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  secureTextEntry?: boolean;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  style?: StyleProp<TextStyle>;
  autoComplete?: string;
  textContentType?: string;
  maxLength?: number;
  autoFocus?: boolean;
  editable?: boolean;

  // Optional trailing icon
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
}

export default function Input({
  label,
  placeholder,
  value,
  onChangeText,
  onBlur,
  secureTextEntry,
  error,
  keyboardType,
  style,
  autoComplete,
  textContentType,
  maxLength,
  autoFocus,
  editable = true,
  rightIcon,
  onRightIconPress,
}: InputProps) {
  const colors = useColors();
  const [isFocused, setIsFocused] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: "100%",
          marginVertical: Spacing.xs,
        },
        label: {
          fontSize: 14,
          fontWeight: "500",
          marginBottom: Spacing.xs,
        },
        labelContainer: {
          marginBottom: Spacing.xs,
        },
        inputWrapper: {
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderRadius: 12,
          backgroundColor: colors.inputBackground,
          borderColor: error
            ? colors.error
            : isFocused
              ? colors.primary
              : colors.inputBorder,
          minHeight: 52,
          opacity: editable ? 1 : 0.65,
        },
        input: {
          flex: 1,
          minWidth: 0,
          padding: Spacing.md,
          fontSize: 16,
          color: colors.text,
        },
        inputError: {
          borderWidth: 1.5,
        },
        iconButton: {
          minWidth: 48,
          minHeight: 48,
          alignItems: "center",
          justifyContent: "center",
        },
        errorText: {
          fontSize: 12,
          marginTop: 4,
          fontWeight: "500",
          color: colors.error,
        },
      }),
    [colors, error, isFocused, editable],
  );

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  return (
    <View style={styles.container}>
      {label &&
        (typeof label === "string" ? (
          <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        ) : (
          <View style={styles.labelContainer}>{label}</View>
        ))}

      <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
        <TextInput
          style={[styles.input, style]}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoComplete={autoComplete as any}
          textContentType={textContentType as any}
          maxLength={maxLength}
          autoFocus={autoFocus}
          editable={editable}
          accessibilityLabel={typeof label === "string" ? label : placeholder}
          accessibilityHint={error ? `Error: ${error}` : undefined}
        />

        {rightIcon && onRightIconPress && (
          <Pressable
            style={styles.iconButton}
            onPress={onRightIconPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              secureTextEntry ? "Show password" : "Hide password"
            }
            accessibilityHint="Toggles password visibility"
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
          >
            <Ionicons name={rightIcon} size={21} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {error ? (
        <Text
          style={styles.errorText}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
