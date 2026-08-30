const cron = require("node-cron");
const db = require("../config/db");
const admin = require("../config/firebase");

// Schedule: Runs every day at 8:00 AM
cron.schedule("0 8 * * *", async () => {
  console.log("Running daily document expiration check...");

  try {
    // Query documents expiring in 30 days and fetch the user's FCM device token
    const query = `
      SELECT d.doc_type, u.fcm_token 
      FROM documents d
      JOIN users u ON d.user_id = u.id
      WHERE d.expiration_date = CURRENT_DATE + INTERVAL '30 days'
        AND u.fcm_token IS NOT NULL
    `;

    const { rows } = await db.query(query);

    for (const record of rows) {
      const message = {
        token: record.fcm_token,
        notification: {
          title: "⚠️ Expiration Warning",
          body: `Your ${record.doc_type} is expiring in 30 days. Please take action!`,
        },
        data: {
          docType: record.doc_type,
        },
      };

      // Send the push notification via Firebase
      await admin.messaging().send(message);
      console.log(`Notification sent for ${record.doc_type}`);
    }
  } catch (err) {
    console.error("Error running expiration cron job:", err);
  }
});
