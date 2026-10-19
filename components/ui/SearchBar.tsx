import { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants/spacing";

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  onSubmitEditing?: (
    event: NativeSyntheticEvent<TextInputSubmitEditingEventData>,
  ) => void;
  editable?: boolean;
}

export default function SearchBar({
  placeholder,
  value,
  onChangeText,
  onSubmitEditing,
  editable = true,
}: SearchBarProps) {
  const colors = useColors();
  const [isFocused, setIsFocused] = useState(false);

  const accessibilityLabel = placeholder || "Search documents";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.searchBackground,
          borderColor: isFocused ? colors.primary : colors.border,
        },
        isFocused && styles.focusedContainer,
        !editable && styles.disabledContainer,
      ]}
    >
      <Ionicons
        name="search"
        size={20}
        color={isFocused ? colors.primary : colors.textMuted}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />

      <TextInput
        style={[styles.input, { color: colors.text }]}
        placeholder={accessibilityLabel}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="search"
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        editable={editable}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        underlineColorAndroid="transparent"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },

  focusedContainer: {
    borderWidth: 1.5,
  },

  disabledContainer: {
    opacity: 0.6,
  },

  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    paddingVertical: Spacing.sm,
  },
});
