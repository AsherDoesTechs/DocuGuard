import React from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";

export interface EmptyStateProps {
  title: string;
  message: string;
  illustration?: "documents" | "reminders" | "search" | "sync" | "notifications" | "scanner" | "vault" | "folder" | "shield" | "calendar" | "cloud" | "custom";
  customIllustration?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  style?: any;
}

const illustrations: Record<string, React.ReactNode> = {
  documents: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="document-text-outline" size={80} color={COLORS.primary} opacity={0.3} />
      <Ionicons name="document-text-outline" size={60} color={COLORS.primary} opacity={0.2} style={{ position: "absolute", top: 20, right: -10 }} />
      <Ionicons name="document-text-outline" size={40} color={COLORS.primary} opacity={0.15} style={{ position: "absolute", bottom: 10, left: 20 }} />
    </View>
  ),
  reminders: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="notifications-outline" size={80} color={COLORS.warning} opacity={0.3} />
      <Ionicons name="time-outline" size={50} color={COLORS.warning} opacity={0.2} style={{ position: "absolute", top: 15, right: 5 }} />
      <Ionicons name="alarm-outline" size={40} color={COLORS.warning} opacity={0.15} style={{ position: "absolute", bottom: 15, left: 15 }} />
    </View>
  ),
  search: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="search-outline" size={80} color={COLORS.textSecondary} opacity={0.3} />
      <View style={{ position: "absolute", top: 25, right: 10, width: 30, height: 30, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 15, opacity: 0.2 }} />
    </View>
  ),
  sync: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="cloud-upload-outline" size={80} color={COLORS.primary} opacity={0.3} />
      <Ionicons name="refresh-outline" size={45} color={COLORS.primary} opacity={0.2} style={{ position: "absolute", top: 25, right: 15 }} />
    </View>
  ),
  notifications: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="bell-outline" size={80} color={COLORS.primary} opacity={0.3} />
      <View style={{ position: "absolute", top: 10, right: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.danger }} />
    </View>
  ),
  scanner: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="camera-outline" size={80} color={COLORS.primary} opacity={0.3} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: COLORS.primary, borderRadius: 20, opacity: 0.2 }} />
      <View style={{ position: "absolute", top: 20, left: 20, width: 40, height: 40, borderTopWidth: 3, borderLeftWidth: 3, borderColor: COLORS.primary, opacity: 0.4 }} />
      <View style={{ position: "absolute", bottom: 20, right: 20, width: 40, height: 40, borderBottomWidth: 3, borderRightWidth: 3, borderColor: COLORS.primary, opacity: 0.4 }} />
    </View>
  ),
  vault: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="lock-closed-outline" size={80} color={COLORS.success} opacity={0.3} />
      <Ionicons name="shield-checkmark-outline" size={45} color={COLORS.success} opacity={0.2} style={{ position: "absolute", top: 20, right: 10 }} />
    </View>
  ),
  folder: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="folder-open-outline" size={80} color={COLORS.warning} opacity={0.3} />
      <Ionicons name="folder-outline" size={50} color={COLORS.warning} opacity={0.15} style={{ position: "absolute", top: 25, right: -15 }} />
    </View>
  ),
  shield: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="shield-outline" size={80} color={COLORS.primary} opacity={0.3} />
      <Ionicons name="checkmark-circle-outline" size={40} color={COLORS.success} opacity={0.3} style={{ position: "absolute", bottom: 10, right: 10 }} />
    </View>
  ),
  calendar: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="calendar-outline" size={80} color={COLORS.warning} opacity={0.3} />
      <Ionicons name="alert-circle-outline" size={35} color={COLORS.danger} opacity={0.3} style={{ position: "absolute", top: 15, right: 10 }} />
    </View>
  ),
  cloud: (
    <View style={styles.illustrationContainer}>
      <Ionicons name="cloud-outline" size={80} color={COLORS.primary} opacity={0.3} />
      <Ionicons name="cloud-download-outline" size={50} color={COLORS.primary} opacity={0.2} style={{ position: "absolute", top: 25, right: 5 }} />
    </View>
  ),
};

export function EmptyState({
  title,
  message,
  illustration = "documents",
  customIllustration,
  actionLabel,
  onAction,
  actionIcon = "add-outline",
  secondaryActionLabel,
  onSecondaryAction,
  style,
}: EmptyStateProps) {
  const illustrationNode = customIllustration || illustrations[illustration] || illustrations.documents;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.illustrationWrapper}>
        {illustrationNode}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {(actionLabel || secondaryActionLabel) && (
        <View style={styles.actions}>
          {secondaryActionLabel && onSecondaryAction && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onSecondaryAction}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryButtonText}>{secondaryActionLabel}</Text>
            </TouchableOpacity>
          )}
          {actionLabel && onAction && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={onAction}
              activeOpacity={0.8}
            >
              <Ionicons name={actionIcon} size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.primaryButtonText}>{actionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  illustrationWrapper: {
    marginBottom: 24,
  },
  illustrationContainer: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 280,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    maxWidth: 320,
    justifyContent: "center",
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: "600",
  },
});

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <View style={styles.container}>
      <Ionicons name="refresh" size={48} color={COLORS.primary} style={styles.spinning} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}