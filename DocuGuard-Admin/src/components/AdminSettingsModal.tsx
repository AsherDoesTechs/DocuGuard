import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
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

export function AdminSettingsModal({ visible, onClose, ui, lastSync, onSyncNow, onSignOut, extra, title = "Settings", syncing }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <PressableScale onPress={onClose} accessibilityRole="button" style={styles.closeBtn}><Ionicons name="close" size={20} color={AdminColors.text} /></PressableScale>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.group}>Sync</Text>
            <Row label="Auto-sync every 15s" hint="Automatically refresh data in the background" value={ui.autoSync} onChange={(v) => setAdminUiSettings({ autoSync: v })} />
            <View style={styles.infoRow}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={styles.infoLabel}>Last sync</Text><SyncPulse active={ui.autoSync} syncing={syncing} /></View><Text style={styles.infoValue} selectable>{syncing ? "Syncing now…" : lastSync ? lastSync.toLocaleString() : "Not synced yet"}</Text></View>
            <PressableScale style={styles.actionRow} onPress={onSyncNow}><Ionicons name="refresh-outline" size={16} color={AdminColors.primary} /><Text style={styles.actionText}>{syncing ? "Syncing…" : "Sync now"}</Text></PressableScale>

            <Text style={[styles.group, { marginTop: 14 }]}>Display</Text>
            <Row label="Compact layout" hint="Reduce spacing for faster scanning" value={ui.compactMode} onChange={(v) => setAdminUiSettings({ compactMode: v })} />
            <Row label="Show insights" hint="Display analytics summaries and recommendations" value={ui.showInsights} onChange={(v) => setAdminUiSettings({ showInsights: v })} />

            <Text style={[styles.group, { marginTop: 14 }]}>Privacy & Security</Text>
            <Row label="Privacy-aware mode" hint="Mask emails, actors, IPs and sensitive identifiers" value={ui.privacyMode} onChange={(v) => setAdminUiSettings({ privacyMode: v })} />
            <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={16} color={AdminColors.primary} /><Text style={styles.noticeText}>Admins manage operations and security metadata only. User document contents, private files, and personal secrets are not exposed. Access is role-checked, token-based, and auditable.</Text></View>
            <View style={styles.bullets}>{["No document file/content preview", "Masked identifiers in privacy mode", "Local admin session token", "Sign out clears local session"].map((t) => (<View key={t} style={styles.bulletRow}><Ionicons name="checkmark-circle" size={14} color={AdminColors.success} /><Text style={styles.bulletText}>{t}</Text></View>))}</View>

            <Text style={[styles.group, { marginTop: 14 }]}>Connection</Text>
            <Info label="API endpoint" value={getAdminApiBaseUrl()} />

            {extra ? <View style={{ marginTop: 14 }}><Text style={styles.group}>Page actions</Text>{extra}</View> : null}

            <PressableScale style={styles.signOutBtn} onPress={onSignOut}><Ionicons name="log-out-outline" size={18} color="#fff" /><Text style={styles.signOutText}>Sign out</Text></PressableScale>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.label}>{label}</Text><Text style={styles.hint}>{hint}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: AdminColors.borderStrong, true: "#BFDBFE" }} thumbColor={value ? AdminColors.primary : "#fff"} /></View>;
}
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue} selectable>{value}</Text></View>; }

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(16,24,40,0.28)", justifyContent: "flex-end" },
  card: { backgroundColor: AdminColors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "88%", borderWidth: 1, borderColor: AdminColors.border },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 18, fontWeight: "800", color: AdminColors.text },
  closeBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: AdminColors.surfaceAlt },
  group: { fontSize: 11, fontWeight: "800", color: AdminColors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
  label: { fontSize: 14, fontWeight: "700", color: AdminColors.text },
  hint: { fontSize: 12, color: AdminColors.textSecondary, marginTop: 2, lineHeight: 17 },
  infoRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
  infoLabel: { fontSize: 11, fontWeight: "700", color: AdminColors.textMuted, textTransform: "uppercase", marginBottom: 2 },
  infoValue: { fontSize: 13, color: AdminColors.text },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: AdminColors.border },
  actionText: { fontSize: 14, fontWeight: "600", color: AdminColors.primary },
  notice: { flexDirection: "row", gap: 8, marginTop: 10, padding: 12, borderRadius: AdminRadii.sm, backgroundColor: AdminColors.primarySoft },
  noticeText: { flex: 1, fontSize: 12, color: AdminColors.primaryDark, lineHeight: 18 },
  bullets: { gap: 8, marginTop: 10 },
  bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bulletText: { flex: 1, fontSize: 12, color: AdminColors.textSecondary, lineHeight: 17 },
  signOutBtn: { marginTop: 18, height: 46, borderRadius: 12, backgroundColor: AdminColors.danger, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  signOutText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
