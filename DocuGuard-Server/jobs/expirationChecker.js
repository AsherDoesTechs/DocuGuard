const cron = require("node-cron");
const db = require("../config/db");
const { sendExpirationReminder } = require("../services/notificationService");

// Schedule: Runs every day at 8:00 AM
// Note: On Render free tier, this only works while the server is awake.
// For reliable scheduling, use Render Cron Jobs or an external scheduler.
cron.schedule("0 8 * * *", async () => {
  console.log("Running daily document expiration check...");

  try {
    const query = `
      SELECT d.id, d.title, d.expiry_date, d.category, u.fcm_token, u.expo_push_token, u.notifications_enabled
      FROM documents d
      JOIN users u ON d.user_id = u.id
      WHERE d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        AND d.expiry_date >= CURRENT_DATE
        AND (u.fcm_token IS NOT NULL OR u.expo_push_token IS NOT NULL)
        AND u.notifications_enabled = TRUE
    `;

    const { rows } = await db.query(query);

    for (const record of rows) {
      const expiryDate = new Date(record.expiry_date);
      const today = new Date();
      const diffTime = expiryDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Prefer FCM token, fall back to Expo push token
      const pushToken = record.fcm_token || record.expo_push_token;
      if (!pushToken) continue;

      await sendExpirationReminder(pushToken, record.title, diffDays);
      console.log(`Notification sent for document ${record.id}: ${record.title}`);
    }

    console.log(`Expiration check completed. Processed ${rows.length} documents.`);
  } catch (err) {
    console.error("Error running expiration cron job:", err);
  }
});

console.log("Expiration checker cron job registered.");
