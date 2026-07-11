import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Colors from "../../constants/colors";
import Spacing from "../../constants/spacing";

// Supporting lowercase, uppercase, or whatever format your backend/mock data uses
interface StatusBadgeProps {
  status: "approved" | "pending" | "rejected" | string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase();

  // Dynamically set colors based on document status
  let badgeStyle = styles.pendingBadge;
  let textStyle = styles.pendingText;
  let label = "Pending";

  if (normalizedStatus === "approved" || normalizedStatus === "verified") {
    badgeStyle = styles.approvedBadge;
    textStyle = styles.approvedText;
    label = "Approved";
  } else if (
    normalizedStatus === "rejected" ||
    normalizedStatus === "expired"
  ) {
    badgeStyle = styles.rejectedBadge;
    textStyle = styles.rejectedText;
    label = "Rejected";
  }

  return (
    <View style={[styles.badge, badgeStyle]}>
      <Text style={[styles.text, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 999, // Perfect pill shape
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  // Approved State
  approvedBadge: {
    backgroundColor: "#DCFCE7", // Light green subtle background
  },
  approvedText: {
    color: Colors.success,
  },
  // Pending State
  pendingBadge: {
    backgroundColor: "#FEF3C7", // Light amber subtle background
  },
  pendingText: {
    color: Colors.warning,
  },
  // Rejected State
  rejectedBadge: {
    backgroundColor: "#FEE2E2", // Light red subtle background
  },
  rejectedText: {
    color: Colors.error,
  },
});
