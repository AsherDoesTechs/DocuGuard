import { useState, useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "../services/api";

// Configure how notifications behave when the app is running in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null,
  );
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setExpoPushToken(token.expoToken || null);
        syncTokenToBackend(token);
      }
    });

    // Capture incoming notifications while app is open
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        setNotification(notification);
      });

    // Capture user tapping on a notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        // Notification tap handled by app logic
      });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return {
    expoPushToken,
    notification,
  };
}

// Helper: Register device and get token
export async function registerForPushNotificationsAsync() {
  let expoToken;
  let deviceToken;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      return null;
    }

    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      // Get Expo push token
      const expoPushTokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      expoToken = expoPushTokenData.data;

      // Get native device push token (FCM on Android, APNs on iOS)
      const devicePushTokenData = await Notifications.getDevicePushTokenAsync();
      deviceToken = devicePushTokenData.data;
    } catch (e) {
      // Push token fetch failed
    }
  } else {
    // Must use physical device for Push Notifications
  }

  return { expoToken, deviceToken };
}

// Helper: Send token to your backend API server
async function syncTokenToBackend(tokens: { expoToken?: string; deviceToken?: string }) {
  try {
    await api.client.post("/api/notifications/push-token", {
      expoPushToken: tokens.expoToken,
      devicePushToken: tokens.deviceToken,
    });
  } catch (err: any) {
    // Silently fail token sync
  }
}
