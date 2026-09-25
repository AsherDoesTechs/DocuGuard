import React, { useMemo } from "react";
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  KeyboardTypeOptions,
  StyleProp,
  TextStyle,
} from "react-native";
import { useColors } from "@/context/ThemeContext";
import { useFeedbackTrigger } from "./FeedbackButton";
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
}: InputProps) {
  const colors = useColors();
  const { light } = useFeedbackTrigger();

  const handleFocus = () => {
    light();
  };

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
        input: {
          borderWidth: 1,
          borderRadius: 12,
          padding: Spacing.md,
          fontSize: 16,
        },
        inputError: {
          borderWidth: 2,
        },
        errorText: {
          fontSize: 12,
          marginTop: 4,
          fontWeight: "500",
        },
      }),
    [],
  );

  return (
    <View style={styles.container}>
      {label &&
        (typeof label === "string" ? (
          <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        ) : (
          <View style={styles.labelContainer}>{label}</View>
        ))}
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text },
          error ? styles.inputError : null,
          style,
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        onFocus={handleFocus}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoComplete={autoComplete as any}
        textContentType={textContentType as any}
      />
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
    </View>
  );
}