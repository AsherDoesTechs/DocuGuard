const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/auth");
const db = require("../config/db");
const { asyncHandler } = require("../utils/asyncHandler");
const { ErrorCodes } = require("../utils/errorCodes");

router.post(
  "/subscription",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { name, serial, card, expiry } = req.body;

    if (!name || !serial || !card || !expiry) {
      return res.status(400).json({
        error: "All checkout and verification fields are required.",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);

    const subscriptionQuery = `
      INSERT INTO subscriptions 
        (user_id, plan_name, renewal_date, storage_used, storage_total, updated_at)
      VALUES ($1, 'pro', $2, 0.00, 50.00, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET
        plan_name = 'pro',
        renewal_date = $2,
        storage_total = 50.00,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    await db.query(subscriptionQuery, [userId, renewalDate]);

    const logQuery = `
      INSERT INTO activity_logs (user_id, action, details)
      VALUES ($1, 'SUBSCRIPTION_UPGRADED', $2)
    `;

    await db.query(logQuery, [
      userId,
      `Upgraded plan via checkout. Serial: ${serial}`,
    ]);

    res.status(200).json({
      success: true,
      message: "Subscription upgraded successfully",
    });
  }),
);

module.exports = router;
