const cron = require("node-cron");
const db = require("../config/db");
const { sendExpirationReminder } = require("../services/notificationService");

const EXPIRING_WINDOW_DAYS = 30;

// Send with bounded concurrency. The previous serial await-per-document turned
// N users into N sequential network round-trips inside a single cron tick.
const CONCURRENCY = 5;

async function runExpirationCheck() {
  console.log("Running daily document expiration check...");

  try {
    // Two buckets in one pass:
    //   - documents still inside the 30 day window, and
    //   - documents that have already passed their expiry date.
    // The old query filtered out expired documents entirely, so the
    // "Document Expired" message could never fire.
    //
    // enable_alerts is honoured here now; it was plumbed everywhere except
    // the one place that decides whether to notify.
    const { rows } = await db.query(
      `
      SELECT d.id, d.title, d.expiry_date,
             (d.expiry_date - CURRENT_DATE) AS days_until_expiry,
             COALESCE(u.expo_push_token, u.fcm_token) AS push_token,
             u.notifications_enabled
      FROM documents d
      JOIN users u ON d.user_id = u.id
      WHERE d.enable_alerts = TRUE
        AND u.notifications_enabled = TRUE
        AND d.expiry_date <= CURRENT_DATE + ($1 || ' days')::interval
        AND COALESCE(u.expo_push_token, u.fcm_token) IS NOT NULL
      ORDER BY d.expiry_date ASC
      `,
      [EXPIRING_WINDOW_DAYS],
    );

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (record) => {
          const diffDays = Number(record.days_until_expiry) || 0;

          try {
            // sendExpirationReminder resolves {success:false} rather than
            // throwing, so the result has to be inspected. The old code logged
            // "Notification sent" unconditionally, including on failure.
            const result = await sendExpirationReminder(
              record.push_token,
              record.title,
              diffDays,
            );

            if (result?.success) {
              sent++;
            } else {
              failed++;
              console.warn(
                `Notification failed for document ${record.id}: ${result?.error}`,
              );
            }
          } catch (err) {
            failed++;
            console.error(
              `Notification error for document ${record.id}:`,
              err.message,
            );
          }
        }),
      );
    }

    console.log(
      `Expiration check completed. Processed ${rows.length} documents: ${sent} sent, ${failed} failed.`,
    );
  } catch (err) {
    console.error("Error running expiration cron job:", err);
  }
}

// Schedule: Runs every day at 8:00 AM
// Note: On Render free tier, this only works while the server is awake.
// For reliable scheduling, use Render Cron Jobs or an external scheduler.
cron.schedule("0 8 * * *", runExpirationCheck);

console.log("Expiration checker cron job registered.");

module.exports = { runExpirationCheck, EXPIRING_WINDOW_DAYS };
