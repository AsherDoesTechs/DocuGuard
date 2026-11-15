import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { AdminColors } from "../theme/adminTheme";

export function PhoneLayout({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") {
    return <View style={styles.native}>{children}</View>;
  }
  return (
    <View style={styles.webOuter}>
      <View style={styles.webPhone}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  native: { flex: 1, backgroundColor: AdminColors.background },
  webOuter: {
    flex: 1,
    minHeight: "100%" as any,
    backgroundColor: "#E9EEF7",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  webPhone: {
    flex: 1,
    width: "100%",
    maxWidth: 430,
    minHeight: "100%" as any,
    backgroundColor: AdminColors.background,
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 0 0 1px rgba(16,24,40,0.06), 0 16px 48px rgba(16,24,40,0.10)" } as any)
      : {}),
  },
});
