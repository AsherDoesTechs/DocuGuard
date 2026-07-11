import React from "react";
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  KeyboardTypeOptions,
  StyleProp,
  TextStyle,
} from "react-native";
import Colors from "../../constants/colors";
import Spacing from "../../constants/spacing";

interface InputProps {
  // Changed label type from string to string | React.ReactNode
  label?: string | React.ReactNode;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  secureTextEntry?: boolean;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  style?: StyleProp<TextStyle>;
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
}: InputProps) {
  return (
    <View style={styles.container}>
      {/* If label is a string, it will be rendered as a Text child automatically.
        If it's a JSX Element (e.g. <Text><Icon /> Text</Text>), it renders as is.
      */}
      {label &&
        (typeof label === "string" ? (
          <Text style={styles.label}>{label}</Text>
        ) : (
          <View style={styles.labelContainer}>{label}</View>
        ))}
      <TextInput
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginVertical: Spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1f2937",
    marginBottom: Spacing.xs,
  },
  labelContainer: {
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 16,
    color: "#1f2937",
  },
  inputError: {
    borderColor: Colors.error,
  },
  errorText: {
    color: Colors.error,
    fontSize: 12,
    marginTop: 4,
    fontWeight: "500",
  },
});
