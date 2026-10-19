import React, { useState, useCallback } from "react";
import {
  ScrollView,
  RefreshControl,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useColors } from "@/context/ThemeContext";

interface Props {
  children: React.ReactNode;
  onRefresh: () => Promise<void>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function RefreshableContainer({
  children,
  onRefresh,
  contentContainerStyle,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const colors = useColors();

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;

    setRefreshing(true);

    try {
      await onRefresh();
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
          progressBackgroundColor={colors.surface}
          progressViewOffset={12}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
