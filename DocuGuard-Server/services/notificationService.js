const admin = require("../config/firebase");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoToken(token) {
  return typeof token === "string" && token.startsWith("ExponentPushToken");
}

/**
 * Sends via the Expo push service, which is what expo-notifications produces on
 * both platforms. The Firebase Admin SDK cannot deliver these, and the client
 * only ever registers Expo tokens, so this channel is what makes push work.
 */
async function sendViaExpo(token, title, body, data = {}) {
  const message = {
    to: token,
    title,
    body,
    sound: "default",
    priority: "high",
    channelId: "docuguard-reminders",
    data,
  };

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Expo push service responded ${response.status}`);
  }

  const result = await response.json();
  const ticket = result?.data;

  if (ticket?.status === "error") {
    throw new Error(
      ticket.message || "Expo push service rejected the notification",
    );
  }

  return ticket?.id;
}

async function sendPushNotification(token, title, body, data = {}) {
  if (!token || typeof token !== "string") {
    return { success: false, error: "Invalid token" };
  }

  try {
    if (isExpoToken(token)) {
      const id = await sendViaExpo(token, title, body, data);
      console.log("Expo push notification sent:", id);
      return { success: true, messageId: id, channel: "expo" };
    }

    // Native FCM tokens (getDevicePushTokenAsync) go through Firebase.
    const message = {
      token,
      notification: {
        title,
        body,
      },
      data,
      android: {
        priority: "high",
        notification: {
          channelId: "docuguard-reminders",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log("FCM push notification sent:", response);
    return { success: true, messageId: response, channel: "fcm" };
  } catch (error) {
    console.error("Error sending push notification:", error);
    return { success: false, error: error.message };
  }
}

async function sendExpirationReminder(userToken, documentTitle, daysUntilExpiry) {
  let severity = "warning";
  let title = "⚠️ Document Expiring Soon";
  let body = `Your document "${documentTitle}" expires in ${daysUntilExpiry} days.`;

  // Check "already expired" first. Testing `<= 7` first swallowed the
  // expired case, so a document past its date was announced as expiring
  // "in 0 days".
  if (daysUntilExpiry <= 0) {
    severity = "urgent";
    title = "🚨 Document Expired";
    body = `Your document "${documentTitle}" has expired! Please renew now.`;
  } else if (daysUntilExpiry <= 7) {
    severity = "urgent";
    title = "🚨 Document Expiring Very Soon";
    body = `Your document "${documentTitle}" expires in ${daysUntilExpiry} days! Renew immediately.`;
  }

  return sendPushNotification(userToken, title, body, {
    type: "expiring",
    severity,
    daysUntilExpiry: String(daysUntilExpiry),
    documentTitle,
  });
}

async function sendVerificationNotification(userToken, documentTitle) {
  return sendPushNotification(
    userToken,
    "✅ Document Verified",
    `Your document "${documentTitle}" has been successfully verified.`,
    {
      type: "verification",
      documentTitle,
    },
  );
}

async function sendProcessingCompleteNotification(
  userToken,
  documentTitle,
  riskLevel,
) {
  let title = "✅ Document Processed";
  let body = `Your document "${documentTitle}" has been processed. Risk level: ${riskLevel}.`;

  if (riskLevel === "High" || riskLevel === "Critical") {
    title = "⚠️ Document Needs Attention";
    body = `Your document "${documentTitle}" has been processed and shows ${riskLevel} risk. Please review.`;
  }

  return sendPushNotification(userToken, title, body, {
    type: "processing_complete",
    documentTitle,
    riskLevel,
  });
}

module.exports = {
  sendPushNotification,
  sendExpirationReminder,
  sendVerificationNotification,
  sendProcessingCompleteNotification,
};
