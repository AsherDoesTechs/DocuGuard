import * as Updates from "expo-updates";
import { Alert } from "react-native";

export async function checkForAppUpdates() {
  if (__DEV__) {
    console.log("Skipping OTA update check in development mode.");
    return;
  }

  try {
    const update = await Updates.checkForUpdateAsync();

    if (update.isAvailable) {
      Alert.alert(
        "Update Available",
        "A new version of DocuGuard Admin is ready. Download it now?",
        [
          { text: "Later", style: "cancel" },
          {
            text: "Update",
            onPress: async () => {
              await Updates.fetchUpdateAsync();
              await Updates.reloadAsync();
            },
          },
        ],
      );
    }
  } catch (error) {
    console.error("Error checking for OTA updates:", error);
  }
}
