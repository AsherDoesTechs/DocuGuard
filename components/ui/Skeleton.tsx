import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { useTheme } from "@/context/ThemeContext";

type SkeletonBlockProps = {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

export function SkeletonBlock({
  width = "100%",
  height = 14,
  radius = 8,
  style,
}: SkeletonBlockProps) {
  const { colors } = useTheme();

  return (
    <View
      accessible={false}
      style={[
        styles.block,
        {
          width: width as ViewStyle["width"],
          height,
          borderRadius: radius,
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.borderLight,
        },
        style,
      ]}
    />
  );
}

function SkeletonCard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function HomeSkeleton() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <SkeletonBlock width="42%" height={13} />
        <SkeletonBlock width="66%" height={27} />
      </View>

      <SkeletonCard>
        <SkeletonBlock width="38%" height={13} />
        <View style={styles.heroRow}>
          <SkeletonBlock width={76} height={76} radius={38} />
          <View style={styles.flex}>
            <SkeletonBlock width="72%" height={18} />
            <SkeletonBlock width="92%" height={12} style={styles.gapTop} />
            <SkeletonBlock width="58%" height={12} style={styles.gapTop} />
          </View>
        </View>
        <SkeletonBlock height={9} radius={5} />
      </SkeletonCard>

      <View style={styles.section}>
        <SkeletonBlock width="40%" height={19} />
        <View style={styles.grid}>
          {[1, 2, 3, 4].map((item) => (
            <SkeletonCard key={item}>
              <SkeletonBlock width="48%" height={12} />
              <SkeletonBlock width="36%" height={25} style={styles.gapTop} />
              <SkeletonBlock width="70%" height={10} style={styles.gapTop} />
            </SkeletonCard>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SkeletonBlock width="46%" height={19} />
        {[1, 2, 3].map((item) => (
          <SkeletonCard key={item}>
            <View style={styles.documentRow}>
              <SkeletonBlock width={42} height={48} radius={9} />
              <View style={styles.flex}>
                <SkeletonBlock width="72%" height={14} />
                <SkeletonBlock width="48%" height={11} style={styles.gapTop} />
              </View>
              <SkeletonBlock width={54} height={22} radius={12} />
            </View>
          </SkeletonCard>
        ))}
      </View>
    </View>
  );
}

export function DocumentsSkeleton() {
  return (
    <View style={styles.screen}>
      <View style={styles.documentRow}>
        <SkeletonBlock width="48%" height={14} />
        <SkeletonBlock width={90} height={28} radius={14} />
      </View>

      {[1, 2, 3, 4, 5].map((item) => (
        <SkeletonCard key={item}>
          <View style={styles.documentRow}>
            <SkeletonBlock width={46} height={52} radius={9} />
            <View style={styles.flex}>
              <SkeletonBlock width="78%" height={15} />
              <SkeletonBlock width="52%" height={11} style={styles.gapTop} />
              <SkeletonBlock width="38%" height={10} style={styles.gapTop} />
            </View>
            <SkeletonBlock width={58} height={22} radius={12} />
          </View>
        </SkeletonCard>
      ))}
    </View>
  );
}

export function RemindersSkeleton() {
  return (
    <View style={styles.screen}>
      <View style={styles.grid}>
        {[1, 2].map((item) => (
          <SkeletonCard key={item}>
            <SkeletonBlock width="55%" height={12} />
            <SkeletonBlock width="35%" height={25} style={styles.gapTop} />
          </SkeletonCard>
        ))}
      </View>

      <SkeletonBlock width="42%" height={18} style={styles.sectionTitle} />

      {[1, 2, 3, 4].map((item) => (
        <SkeletonCard key={item}>
          <View style={styles.documentRow}>
            <SkeletonBlock width={40} height={40} radius={20} />
            <View style={styles.flex}>
              <SkeletonBlock width="74%" height={14} />
              <SkeletonBlock width="90%" height={11} style={styles.gapTop} />
              <SkeletonBlock width="42%" height={10} style={styles.gapTop} />
            </View>
          </View>
        </SkeletonCard>
      ))}
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={styles.screen}>
      <View style={styles.profileHeader}>
        <SkeletonBlock width={76} height={76} radius={38} />
        <View style={styles.flex}>
          <SkeletonBlock width="70%" height={18} />
          <SkeletonBlock width="90%" height={12} style={styles.gapTop} />
          <SkeletonBlock width="55%" height={11} style={styles.gapTop} />
        </View>
      </View>

      <SkeletonCard>
        <SkeletonBlock width="42%" height={15} />
        <SkeletonBlock width="66%" height={27} style={styles.gapTop} />
        <SkeletonBlock height={9} radius={5} style={styles.gapTop} />
      </SkeletonCard>

      {[1, 2, 3, 4].map((item) => (
        <SkeletonCard key={item}>
          <View style={styles.documentRow}>
            <SkeletonBlock width={38} height={38} radius={10} />
            <View style={styles.flex}>
              <SkeletonBlock width="52%" height={14} />
              <SkeletonBlock width="78%" height={11} style={styles.gapTop} />
            </View>
            <SkeletonBlock width={22} height={22} radius={11} />
          </View>
        </SkeletonCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: "100%",
    gap: 14,
    paddingBottom: 20,
  },
  block: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  header: {
    gap: 10,
    marginBottom: 4,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginVertical: 12,
  },
  documentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 8,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  gapTop: {
    marginTop: 5,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});