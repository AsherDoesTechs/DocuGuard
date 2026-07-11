import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants";

interface SubscriptionViewProps {
  planName: string;
  renewalDate: string;
  storageUsed: number;
  storageTotal: number;
}

export const SubscriptionView = ({
  planName,
  renewalDate,
  storageUsed,
  storageTotal,
}: SubscriptionViewProps) => {
  const router = useRouter();
  const percentage = (storageUsed / storageTotal) * 100;

  const handleAction = (action: string) => {
    router.push({
      pathname: "/subscription-payment",
      params: { action },
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.subHeader}>
        <Text style={styles.subTitle}>Current Plan</Text>
        <View
          style={[styles.badge, { backgroundColor: `${COLORS.primary}15` }]}
        >
          <Text style={[styles.badgeText, { color: COLORS.primary }]}>
            {planName.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={styles.renewalText}>Renews on: {renewalDate}</Text>

      <View style={styles.usageContainer}>
        <View style={styles.usageRow}>
          <Text style={styles.usageLabel}>Storage Used</Text>
          <Text style={styles.usageValue}>
            {storageUsed} GB / {storageTotal} GB
          </Text>
        </View>
        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${percentage}%`, backgroundColor: COLORS.primary },
            ]}
          />
        </View>
      </View>

      <View style={styles.paymentMethod}>
        <Ionicons name="card-outline" size={20} color="#666" />
        <Text style={styles.paymentText}>Visa ending in 4242</Text>
      </View>

      {/* Navigation Actions */}
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => handleAction("renew")}
      >
        <Text style={styles.buttonText}>Renew Subscription</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => handleAction("upgrade")}
      >
        <Text style={styles.secondaryButtonText}>Upgrade Plan</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => handleAction("billing")}
        style={styles.manageButton}
      >
        <Text style={styles.cancelText}>Manage Billing Settings</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 5 },
  subHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  subTitle: { fontSize: 16, fontWeight: "700" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: "800" },
  renewalText: { color: "#666", marginBottom: 20 },
  usageContainer: { marginBottom: 20 },
  usageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  usageLabel: { fontSize: 14, color: "#666" },
  usageValue: { fontSize: 14, fontWeight: "600" },
  progressBarBackground: {
    height: 6,
    backgroundColor: "#E5E7EB",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: { height: "100%", borderRadius: 3 },
  paymentMethod: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 10,
  },
  paymentText: { color: "#4B5563", fontSize: 14 },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryButton: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryButtonText: { color: "#374151", fontWeight: "700", fontSize: 15 },
  manageButton: { padding: 10 },
  cancelText: {
    textAlign: "center",
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "500",
  },
});
