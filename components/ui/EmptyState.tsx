import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";

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

export function EmptyState({
  title,
  message,
  illustration = "documents",
  customIllustration,
  actionLabel,
  onAction,
  actionIcon = "add",
  secondaryActionLabel,
  onSecondaryAction,
  style,
}: EmptyStateProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const illustrations: Record<string, React.ReactNode> = {
    documents: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="document-text-outline" size={80} color={colors.primary} style={{ opacity: 0.3 }} />
        <Ionicons name="document-text-outline" size={60} color={colors.primary} style={{ opacity: 0.2, position: "absolute", top: 20, right: -10 }} />
        <Ionicons name="document-text-outline" size={40} color={colors.primary} style={{ opacity: 0.15, position: "absolute", bottom: 10, left: 20 }} />
      </View>
    ),
    reminders: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="notifications-outline" size={80} color={colors.warning} style={{ opacity: 0.3 }} />
        <Ionicons name="time-outline" size={50} color={colors.warning} style={{ opacity: 0.2, position: "absolute", top: 15, right: 5 }} />
        <Ionicons name="alarm-outline" size={40} color={colors.warning} style={{ opacity: 0.15, position: "absolute", bottom: 15, left: 15 }} />
      </View>
    ),
    search: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="search-outline" size={80} color={colors.textSecondary} style={{ opacity: 0.3 }} />
        <View style={{ position: "absolute", top: 25, right: 10, width: 30, height: 30, borderWidth: 2, borderColor: colors.primary, borderRadius: 15, opacity: 0.2 }} />
      </View>
    ),
    sync: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="cloud-upload-outline" size={80} color={colors.primary} style={{ opacity: 0.3 }} />
        <Ionicons name="sync-outline" size={40} color={colors.primary} style={{ opacity: 0.2, position: "absolute", bottom: 20, right: 15 }} />
      </View>
    ),
    notifications: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="notifications-off-outline" size={80} color={colors.textSecondary} style={{ opacity: 0.3 }} />
      </View>
    ),
    scanner: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="scan-outline" size={80} color={colors.primary} style={{ opacity: 0.3 }} />
        <View style={{ position: "absolute", top: 30, left: 30, width: 60, height: 60, borderWidth: 2, borderColor: colors.primary, borderRadius: 8, opacity: 0.2 }} />
      </View>
    ),
    vault: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="lock-closed-outline" size={80} color={colors.primary} style={{ opacity: 0.3 }} />
      </View>
    ),
    folder: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="folder-open-outline" size={80} color={colors.warning} style={{ opacity: 0.3 }} />
      </View>
    ),
    shield: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="shield-checkmark-outline" size={80} color={colors.success} style={{ opacity: 0.3 }} />
      </View>
    ),
    calendar: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="calendar-outline" size={80} color={colors.primary} style={{ opacity: 0.3 }} />
      </View>
    ),
    cloud: (
      <View style={styles.illustrationContainer}>
        <Ionicons name="cloud-outline" size={80} color={colors.primary} style={{ opacity: 0.3 }} />
      </View>
    ),
    custom: customIllustration || null,
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.illustrationWrapper}>{illustrations[illustration]}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {(actionLabel || secondaryActionLabel) && (
        <View style={styles.actions}>
          {secondaryActionLabel && onSecondaryAction && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onSecondaryAction} activeOpacity={0.7}>
              <Text style={styles.secondaryButtonText}>{secondaryActionLabel}</Text>
            </TouchableOpacity>
          )}
          {actionLabel && onAction && (
            <TouchableOpacity style={styles.primaryButton} onPress={onAction} activeOpacity={0.8}>
              {actionIcon ? <Ionicons name={actionIcon} size={18} color={colors.buttonPrimaryText} style={{ marginRight: 8 }} /> : null}
              <Text style={styles.primaryButtonText}>{actionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1, padding: 32, alignItems: "center", justifyContent: "center" },
    illustrationWrapper: { marginBottom: 24 },
    illustrationContainer: { width: 120, height: 120, justifyContent: "center", alignItems: "center" },
    title: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center", marginBottom: 8 },
    message: {
      fontSize: 15, color: colors.textSecondary, textAlign: "center",
      lineHeight: 22, marginBottom: 28, maxWidth: 280,
    },
    actions: { flexDirection: "row", gap: 12, width: "100%", maxWidth: 320, justifyContent: "center" },
    primaryButton: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      backgroundColor: colors.buttonPrimary, paddingVertical: 14, paddingHorizontal: 20,
      borderRadius: 12,
    },
    primaryButtonText: { color: colors.buttonPrimaryText, fontSize: 15, fontWeight: "600" },
    secondaryButton: {
      flex: 1, backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border,
      paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: "center",
    },
    secondaryButtonText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  });

export function LoadingState({ title = "Loading...", message = "Please wait" }: { title?: string; message?: string }) {
  return <EmptyState title={title} message={message} illustration="cloud" />;
}

export default EmptyState;
