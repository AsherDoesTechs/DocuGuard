import { Platform } from "react-native";

export async function registerForPushNotificationsAsync(
  _userId: string,
  _apiToken: string,
) {
  if (Platform.OS === "web") {
    return null;
  }

  const Notifications = await import("expo-notifications");
  const Device = await import("expo-device");

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

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
    projectId: "YOUR-PROJECT-ID",
  });

  const pushToken = tokenData.data;
  console.log("Expo Push Token:", pushToken);

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: 5,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#142D4E",
    });
  }

  return pushToken;
}
