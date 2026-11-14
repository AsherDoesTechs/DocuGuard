import { useState, useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { isRunningInExpoGo } from "expo";
import { api } from "../services/api";

/**
 * Remote push was removed from Expo Go in SDK 53. The push-token
 * APIs throw there, and the throw is surfaced as an unhandled
 * rejection that crashes the module graph. A push token can only
 * be obtained from a development build anyway, so registration is
 * skipped entirely in Expo Go rather than attempted and caught.
 */
const isExpoGo = isRunningInExpoGo();

// Configure how notifications behave when the app is running in the foreground.
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export function usePushNotifications(enabled = true) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] =
    useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null,
  );
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!enabled || isExpoGo) {
      return;
    }

    let cancelled = false;

    registerForPushNotificationsAsync().then((token) => {
      if (cancelled) {
        return;
      }

      if (token) {
        setExpoPushToken(token.expoToken || null);
        void syncTokenToBackend(token);
      }
    });

    // Capture incoming notifications while app is open
    notificationListener.current =
      Notifications.addNotificationReceivedListener((incoming) => {
        setNotification(incoming);
      });

    // Capture user tapping on a notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(() => {
        // Notification tap handled by app logic
      });

    return () => {
      cancelled = true;

      if (notificationListener.current) {
        notificationListener.current.remove();
        notificationListener.current = null;
      }
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
    };
  }, [enabled]);

  return {
    expoPushToken,
    notification,
  };
}

// Helper: Register device and get token
export async function registerForPushNotificationsAsync() {
  // Remote push requires a development build. Expo Go removed it
  // in SDK 53 and its token APIs throw, so bail out before any
  // of them are reached.
  if (isExpoGo) {
    return null;
  }

  let expoToken;
  let deviceToken;

  if (Platform.OS === "android") {
    const alertChannel = {
      name: "DocuGuard Alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
      sound: "info.mp3",
    };

    await Notifications.setNotificationChannelAsync(
      "docuguard-alerts-v2",
      alertChannel,
    );
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
    } catch (error) {
      console.error("Push notification token registration failed:", error);
    }
  } else {
    // Must use physical device for Push Notifications
  }

  return { expoToken, deviceToken };
}

// Helper: Send token to your backend API server
async function syncTokenToBackend(tokens: {
  expoToken?: string;
  deviceToken?: string;
}) {
  try {
    await api.client.post(
      "/api/notifications/push-token",
      {
        expoPushToken: tokens.expoToken,
        devicePushToken: tokens.deviceToken,
      },
      { timeout: 10000 },
    );
  } catch (error: any) {
    console.error("Push token backend synchronization failed:", {
      message: error?.message,
      status: error?.response?.status,
    });
  }
}

/**
 * Registers this device for the account that is signed in right now.
 *
 * The token is stored on the account, so it has to be registered again for
 * every account: a token that was registered for the previous account would
 * push that account's documents to this device.
 *
 * Registering the token also detaches it from every other account, so a
 * token that was left behind by a sign-out that could not reach the server
 * is not pushed to this device under the previous account.
 *
 * The call is best effort. A device that cannot register simply does not
 * receive server notifications, and nothing else about the sign-in depends
 * on it.
 */
export async function registerPushTokenWithBackend(): Promise<void> {
  if (isExpoGo) {
    return;
  }

  try {
    const tokens = await registerForPushNotificationsAsync();

    if (!tokens) {
      return;
    }

    await syncTokenToBackend(tokens);
  } catch (error: any) {
    console.error("Push token registration failed:", {
      message: error?.message,
      status: error?.response?.status,
    });
  }
}

/**
 * Removes this device from the account that is signed in.
 *
 * Called on sign-out, before the session token is deleted, so the server can
 * still tell whose token it is.
 *
 * The outcome is returned instead of being swallowed: a removal that failed
 * leaves the device registered for the account, and the user has to be told
 * that the notifications of the account they left can still reach it.
 */
export async function removePushTokenFromBackend(
  token: string,
): Promise<boolean> {
  if (!token || !token.trim()) {
    console.warn("Push token removal skipped: no session token was supplied.");
    return false;
  }

  try {
    await api.client.delete("/api/notifications/push-token", {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    return true;
  } catch (error: any) {
    console.error("Push token removal failed:", {
      message: error?.message,
      status: error?.response?.status,
    });

    return false;
  }
}
