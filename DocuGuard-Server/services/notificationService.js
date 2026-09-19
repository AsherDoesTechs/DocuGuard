const admin = require("../config/firebase");

async function sendPushNotification(token, title, body, data = {}) {
  // Validate token format - Firebase Admin SDK expects FCM tokens, not Expo tokens
  if (!token || typeof token !== "string") {
    return { success: false, error: "Invalid token" };
  }
  
  // Check if it's an Expo push token (starts with ExponentPushToken)
  if (token.startsWith("ExponentPushToken")) {
    console.warn("Expo push token not supported by Firebase Admin SDK, skipping notification");
    return { success: false, error: "Expo token not supported by FCM" };
  }

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

  try {
    const response = await admin.messaging().send(message);
    console.log("Push notification sent:", response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error("Error sending push notification:", error);
    return { success: false, error: error.message };
  }
}

async function sendExpirationReminder(userToken, documentTitle, daysUntilExpiry) {
  let severity = "warning";
  let title = "⚠️ Document Expiring Soon";
  let body = `Your document "${documentTitle}" expires in ${daysUntilExpiry} days.`;

  if (daysUntilExpiry <= 7) {
    severity = "urgent";
    title = "🚨 Document Expiring Very Soon";
    body = `Your document "${documentTitle}" expires in ${daysUntilExpiry} days! Renew immediately.`;
  } else if (daysUntilExpiry <= 0) {
    severity = "urgent";
    title = "🚨 Document Expired";
    body = `Your document "${documentTitle}" has expired! Please renew now.`;
  }

  return sendPushNotification(userToken, title, body, {
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
