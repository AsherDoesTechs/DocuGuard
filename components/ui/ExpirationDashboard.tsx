import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";
import Spacing from "@/constants/spacing";
import { DocumentDashboardSummary } from "@/types/offline";
import { formatShortDate } from "@/utils";

interface ExpirationDashboardProps {
  summary: DocumentDashboardSummary;
  onPressCard?: (status: string) => void;
}

type StatusKey = "valid" | "expiring" | "expired";

export default function ExpirationDashboard({
  summary,
  onPressCard,
}: ExpirationDashboardProps) {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { total, valid, expiring, expired, nextExpiring } = summary;

  const statusConfig: Record<StatusKey, { label: string; color: string }> = {
    valid: { label: "Valid", color: colors.success },
    expiring: { label: "Expiring", color: colors.warning },
    expired: { label: "Expired", color: colors.error },
  };

  const handleCardPress = (status: string) => {
    if (onPressCard) {
      onPressCard(status);
    } else {
      router.push("/(tabs)/documents");
    }
  };

  const renderStatusCard = (key: StatusKey, count: number, totalCount: number) => {
    const config = statusConfig[key];
    const percentage = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.statusCard, { borderColor: config.color + "40" }]}
        onPress={() => handleCardPress(key)}
        activeOpacity={0.7}
      >
        <View style={styles.statusHeader}>
          <View style={[styles.statusDot, { backgroundColor: config.color }]} />
          <Text style={styles.statusLabel}>{config.label}</Text>
        </View>
        <Text style={styles.statusCount}>{count}</Text>
        <Text style={[styles.statusPercentage, { color: config.color }]}>
          {percentage}% of {totalCount}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Document Overview</Text>
        <Text style={styles.subtitle}>{total} Total Documents</Text>
      </View>

      <View style={styles.statusGrid}>
        {renderStatusCard("valid", valid, total)}
        {renderStatusCard("expiring", expiring, total)}
        {renderStatusCard("expired", expired, total)}
      </View>

      {nextExpiring && (
        <TouchableOpacity
          style={styles.nextExpiringCard}
          onPress={() => router.push(`/document-details/${String(nextExpiring.id)}` as any)}
          activeOpacity={0.7}
        >
          <View style={styles.nextExpiringHeader}>
            <Ionicons name="time-outline" size={20} color={colors.warning} />
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
                      ? colors.error
                      : nextExpiring.daysRemaining <= 30
                        ? colors.warning
                        : colors.success,
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

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: { marginBottom: Spacing.xl },
    header: { marginBottom: Spacing.md },
    title: { fontSize: 18, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    statusGrid: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
    statusCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: Spacing.md,
      borderWidth: 1,
      alignItems: "center",
    },
    statusHeader: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: Spacing.xs },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    statusCount: { fontSize: 28, fontWeight: "700", color: colors.text },
    statusPercentage: { fontSize: 11, fontWeight: "600", marginTop: 2 },
    nextExpiringCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nextExpiringHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: Spacing.xs },
    nextExpiringLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    nextExpiringTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: Spacing.xs },
    nextExpiringMeta: { flexDirection: "row", justifyContent: "space-between" },
    nextExpiringDate: { fontSize: 13, color: colors.textSecondary },
    nextExpiringDays: { fontSize: 13, fontWeight: "700" },
  });
