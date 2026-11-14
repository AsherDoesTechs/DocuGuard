const app = require("../config/firebase");
const { getMessaging } = require("firebase-admin/messaging");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_MAX_ATTEMPTS = 3;
const PUSH_RETRY_BASE_MS = 500;

function isExpoToken(token) {
  return typeof token === "string" && token.startsWith("ExponentPushToken");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePushError(error, statusCode) {
  if (statusCode && [408, 429, 500, 502, 503, 504].includes(statusCode)) return true;
  const msg = String(error?.message || error || "").toLowerCase();
  return /timeout|network|econnreset|etimedout|temporar|unavailable|fetch failed|socket|429|5\d\d/.test(msg);
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
    channelId: "docuguard-alerts-v2",
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
    const err = new Error(`Expo push service responded ${response.status}`);
    err.statusCode = response.status;
    err.retryable = isRetryablePushError(err, response.status);
    throw err;
  }

  const result = await response.json();
  const ticket = result?.data;

  if (ticket?.status === "error") {
    const err = new Error(ticket.message || "Expo push service rejected the notification");
    const details = ticket.details || {};
    // DeviceNotRegistered / MessageTooBig etc are not retryable; transient errors may be
    err.retryable = !!details.error && /PUSH_TOO_MANY_EXPERIENCE_IDS|PUSH_TOO_MANY_NOTIFICATIONS|MESSAGE_RATE_EXCEEDED/i.test(String(details.error));
    throw err;
  }

  return ticket?.id;
}

async function sendViaFcm(token, title, body, data = {}) {
  const message = {
    token,
    notification: { title, body },
    data,
    android: {
      priority: "high",
      notification: { channelId: "docuguard-alerts-v2", sound: "default" },
    },
    apns: { payload: { aps: { sound: "default" } } },
  };
  return getMessaging(app).send(message);
}

async function sendPushNotification(token, title, body, data = {}) {
  if (!token || typeof token !== "string") {
    return { success: false, error: "Invalid token" };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt++) {
    try {
      if (isExpoToken(token)) {
        const id = await sendViaExpo(token, title, body, data);
        console.log("Expo push notification sent:", id, attempt > 1 ? `(attempt ${attempt})` : "");
        return { success: true, messageId: id, channel: "expo", attempts: attempt };
      }

      // Native FCM tokens (getDevicePushTokenAsync) go through Firebase.
      const response = await sendViaFcm(token, title, body, data);
      console.log("FCM push notification sent:", response, attempt > 1 ? `(attempt ${attempt})` : "");
      return { success: true, messageId: response, channel: "fcm", attempts: attempt };
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true || isRetryablePushError(error, error?.statusCode);
      console.error(`Error sending push notification (attempt ${attempt}/${PUSH_MAX_ATTEMPTS}):`, error?.message || error);
      if (!retryable || attempt >= PUSH_MAX_ATTEMPTS) {
        break;
      }
      await sleep(PUSH_RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }

  return {
    success: false,
    error: lastError?.message || String(lastError || "Push notification failed"),
    attempts: PUSH_MAX_ATTEMPTS,
  };
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

async function sendVerificationNotification(
  userToken,
  documentTitle,
  isSuccessful = true,
  errorMessage = "",
) {
  const title = isSuccessful ? "✅ Document Verified" : "⚠️ Verification Halted";
  const body = isSuccessful
    ? `Your document "${documentTitle}" has been successfully verified.`
    : `Verification halted for "${documentTitle}". ${errorMessage || "Please upload a valid physical document."}`;

  return sendPushNotification(userToken, title, body, {
    type: "verification",
    documentTitle,
    status: isSuccessful ? "success" : "halted",
  });
}

async function sendProcessingCompleteNotification(userToken, documentTitle, riskLevel) {
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
