import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>; // Updates type handling for arrays
}

export default function Card({ children, style }: CardProps) {
  // Use StyleSheet.flatten to cleanly merge arrays or single objects safely
  const flattenedStyle = StyleSheet.flatten([styles.card, style]);

  return <View style={flattenedStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff", // Adjust to your theme variables if needed
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
});
