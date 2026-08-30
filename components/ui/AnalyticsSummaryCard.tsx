import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from ".";
import { COLORS } from "@/constants";

type SummaryProps = {
  healthScore: number;
  expired: number;
  critical: number;
  warning: number;
  stable: number;
};

export function AnalyticsSummaryCard({
  healthScore,
  expired,
  critical,
  warning,
  stable,
}: SummaryProps) {
  return (
    <Card style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Vault Intelligence</Text>
          <Text style={styles.subtitle}>Smart Expiry & Risk Analysis</Text>
        </View>
        <View style={styles.scoreBadge}>
          <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
          <Text style={styles.scoreText}>{healthScore}% Health</Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View
          style={[styles.statBox, { backgroundColor: `${COLORS.danger}10` }]}
        >
          <Text style={[styles.statNumber, { color: COLORS.danger }]}>
            {expired + critical}
          </Text>
          <Text style={styles.statLabel}>Action Required</Text>
        </View>

        <View style={[styles.statBox, { backgroundColor: `#F59E0B10` }]}>
          <Text style={[styles.statNumber, { color: "#F59E0B" }]}>
            {warning}
          </Text>
          <Text style={styles.statLabel}>Expiring Soon</Text>
        </View>

        <View
          style={[styles.statBox, { backgroundColor: `${COLORS.success}10` }]}
        >
          <Text style={[styles.statNumber, { color: COLORS.success }]}>
            {stable}
          </Text>
          <Text style={styles.statLabel}>Secure & Stable</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textSecondary || "#777",
    marginTop: 2,
  },
  scoreBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: `${COLORS.primary}15`,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  scoreText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
  },
  grid: {
    flexDirection: "row",
    gap: 10,
  },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textSecondary || "#777",
    textAlign: "center",
  },
});
