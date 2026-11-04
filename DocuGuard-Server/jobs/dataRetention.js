"use strict";

const cron = require("node-cron");
const db = require("../config/db");
const { debug, info, warn } = require("../utils/debugLogger");

/**
 * Data retention cleanup job.
 *
 * Removes:
 *   - Documents soft-deleted (status='deleted') older than the user's
 *     deleted_documents_ttl_days.
 *   - Expired documents (expiry_date in the past, status not 'deleted')
 *     older than the user's expired_documents_ttl_days.
 *
 * Audit log entries are NOT purged by this job. The audit_log table has
 * DELETE revoked from the application role (ISO/IEC 27001 A.12.4 /
 * A.16.1 immutability). Audit log retention is an operational concern
 * performed by a separate administrative process with explicit DELETE
 * privileges.
 *
 * Runs per user so each user's retention settings are honoured.
 * Bounded concurrency per user to avoid overwhelming the database.
 */

const CONCURRENCY = 5;

/**
 * Fetch all users with retention settings (or defaults).
 */
async function getUsersWithRetention() {
  const { rows } = await db.query(`
    SELECT u.id, u.email,
           COALESCE(r.expired_documents_ttl_days, 90) AS expired_ttl_days,
           COALESCE(r.deleted_documents_ttl_days, 30) AS deleted_ttl_days
    FROM users u
    LEFT JOIN data_retention r ON r.user_id = u.id
  `);
  return rows;
}

/**
 * Delete documents for one user that are past their retention TTL.
 */
async function purgeUserDocuments(userId, deletedTtlDays, expiredTtlDays) {
  const now = new Date().toISOString();

  // Soft-deleted documents past their TTL.
  const deletedResult = await db.query(
    `
    DELETE FROM documents
    WHERE user_id = $1
      AND status = 'deleted'
      AND deleted_at IS NOT NULL
      AND deleted_at < ($2::timestamptz - ($3 || ' days')::interval)
    RETURNING id
    `,
    [userId, now, deletedTtlDays],
  );

  // Expired documents (expiry_date in the past) past their TTL.
  // A document is eligible when its expiry date is older than the TTL window.
  const expiredResult = await db.query(
    `
    DELETE FROM documents
    WHERE user_id = $1
      AND status <> 'deleted'
      AND expiry_date IS NOT NULL
      AND expiry_date != ''
      AND expiry_date < (CURRENT_DATE - ($2 || ' days')::interval)
    RETURNING id
    `,
    [userId, expiredTtlDays],
  );

  const purged =
    (deletedResult.rows.length || 0) + (expiredResult.rows.length || 0);

  if (purged > 0) {
    info("DataRetention", "Purged expired/deleted documents", {
      userId,
      purged,
      deleted: deletedResult.rows.length,
      expired: expiredResult.rows.length,
    });
  }

  return purged;
}

/**
 * Run the retention cleanup for all users.
 */
async function runRetentionCleanup() {
  info("DataRetention", "Starting data retention cleanup");

  let totalUsers = 0;
  let totalDocumentsPurged = 0;

  try {
    const users = await getUsersWithRetention();

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (user) => {
          totalUsers++;

          try {
            const docsPurged = await purgeUserDocuments(
              user.id,
              Number(user.deleted_ttl_days) || 30,
              Number(user.expired_ttl_days) || 90,
            );
            totalDocumentsPurged += docsPurged;
          } catch (err) {
            warn("DataRetention", `Cleanup failed for user ${user.id}`, {
              error: err.message,
            });
          }
        }),
      );
    }

    info("DataRetention", "Retention cleanup complete", {
      users: totalUsers,
      documentsPurged: totalDocumentsPurged,
    });
  } catch (err) {
    warn("DataRetention", "Retention cleanup failed", {
      error: err.message,
    });
  }
}

// Schedule: runs weekly on Sundays at 02:00.
let retentionTask = null;
if (process.env.NODE_ENV !== "test") {
  retentionTask = cron.schedule("0 2 * * 0", runRetentionCleanup);
}

console.log("Data retention cleanup job registered.");

module.exports = { runRetentionCleanup, stop: () => retentionTask?.stop() };
