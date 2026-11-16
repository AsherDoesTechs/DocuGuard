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
            <Text style={styles.value} numberOfLines={1}>
              {d.value}
            </Text>
            <Text style={styles.label} numberOfLines={1}>
              {d.label}
            </Text>
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
            <Text style={styles.rowValue}>
              {s.value} <Text style={styles.rowPct}>({pct}%)</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function SparklineCard({
  title,
  value,
  hint,
  tone = "primary",
}: {
  title: string;
  value: string | number;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const color = tone === "success" ? AdminColors.success : tone === "warning" ? AdminColors.warning : tone === "danger" ? AdminColors.danger : AdminColors.primary;
  const bg = tone === "success" ? AdminColors.successSoft : tone === "warning" ? AdminColors.warningSoft : tone === "danger" ? AdminColors.dangerSoft : AdminColors.primarySoft;
  return (
    <View style={[styles.indicatorCard, { backgroundColor: bg, borderColor: "transparent" }]}>
      <Text style={styles.indicatorTitle}>{title}</Text>
      <Text style={[styles.indicatorValue, { color }]}>{value}</Text>
      {hint ? <Text style={styles.indicatorHint}>{hint}</Text> : null}
    </View>
  );
}

export function GroupedBarChart({
  data,
  series,
  height = 140,
}: {
  data: { label: string }[];
  series: { key: string; label: string; color: string; values: number[] }[];
  height?: number;
}) {
  const safeData = data || [];
  const flat = series.flatMap((s) => s.values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)));
  const max = Math.max(1, ...flat);
  const groupWidth = Math.max(28, 220 / Math.max(1, safeData.length));
  return (
    <View style={{ height }}>
      <View style={[styles.groupedRow, { height: height - 22 }]}>
        {safeData.map((d, i) => (
          <View key={`${d.label}-${i}`} style={[styles.groupedCol, { width: groupWidth }]}>
            <View style={styles.groupedBars}>
              {series.map((s) => {
                const v = Number(s.values[i] ?? 0);
                const h = Math.max(4, (v / max) * (height - 52));
                return <View key={s.key} style={[styles.groupedBar, { height: h, backgroundColor: s.color }]} />;
              })}
            </View>
            <Text style={styles.groupedLabel} numberOfLines={1}>
              {d.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.legendRow}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function TrendLineChart({
  data,
  height = 120,
  color = AdminColors.primary,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const safe = (data || []).map((d) => ({ ...d, value: Number.isFinite(Number(d.value)) ? Number(d.value) : 0 }));
  const max = Math.max(1, ...safe.map((d) => d.value));
  const chartH = height - 28;
  const points = safe.map((d, i) => {
    const x = safe.length <= 1 ? 50 : (i / (safe.length - 1)) * 100;
    const y = chartH - (d.value / max) * chartH;
    return { x, y, v: d.value, l: d.label };
  });
  return (
    <View style={{ height }}>
      <View style={[styles.trendWrap, { height: chartH }]}>
        <View style={styles.trendGrid} />
        {points.map((p, i) => (
          <View
            key={i}
            style={[
              styles.trendDot,
              {
                left: `${p.x}%`,
                top: p.y,
                marginLeft: -4,
                backgroundColor: color,
              },
            ]}
          />
        ))}
        {points.map((p, i) => {
          if (i === 0) return null;
          const prev = points[i - 1];
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          const left = prev.x + dx / 2;
          const top = (prev.y + p.y) / 2;
          return (
            <View
              key={`seg-${i}`}
              style={[
                styles.trendSeg,
                {
                  width: len,
                  left: `${left}%`,
                  top,
                  marginLeft: -len / 2,
                  transform: [{ rotate: `${angle}deg` }],
                  backgroundColor: color,
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.trendLabels}>
        {safe.map((d, i) => (
          <Text key={i} style={styles.trendLabelText} numberOfLines={1}>
            {d.label}
          </Text>
        ))}
      </View>
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
  indicatorCard: { flex: 1, minWidth: "45%", borderRadius: AdminRadii.md, padding: 12, borderWidth: 1 },
  indicatorTitle: { fontSize: 11, color: AdminColors.textSecondary, fontWeight: "600" },
  indicatorValue: { fontSize: 18, fontWeight: "800", marginTop: 4 },
  indicatorHint: { fontSize: 11, color: AdminColors.textMuted, marginTop: 4 },
  groupedRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 6 },
  groupedCol: { alignItems: "center" },
  groupedBars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: "100%" },
  groupedBar: { width: 10, borderRadius: 4, minHeight: 4 },
  groupedLabel: { fontSize: 9, color: AdminColors.textSecondary, marginTop: 4, maxWidth: 56 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 11, color: AdminColors.textSecondary },
  trendWrap: { position: "relative", width: "100%", backgroundColor: AdminColors.surfaceAlt, borderRadius: 8, overflow: "hidden" },
  trendGrid: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: AdminColors.border },
  trendDot: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  trendSeg: { position: "absolute", height: 2, borderRadius: 1 },
  trendLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  trendLabelText: { fontSize: 9, color: AdminColors.textSecondary, flex: 1, textAlign: "center" },
});
