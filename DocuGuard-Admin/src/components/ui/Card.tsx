import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { AdminColors, AdminRadii, AdminShadow } from "../../theme/adminTheme";

type Props = {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: ViewStyle;
  noPadding?: boolean;
  delay?: number;
};

export function Card({ title, subtitle, right, children, style, noPadding }: Props) {
  return (
    <View style={[styles.card, noPadding ? { padding: 0 } : null, style]}>
      {(title || subtitle || right) && (
        <View style={[styles.header, noPadding ? { paddingHorizontal: 18, paddingTop: 18 } : null]}>
          <View style={{ flex: 1 }}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
    padding: 18,
    ...AdminShadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: AdminColors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: AdminColors.textSecondary,
    marginTop: 3,
    lineHeight: 18,
  },
});
