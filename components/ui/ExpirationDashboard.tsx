import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";
import Spacing from "@/constants/spacing";
import { Spacing as SpacingObj } from "@/constants/spacing";
const RADIUS = { md: 12 };
import { DocumentDashboardSummary } from "@/types/offline";
import { formatShortDate } from "@/utils";

interface ExpirationDashboardProps {
  summary: DocumentDashboardSummary;
  onPressCard?: (status: string) => void;
}

type StatusKey = "valid" | "expiring" | "expired";

const STATUS_CONFIG: Record<StatusKey, { label: string; color: string }> = {
  valid: { label: "Valid", color: COLORS.success },
  expiring: { label: "Expiring", color: COLORS.warning },
  expired: { label: "Expired", color: COLORS.danger },
};

export default function ExpirationDashboard({
  summary,
  onPressCard,
}: ExpirationDashboardProps) {
  const router = useRouter();
  const { total, valid, expiring, expired, nextExpiring } = summary;

  const handleCardPress = (status: string) => {
    if (onPressCard) {
      onPressCard(status);
    } else {
      router.push("/(tabs)/documents");
    }
  };

  const renderStatusCard = (
    key: StatusKey,
    count: number,
    total: number,
  ) => {
    const config = STATUS_CONFIG[key];
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.statusCard, { borderColor: config.color + "30" }]}
        onPress={() => handleCardPress(key)}
        activeOpacity={0.7}
      >
        <View style={styles.statusHeader}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: config.color },
            ]}
          />
          <Text style={styles.statusLabel}>{config.label}</Text>
        </View>
        <Text style={styles.statusCount}>{count}</Text>
        <Text style={[styles.statusPercentage, { color: config.color }]}>
          {percentage}% of {total}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Document Overview</Text>
        <Text style={styles.subtitle}>
          {total} Total Documents
        </Text>
      </View>

      <View style={styles.statusGrid}>
        {renderStatusCard("valid", valid, total)}
        {renderStatusCard("expiring", expiring, total)}
        {renderStatusCard("expired", expired, total)}
      </View>

      {nextExpiring && (
        <TouchableOpacity
          style={styles.nextExpiringCard}
          onPress={() =>
            router.push(
              `/document-details/${String(nextExpiring.id)}` as any,
            )
          }
          activeOpacity={0.7}
        >
          <View style={styles.nextExpiringHeader}>
            <Ionicons
              name="time-outline"
              size={20}
              color={COLORS.warning}
            />
            <Text style={styles.nextExpiringLabel}>Next Expiration</Text>
          </View>
          <Text style={styles.nextExpiringTitle} numberOfLines={1}>
            {nextExpiring.title}
          </Text>
          <View style={styles.nextExpiringMeta}>
            <Text style={styles.nextExpiringDate}>
              Expires {formatShortDate(nextExpiring.expiryDate)}
            </Text>
            <Text
              style={[
                styles.nextExpiringDays,
                {
                  color:
                    nextExpiring.daysRemaining <= 7
                      ? COLORS.danger
                      : nextExpiring.daysRemaining <= 30
                        ? COLORS.warning
                        : COLORS.success,
                },
              ]}
            >
              {nextExpiring.daysRemaining} days remaining
            </Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.xl,
  },
  header: {
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  statusCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: Spacing.md,
    borderWidth: 1,
    alignItems: "center",
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: Spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  statusCount: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
  },
  statusPercentage: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  nextExpiringCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  nextExpiringHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: Spacing.xs,
  },
  nextExpiringLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  nextExpiringTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: Spacing.xs,
  },
  nextExpiringMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  nextExpiringDate: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  nextExpiringDays: {
    fontSize: 13,
    fontWeight: "700",
  },
});
