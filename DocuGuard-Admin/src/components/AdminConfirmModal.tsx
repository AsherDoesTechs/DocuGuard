import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { PressableScale } from "./ui/PressableScale";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AdminConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!visible) return null;
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" />
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <PressableScale style={[styles.btn, styles.btnCancel]} onPress={onCancel}>
            <Text style={styles.btnCancelText}>{cancelLabel}</Text>
          </PressableScale>
          <PressableScale
            style={[styles.btn, destructive ? styles.btnDestructive : styles.btnPrimary]}
            onPress={onConfirm}
          >
            <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "center", alignItems: "center", padding: 20, zIndex: 10000 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(15, 23, 42, 0.45)" },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 20,
  },
  title: { fontSize: 18, fontWeight: "700", color: AdminColors.text },
  message: { fontSize: 14, color: AdminColors.textSecondary, lineHeight: 21, marginTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 22 },
  btn: { minHeight: 44, paddingHorizontal: 18, borderRadius: AdminRadii.sm, alignItems: "center", justifyContent: "center" },
  btnCancel: { backgroundColor: AdminColors.surfaceAlt },
  btnCancelText: { fontSize: 15, fontWeight: "600", color: AdminColors.text },
  btnPrimary: { backgroundColor: AdminColors.primary },
  btnDestructive: { backgroundColor: AdminColors.danger },
  btnPrimaryText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});