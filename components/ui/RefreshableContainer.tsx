import React, { useState, useCallback } from "react";
import { ScrollView, RefreshControl, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { COLORS } from "@/constants";

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

  // Helper to trigger haptics safely
  const triggerHaptic = async (type: "impact" | "success") => {
    try {
      if (Platform.OS === "ios" || Platform.OS === "android") {
        if (type === "impact") {
          await Haptics.selectionAsync(); // Universally supported "tap"
        } else {
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
        }
      }
    } catch (error) {
      // Ignore errors if hardware doesn't support haptics
    }
  };

  const handleRefresh = useCallback(async () => {
    await triggerHaptic("impact");
    setRefreshing(true);

    const holdTimer = new Promise((resolve) => setTimeout(resolve, 2500));

    try {
      await Promise.all([onRefresh(), holdTimer]);
    } catch (error) {
      console.error("Refresh failed:", error);
    }

    setRefreshing(false);
    await triggerHaptic("success");
  }, [onRefresh]);

  return (
    <ScrollView
      contentContainerStyle={contentContainerStyle}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
          progressViewOffset={20}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
