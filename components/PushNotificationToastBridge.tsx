import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useColors } from "@/context/ThemeContext";

interface PushBanner {
  id: string;
  title: string;
  body: string;
}

interface PushNotificationToastBridgeProps {
  enabled?: boolean;
}

const BANNER_DURATION = 6500;

export default function PushNotificationToastBridge({
  enabled = true,
}: PushNotificationToastBridgeProps) {
  // Defer push registration, token sync, and listeners until startup is ready.
  const { notification } = usePushNotifications(enabled);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [banner, setBanner] = useState<PushBanner | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNotificationIdRef = useRef<string | null>(null);

  const dismissBanner = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setBanner(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      dismissBanner();
    }
  }, [enabled, dismissBanner]);

  useEffect(() => {
    if (!notification) {
      return;
    }

    const request = notification.request;
    const content = request.content;
    const notificationId =
      request.identifier || `${content.title ?? ""}:${content.body ?? ""}`;

    // Prevent the same notification from being displayed twice.
    if (lastNotificationIdRef.current === notificationId) {
      return;
    }

    lastNotificationIdRef.current = notificationId;

    // Do not expose notification content during onboarding, startup, or app lock.
    if (!enabled) {
      return;
    }

    const title = content.title?.trim() || "DocuGuard Notification";
    const body = content.body?.trim() || "";

    if (!body && !content.title?.trim()) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setBanner({
      id: notificationId,
      title,
      body,
    });

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setBanner(null);
    }, BANNER_DURATION);
  }, [notification, enabled]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!enabled || !banner) {
    return null;
  }

  const styles = StyleSheet.create({
    container: {
      position: "absolute",
      top: insets.top + (Platform.OS === "ios" ? 10 : 8),
      left: 16,
      right: 16,
      zIndex: 10000,
      elevation: 12,
    },
    banner: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: 15,
      paddingVertical: 15,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.16,
      shadowRadius: 12,
      elevation: 8,
    },
    iconContainer: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    textContainer: {
      flex: 1,
      paddingTop: 1,
      paddingRight: 8,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.1,
      textTransform: "uppercase",
      color: colors.primary,
      marginBottom: 4,
    },
    title: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      marginBottom: banner.body ? 3 : 0,
    },
    body: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "400",
    },
    closeButton: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -4,
      marginRight: -7,
    },
  });

  return (
    <View
      pointerEvents="box-none"
      style={styles.container}
      accessibilityLiveRegion="polite"
    >
      <Animated.View
        key={banner.id}
        entering={FadeInDown.duration(220)}
        exiting={FadeOutUp.duration(180)}
        style={styles.banner}
        accessibilityRole="alert"
      >
        <View style={styles.iconContainer}>
          <Ionicons name="notifications" size={22} color={colors.primary} />
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.eyebrow}>DocuGuard Alert</Text>

          <Text style={styles.title} numberOfLines={2}>
            {banner.title}
          </Text>

          {banner.body ? (
            <Text style={styles.body} numberOfLines={4}>
              {banner.body}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={dismissBanner}
          hitSlop={10}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification banner"
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
