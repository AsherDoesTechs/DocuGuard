import React from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { AdminColors } from "../theme/adminTheme";

export function PhoneLayout({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1100;

  if (Platform.OS !== "web") {
    return <View style={styles.native}>{children}</View>;
  }

  return (
    <View style={styles.webOuter}>
      <View style={[styles.webFrame, isDesktop && styles.webFrameDesktop]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  native: { flex: 1, backgroundColor: AdminColors.background },
  webOuter: {
    flex: 1,
    minHeight: "100%" as any,
    backgroundColor: "#EEF3FA",
    alignItems: "center",
  },
  webFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 1440,
    minHeight: "100%" as any,
    backgroundColor: AdminColors.background,
  },
  webFrameDesktop: {
    ...(Platform.OS === "web"
      ? ({
          boxShadow: "0 0 0 1px rgba(15,23,42,0.04)",
        } as any)
      : {}),
  },
});
