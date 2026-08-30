// routes/subscription.js
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth"); // Your JWT auth middleware
const pool = require("../db"); // Your pg pool connection

router.post("/subscription", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { name, serial, card, expiry } = req.body;

  try {
    // 1. Update or Insert Subscription Record (Upgrading plan example)
    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1); // 1 year renewal

    const subscriptionQuery = `
      INSERT INTO subscriptions (user_id, plan_name, renewal_date, storage_used, storage_total, updated_at)
      VALUES ($1, 'pro', $2, 0.00, 50.00, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        plan_name = 'pro',
        renewal_date = $2,
        storage_total = 50.00,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    await pool.query(subscriptionQuery, [userId, renewalDate]);

    // 2. Insert into Activity Logs
    const logQuery = `
      INSERT INTO activity_logs (user_id, action, details)
      VALUES ($1, 'SUBSCRIPTION_UPGRADED', $2)
    `;
    await pool.query(logQuery, [
      userId,
      `Upgraded plan via checkout. Serial: ${serial}`,
    ]);

    res
      .status(200)
      .json({ success: true, message: "Subscription updated successfully" });
  } catch (error) {
    console.error("Checkout backend error:", error);
    res.status(500).json({ error: "Internal server error during checkout" });
  }
});

module.exports = router;
