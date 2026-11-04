const cron = require("node-cron");
const db = require("../config/db");
const { sendExpirationReminder } = require("../services/notificationService");
const { debug, info, warn } = require("../utils/debugLogger");

const DEFAULT_WINDOW_DAYS = 30;

// Send with bounded concurrency per user. The previous serial await-per-document
// turned N users into N sequential network round-trips inside a single cron tick.
const CONCURRENCY = 5;

/**
 * Fetch all users with notification and reminder settings.
 */
async function getUsersWithReminderSettings() {
  const { rows } = await db.query(`
    SELECT u.id,
           u.email,
           u.expo_push_token,
           u.fcm_token,
           u.notifications_enabled,
           u.expiry_alerts,
           COALESCE(s.reminder_before_days, $1) AS reminder_before_days,
           s.reminder_30days,
           s.reminder_7days,
           s.reminder_1day,
           s.reminder_on_day
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
  `, [DEFAULT_WINDOW_DAYS]);
  return rows;
}

/**
 * Fetch documents expiring within the user's configured window for one user.
 * Respects per-document enable_alerts, skips tombstones, and only includes
 * documents whose expiry interval matches one of the user's enabled reminder
 * intervals (30/7/1/on_day).
 */
async function getExpiringDocumentsForUser(userId, windowDays, reminderFlags) {
  const { rows } = await db.query(
    `
    SELECT d.id, d.title, d.expiry_date,
           (d.expiry_date - CURRENT_DATE) AS days_until_expiry
    FROM documents d
    WHERE d.user_id = $1
      AND d.enable_alerts = TRUE
      AND d.status <> 'deleted'
      AND d.expiry_date IS NOT NULL
      AND d.expiry_date != ''
      AND d.expiry_date <= CURRENT_DATE + ($2 || ' days')::interval
      AND d.expiry_date >= CURRENT_DATE
      AND (
        ($3 = TRUE AND d.expiry_date <= CURRENT_DATE + '30 days'::interval)
        OR ($4 = TRUE AND d.expiry_date <= CURRENT_DATE + '7 days'::interval)
        OR ($5 = TRUE AND d.expiry_date <= CURRENT_DATE + '1 days'::interval)
        OR ($6 = TRUE AND d.expiry_date = CURRENT_DATE)
      )
    ORDER BY d.expiry_date ASC
    `,
    [userId, windowDays,
      reminderFlags.reminder_30days !== false,
      reminderFlags.reminder_7days !== false,
      reminderFlags.reminder_1day !== false,
      reminderFlags.reminder_on_day !== false,
    ],
  );
  return rows;
}

/**
 * Send expiration reminders for all users, honouring per-user reminder
 * schedules. Each user's `reminder_before_days` controls how far ahead the
 * job looks; the individual interval flags (30/7/1/on_day) control which
 * expiry intervals trigger a notice.
 */
async function runExpirationCheck() {
  info("ExpirationChecker", "Starting daily document expiration check");

  let totalUsers = 0;
  let totalDocumentsNotified = 0;
  let totalSent = 0;
  let totalFailed = 0;

  try {
    const users = await getUsersWithReminderSettings();

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (user) => {
          totalUsers++;

          // Skip users who have opted out of notifications or expiry alerts.
          if (user.notifications_enabled !== true) {
            debug("ExpirationChecker", "Skipping user - notifications disabled", {
              userId: user.id,
            });
            return;
          }
          if (user.expiry_alerts !== true) {
            debug("ExpirationChecker", "Skipping user - expiry alerts disabled", {
              userId: user.id,
            });
            return;
          }

          const pushToken = user.expo_push_token || user.fcm_token;
          if (!pushToken) {
            debug("ExpirationChecker", "Skipping user - no push token", {
              userId: user.id,
            });
            return;
          }

          const windowDays = Number(user.reminder_before_days) || DEFAULT_WINDOW_DAYS;
          const reminderFlags = {
            reminder_30days: user.reminder_30days,
            reminder_7days: user.reminder_7days,
            reminder_1day: user.reminder_1day,
            reminder_on_day: user.reminder_on_day,
          };

          try {
            const docs = await getExpiringDocumentsForUser(
              user.id,
              windowDays,
              reminderFlags,
            );

            if (docs.length === 0) {
              return;
            }

            info("ExpirationChecker", "Documents expiring for user", {
              userId: user.id,
              documentCount: docs.length,
            });

            for (const doc of docs) {
              const diffDays = Number(doc.days_until_expiry) || 0;

              try {
                const result = await sendExpirationReminder(
                  pushToken,
                  doc.title,
                  diffDays,
                );

                if (result?.success) {
                  totalSent++;
                } else {
                  totalFailed++;
                  warn("ExpirationChecker", "Notification failed for document", {
                    userId: user.id,
                    documentId: doc.id,
                    error: result?.error,
                  });
                }
              } catch (err) {
                totalFailed++;
                warn("ExpirationChecker", "Notification error for document", {
                  userId: user.id,
                  documentId: doc.id,
                  error: err.message,
                });
              }
            }

            totalDocumentsNotified += docs.length;
          } catch (err) {
            warn("ExpirationChecker", "Failed to fetch expiring documents for user", {
              userId: user.id,
              error: err.message,
            });
          }
        }),
      );
    }

    info("ExpirationChecker", "Expiration check complete", {
      users: totalUsers,
      documentsNotified: totalDocumentsNotified,
      sent: totalSent,
      failed: totalFailed,
    });
  } catch (err) {
    warn("ExpirationChecker", "Expiration check failed", {
      error: err.message,
    });
  }
}

// Schedule: Runs every day at 8:00 AM
// Note: On Render free tier, this only works while the server is awake.
// For reliable scheduling, use Render Cron Jobs or an external scheduler.
let expirationTask = null;
if (process.env.NODE_ENV !== "test") {
  expirationTask = cron.schedule("0 8 * * *", runExpirationCheck);
}

console.log("Expiration checker cron job registered.");

module.exports = {
  runExpirationCheck,
  EXPIRING_WINDOW_DAYS: DEFAULT_WINDOW_DAYS,
  getUsersWithReminderSettings,
  getExpiringDocumentsForUser,
  stop: () => expirationTask?.stop(),
};
