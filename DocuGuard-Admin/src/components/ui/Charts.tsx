import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AdminColors, AdminRadii } from "../../theme/adminTheme";

type Segment = { label: string; value: number; color: string };

export function BarChart({
  data,
  height = 120,
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}) {
  const safeData = (data || []).map((d) => ({ ...d, value: Number.isFinite(Number(d.value)) ? Number(d.value) : 0 }));
  const max = Math.max(1, ...safeData.map((d) => d.value));
  return (
    <View style={[styles.wrap, { height }]}>
      {safeData.map((d, i) => {
        const h = Math.max(6, (d.value / max) * (height - 34));
        return (
          <View key={`${d.label}-${i}`} style={styles.col}>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: h, backgroundColor: d.color || AdminColors.primary }]} />
            </View>
            <Text style={styles.value} numberOfLines={1}>{d.value}</Text>
            <Text style={styles.label} numberOfLines={1}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, color = AdminColors.primary, height = 8 }: { value: number; color?: string; height?: number }) {
  const numeric = Number(value);
  const pct = Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : 0));
  return (
    <View style={[styles.progressTrack, { height }]}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color, height }]} />
    </View>
  );
}

export function BreakdownList({ segments }: { segments: Segment[] }) {
  const safeSegments = (segments || []).map((s) => ({ ...s, value: Number.isFinite(Number(s.value)) ? Number(s.value) : 0 }));
  const total = safeSegments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.stacked}>
        {safeSegments.map((s, i) => (
          <View key={i} style={{ flex: Math.max(0.0001, s.value), backgroundColor: s.color, height: 10 }} />
        ))}
      </View>
      {safeSegments.map((s, i) => {
        const pct = Math.round((s.value / total) * 100);
        return (
          <View key={i} style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.dot, { backgroundColor: s.color }]} />
              <Text style={styles.rowLabel}>{s.label}</Text>
            </View>
            <Text style={styles.rowValue}>{s.value} <Text style={styles.rowPct}>({pct}%)</Text></Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  col: { flex: 1, alignItems: "center", gap: 4 },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  bar: { width: "70%", borderRadius: 8, minHeight: 6 },
  value: { fontSize: 11, fontWeight: "700", color: AdminColors.text },
  label: { fontSize: 10, color: AdminColors.textSecondary },
  progressTrack: {
    width: "100%",
    backgroundColor: AdminColors.surfaceAlt,
    borderRadius: AdminRadii.pill,
    overflow: "hidden",
  },
  progressFill: { borderRadius: AdminRadii.pill },
  stacked: { flexDirection: "row", width: "100%", borderRadius: AdminRadii.pill, overflow: "hidden", backgroundColor: AdminColors.surfaceAlt },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { fontSize: 13, color: AdminColors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: "700", color: AdminColors.text },
  rowPct: { fontSize: 12, fontWeight: "500", color: AdminColors.textMuted },
});
