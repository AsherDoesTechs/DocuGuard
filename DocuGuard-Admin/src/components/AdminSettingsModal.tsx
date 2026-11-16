import React from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { getAdminApiBaseUrl } from "../services/adminApi";
import { AdminUiSettings, setAdminUiSettings } from "../services/adminSettings";
import { SyncPulse } from "./ui/SyncStatus";
import { PressableScale } from "./ui/PressableScale";

type Props = {
  visible: boolean;
  onClose: () => void;
  ui: AdminUiSettings;
  lastSync: Date | null;
  onSyncNow: () => void;
  onSignOut: () => void;
  extra?: React.ReactNode;
  title?: string;
  syncing?: boolean;
};

export function AdminSettingsModal({
  visible,
  onClose,
  ui,
  lastSync,
  onSyncNow,
  onSignOut,
  extra,
  title = "Settings",
  syncing,
}: Props) {
  if (!visible) return null;
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close settings" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{title}</Text>
          <PressableScale onPress={onClose} accessibilityRole="button" style={styles.closeBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={AdminColors.text} />
          </PressableScale>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Sync</Text>
            <Row
              label="Auto-sync every 15s"
              hint="Refresh data in the background"
              value={ui.autoSync}
              onChange={(v) => setAdminUiSettings({ autoSync: v })}
            />
            <View style={styles.infoBlock}>
              <View style={styles.infoHead}>
                <Text style={styles.infoLabel}>Last sync</Text>
                <SyncPulse active={ui.autoSync} syncing={syncing} />
              </View>
              <Text style={styles.infoValue} selectable>
                {syncing ? "Syncing now…" : lastSync ? lastSync.toLocaleString() : "Not synced yet"}
              </Text>
            </View>
            <PressableScale style={styles.actionRow} onPress={onSyncNow}>
              <Ionicons name="refresh" size={18} color={AdminColors.primary} />
              <Text style={styles.actionText}>{syncing ? "Syncing…" : "Sync now"}</Text>
            </PressableScale>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Display</Text>
            <Row
              label="Compact layout"
              hint="Tighter spacing for scanning"
              value={ui.compactMode}
              onChange={(v) => setAdminUiSettings({ compactMode: v })}
            />
            <Row
              label="Show insights"
              hint="Analytics summaries on dashboards"
              value={ui.showInsights}
              onChange={(v) => setAdminUiSettings({ showInsights: v })}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Privacy</Text>
            <Row
              label="Privacy-aware mode"
              hint="Mask emails, actors, and sensitive IDs"
              value={ui.privacyMode}
              onChange={(v) => setAdminUiSettings({ privacyMode: v })}
            />
            <View style={styles.notice}>
              <Ionicons name="shield-checkmark" size={18} color={AdminColors.primary} />
              <Text style={styles.noticeText}>
                Admins manage operations and security metadata only. No document contents, private files, or secrets are exposed. Access is role-checked, token-based, and auditable.
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Connection</Text>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>API endpoint</Text>
              <Text style={styles.infoValue} selectable numberOfLines={4}>
                {getAdminApiBaseUrl()}
              </Text>
            </View>
          </View>

          {extra ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Page actions</Text>
              {extra}
            </View>
          ) : null}

          <PressableScale style={styles.signOutBtn} onPress={onSignOut}>
            <Ionicons name="log-out-outline" size={20} color="#fff" />
            <Text style={styles.signOutText}>Sign out</Text>
          </PressableScale>
        </ScrollView>
      </View>
    </View>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: AdminColors.borderStrong, true: "#BFDBFE" }}
        thumbColor={value ? AdminColors.primary : "#fff"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: AdminColors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: AdminColors.border,
    borderBottomWidth: 0,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: AdminColors.text,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AdminColors.surfaceAlt,
  },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 4,
  },
  section: {
    marginTop: 20,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: AdminColors.border,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: AdminColors.textMuted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AdminColors.border,
  },
  rowText: { flex: 1 },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: AdminColors.text,
  },
  hint: {
    fontSize: 13,
    color: AdminColors.textSecondary,
    marginTop: 3,
    lineHeight: 18,
  },
  infoBlock: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AdminColors.border,
  },
  infoHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: AdminColors.textMuted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  infoValue: {
    fontSize: 14,
    color: AdminColors.text,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AdminColors.border,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600",
    color: AdminColors.primary,
  },
  notice: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderRadius: AdminRadii.md,
    backgroundColor: AdminColors.primarySoft,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    color: AdminColors.primaryDark,
    lineHeight: 20,
  },
  signOutBtn: {
    marginTop: 28,
    minHeight: 48,
    borderRadius: AdminRadii.md,
    backgroundColor: AdminColors.danger,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  signOutText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
