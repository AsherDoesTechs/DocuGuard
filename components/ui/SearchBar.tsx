import { View, TextInput, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants/spacing";

export default function SearchBar({ placeholder }: { placeholder?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.searchBackground, borderColor: colors.border }]}>
      <Ionicons name="search" size={20} color={colors.textMuted} />
      <TextInput
        style={[styles.input, { color: colors.text }]}
        placeholder={placeholder || "Search documents"}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder || "Search documents"}
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
  input: {
    flex: 1,
    fontSize: 16,
  },
});
