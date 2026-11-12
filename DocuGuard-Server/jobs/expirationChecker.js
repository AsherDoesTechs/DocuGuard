const cron = require("node-cron");
const db = require("../config/db");
const { sendExpirationReminder } = require("../services/notificationService");
const { sendExpirationReminderEmail } = require("../config/email");
const { debug, info, warn } = require("../utils/debugLogger");

const DEFAULT_WINDOW_DAYS = 30;

// Send with bounded concurrency per user.
const CONCURRENCY = 5;

function formatExpiryDate(value) {
  if (!value) return "Unknown";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

function getReminderBucket(daysUntilExpiry, reminderFlags) {
  const days = Number(daysUntilExpiry);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return reminderFlags.reminder_on_day !== false ? "expired_or_today" : null;
  if (days === 1) return reminderFlags.reminder_1day !== false ? "1_day" : null;
  if (days <= 7) return reminderFlags.reminder_7days !== false ? "7_days" : null;
  if (days <= 30) return reminderFlags.reminder_30days !== false ? "30_days" : null;
  return null;
}

async function ensureEmailReminderTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS document_email_reminder_deliveries (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      reminder_bucket TEXT NOT NULL,
      expiry_date DATE NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, document_id, reminder_bucket, expiry_date)
    );
  `);
}

async function wasEmailReminderSent(userId, documentId, reminderBucket, expiryDate) {
  const { rows } = await db.query(
    `SELECT 1
     FROM document_email_reminder_deliveries
     WHERE user_id = $1 AND document_id = $2 AND reminder_bucket = $3 AND expiry_date = $4::date
     LIMIT 1`,
    [userId, documentId, reminderBucket, expiryDate],
  );
  return rows.length > 0;
}

async function markEmailReminderSent(userId, documentId, reminderBucket, expiryDate) {
  await db.query(
    `INSERT INTO document_email_reminder_deliveries (user_id, document_id, reminder_bucket, expiry_date)
     VALUES ($1, $2, $3, $4::date)
     ON CONFLICT (user_id, document_id, reminder_bucket, expiry_date) DO NOTHING`,
    [userId, documentId, reminderBucket, expiryDate],
  );
}

/**
 * Fetch all users with notification and reminder settings.
 */
async function getUsersWithReminderSettings() {
  const { rows } = await db.query(
    `
    SELECT u.id,
           u.name,
           u.email,
           u.expo_push_token,
           u.fcm_token,
           u.notifications_enabled,
           u.expiry_alerts,
           u.email_alerts,
           COALESCE(s.reminder_before_days, $1) AS reminder_before_days,
           s.reminder_30days,
           s.reminder_7days,
           s.reminder_1day,
           s.reminder_on_day
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
  `,
    [DEFAULT_WINDOW_DAYS],
  );
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
           (d.expiry_date::date - CURRENT_DATE) AS days_until_expiry
    FROM documents d
    WHERE d.user_id = $1
      AND d.enable_alerts = TRUE
      AND d.status <> 'deleted'
      AND d.expiry_date IS NOT NULL
      AND d.expiry_date::text <> ''
      AND d.expiry_date::date <= CURRENT_DATE + ($2 || ' days')::interval
      AND d.expiry_date::date >= CURRENT_DATE - INTERVAL '1 day'
      AND (
        ($3 = TRUE AND d.expiry_date::date <= CURRENT_DATE + INTERVAL '30 days' AND d.expiry_date::date > CURRENT_DATE + INTERVAL '7 days')
        OR ($4 = TRUE AND d.expiry_date::date <= CURRENT_DATE + INTERVAL '7 days' AND d.expiry_date::date > CURRENT_DATE + INTERVAL '1 day')
        OR ($5 = TRUE AND d.expiry_date::date <= CURRENT_DATE + INTERVAL '1 day' AND d.expiry_date::date > CURRENT_DATE)
        OR ($6 = TRUE AND d.expiry_date::date <= CURRENT_DATE AND d.expiry_date::date >= CURRENT_DATE - INTERVAL '1 day')
      )
    ORDER BY d.expiry_date ASC
    `,
    [
      userId,
      windowDays,
      reminderFlags.reminder_30days !== false,
      reminderFlags.reminder_7days !== false,
      reminderFlags.reminder_1day !== false,
      reminderFlags.reminder_on_day !== false,
    ],
  );
  return rows;
}

/**
 * Send expiration reminders for all users, honoring per-user reminder
 * schedules and document status. Sends push and/or email based on preferences.
 */
async function runExpirationCheck() {
  info("ExpirationChecker", "Starting daily document expiration check");

  let totalUsers = 0;
  let totalDocumentsNotified = 0;
  let totalPushSent = 0;
  let totalPushFailed = 0;
  let totalEmailSent = 0;
  let totalEmailSkipped = 0;
  let totalEmailFailed = 0;

  try {
    await ensureEmailReminderTable();
    const users = await getUsersWithReminderSettings();

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (user) => {
          totalUsers++;

          if (user.expiry_alerts !== true) {
            debug("ExpirationChecker", "Skipping user - expiry alerts disabled", {
              userId: user.id,
            });
            return;
          }

          const pushToken = user.expo_push_token || user.fcm_token;
          const canSendPush = user.notifications_enabled === true && !!pushToken;
          const canSendEmail =
            user.email_alerts === true &&
            typeof user.email === "string" &&
            user.email.includes("@");

          if (!canSendPush && !canSendEmail) {
            debug("ExpirationChecker", "Skipping user - no enabled delivery channel", {
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
              push: canSendPush,
              email: canSendEmail,
            });

            for (const doc of docs) {
              const diffDays = Number(doc.days_until_expiry) || 0;
              const title = doc.title || "Untitled Document";
              const expiryDateStr = formatExpiryDate(doc.expiry_date);
              const bucket = getReminderBucket(diffDays, reminderFlags);

              if (canSendPush) {
                try {
                  const result = await sendExpirationReminder(pushToken, title, diffDays);
                  if (result?.success) {
                    totalPushSent++;
                  } else {
                    totalPushFailed++;
                    warn("ExpirationChecker", "Push notification failed", {
                      userId: user.id,
                      documentId: doc.id,
                      error: result?.error,
                    });
                  }
                } catch (err) {
                  totalPushFailed++;
                  warn("ExpirationChecker", "Push notification error", {
                    userId: user.id,
                    documentId: doc.id,
                    error: err.message,
                  });
                }
              }

              if (canSendEmail && bucket) {
                try {
                  const alreadySent = await wasEmailReminderSent(
                    user.id,
                    doc.id,
                    bucket,
                    expiryDateStr,
                  );
                  if (alreadySent) {
                    totalEmailSkipped++;
                  } else {
                    await sendExpirationReminderEmail(
                      user.email,
                      user.name,
                      title,
                      diffDays,
                      expiryDateStr,
                    );
                    await markEmailReminderSent(user.id, doc.id, bucket, expiryDateStr);
                    totalEmailSent++;
                  }
                } catch (err) {
                  totalEmailFailed++;
                  warn("ExpirationChecker", "Email reminder failed", {
                    userId: user.id,
                    documentId: doc.id,
                    error: err.message,
                  });
                }
              }

              totalDocumentsNotified++;
            }
          } catch (err) {
            warn("ExpirationChecker", "Failed to process expiring documents for user", {
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
      pushSent: totalPushSent,
      pushFailed: totalPushFailed,
      emailSent: totalEmailSent,
      emailSkipped: totalEmailSkipped,
      emailFailed: totalEmailFailed,
    });
  } catch (err) {
    warn("ExpirationChecker", "Expiration check failed", {
      error: err.message,
    });
  }
}

// Schedule: Runs every day at 8:00 AM
let expirationTask = null;
if (process.env.NODE_ENV !== "test") {
  expirationTask = cron.schedule("0 8 * * *", runExpirationCheck);
}

console.log("Expiration checker cron job registered (push + email).");

module.exports = {
  runExpirationCheck,
  EXPIRING_WINDOW_DAYS: DEFAULT_WINDOW_DAYS,
  getUsersWithReminderSettings,
  getExpiringDocumentsForUser,
  getReminderBucket,
  formatExpiryDate,
  ensureEmailReminderTable,
  wasEmailReminderSent,
  markEmailReminderSent,
  stop: () => expirationTask?.stop(),
};
