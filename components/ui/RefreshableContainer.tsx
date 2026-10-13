import React, { useState, useCallback } from "react";
import { ScrollView, RefreshControl } from "react-native";
import { useColors } from "@/context/ThemeContext";

interface Props {
  children: React.ReactNode;
  onRefresh: () => Promise<void>;
  contentContainerStyle?: any;
}

export function RefreshableContainer({
  children,
  onRefresh,
  contentContainerStyle,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);

  const colors = useColors();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);

    try {
      await onRefresh();
      setRefreshing(false);
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <ScrollView
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
          progressViewOffset={12}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
