import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { PressableScale } from "./ui/PressableScale";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  buttonLabel?: string;
  tone?: "default" | "danger";
  onDismiss: () => void;
};

export function AdminMessageModal({ visible, title, message, buttonLabel = "OK", tone = "default", onDismiss }: Props) {
  if (!visible) return null;
  const isDanger = tone === "danger";
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" />
      <View style={styles.card}>
        <View style={[styles.iconWrap, isDanger && styles.iconWrapDanger]}>
          <Ionicons name={isDanger ? "alert-circle" : "information-circle"} size={28} color={isDanger ? AdminColors.danger : AdminColors.primary} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <PressableScale style={[styles.btn, isDanger ? styles.btnDanger : styles.btnPrimary]} onPress={onDismiss}>
          <Text style={styles.btnText}>{buttonLabel}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "center", alignItems: "center", padding: 20, zIndex: 10000 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(15, 23, 42, 0.45)" },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 24,
    alignItems: "center",
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: AdminColors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  iconWrapDanger: { backgroundColor: AdminColors.dangerSoft },
  title: { fontSize: 18, fontWeight: "700", color: AdminColors.text, textAlign: "center" },
  message: { fontSize: 14, color: AdminColors.textSecondary, lineHeight: 21, marginTop: 10, textAlign: "center" },
  btn: { marginTop: 22, minHeight: 46, minWidth: 140, paddingHorizontal: 24, borderRadius: AdminRadii.sm, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: AdminColors.primary },
  btnDanger: { backgroundColor: AdminColors.danger },
  btnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});