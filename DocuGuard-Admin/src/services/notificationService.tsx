import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotificationsAsync(
  userId: string,
  apiToken: string,
) {
  if (!Device.isDevice) {
    console.log("Push Notifications require a physical device.");
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("Failed to get push token for push notification!");
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: "YOUR-PROJECT-ID", // Match your EAS project ID
  });

  const pushToken = tokenData.data;
  console.log("Expo Push Token:", pushToken);

  // Send this token to your Express backend to store in database
  try {
    await fetch("https://your-api-url.com/admin/device-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ userId, pushToken }),
    });
  } catch (err) {
    console.error("Failed to sync push token with backend:", err);
  }

  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#142D4E",
    });
  }

  return pushToken;
}
