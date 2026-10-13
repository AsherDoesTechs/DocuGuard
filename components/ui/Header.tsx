import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants/spacing";

export default function Header({ title }: { title: string }) {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.headerBackground, borderBottomColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
});
