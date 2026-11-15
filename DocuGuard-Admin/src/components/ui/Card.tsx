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
};

export function Card({ title, subtitle, right, children, style, noPadding }: Props) {
  return (
    <View style={[styles.card, noPadding ? { padding: 0 } : null, style]}>
      {(title || subtitle || right) && (
        <View style={[styles.header, noPadding ? { paddingHorizontal: 16, paddingTop: 16 } : null]}>
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
    borderColor: AdminColors.border,
    padding: 16,
    ...AdminShadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: AdminColors.text,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    color: AdminColors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
});
