import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/context/ThemeContext";

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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const percentage = storageTotal > 0 ? (storageUsed / storageTotal) * 100 : 0;

  const handleAction = (action: string) => {
    router.push({
      pathname: "/subscription-payment",
      params: { action },
    } as any);
  };

  return (
    <View style={styles.container}>
      <View style={styles.subHeader}>
        <Text style={styles.subTitle}>Current Plan</Text>
        <View
          style={[styles.badge, { backgroundColor: `${colors.primary}22` }]}
        >
          <Text style={[styles.badgeText, { color: colors.primary }]}>
            {planName ? planName.toUpperCase() : "STANDARD TIER"}
          </Text>
        </View>
      </View>

      <Text style={styles.renewalText}>Renews on: {renewalDate || "N/A"}</Text>

      <View style={styles.usageContainer}>
        <View style={styles.usageRow}>
          <Text style={styles.usageLabel}>Storage Used</Text>
          <Text style={styles.usageValue}>
            {storageUsed} MB / {storageTotal} MB
          </Text>
        </View>
        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.min(percentage, 100)}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>
      </View>

      <View style={styles.paymentMethod}>
        <Ionicons name="card-outline" size={20} color={colors.textSecondary} />
        <Text style={styles.paymentText}>Secured via Backend Vault</Text>
      </View>

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

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: { padding: 5 },
    subHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    subTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeText: { fontSize: 12, fontWeight: "800" },
    renewalText: { color: colors.textSecondary, marginBottom: 20 },
    usageContainer: { marginBottom: 20 },
    usageRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    usageLabel: { fontSize: 14, color: colors.textSecondary },
    usageValue: { fontSize: 14, fontWeight: "600", color: colors.text },
    progressBarBackground: {
      height: 6,
      backgroundColor: colors.border,
      borderRadius: 3,
      overflow: "hidden",
    },
    progressBarFill: { height: "100%", borderRadius: 3 },
    paymentMethod: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 24,
    },
    paymentText: { fontSize: 14, color: colors.textSecondary },
    primaryButton: {
      backgroundColor: colors.buttonPrimary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: "center",
      marginBottom: 12,
    },
    buttonText: {
      color: colors.buttonPrimaryText,
      fontWeight: "600",
      fontSize: 15,
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: "center",
      marginBottom: 12,
    },
    secondaryButtonText: {
      color: colors.primary,
      fontWeight: "600",
      fontSize: 15,
    },
    manageButton: { alignItems: "center", paddingVertical: 10 },
    cancelText: { color: colors.textSecondary, fontSize: 14 },
  });
