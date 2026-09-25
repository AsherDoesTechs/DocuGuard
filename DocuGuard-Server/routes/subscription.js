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

    const { plan, payment_method, billing_cycle } = req.body;

    /*
     * ---------------------------------------------------------
     * VALIDATION
     * ---------------------------------------------------------
     */

    if (plan !== "pro") {
      return res.status(400).json({
        error: "Only the Pro subscription is currently available.",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    if (payment_method !== "demo") {
      return res.status(400).json({
        error: "Invalid payment method.",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    if (billing_cycle !== "annual") {
      return res.status(400).json({
        error: "Invalid billing cycle.",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    /*
     * ---------------------------------------------------------
     * SUBSCRIPTION DATES
     * ---------------------------------------------------------
     */

    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);

    /*
     * ---------------------------------------------------------
     * DATABASE TRANSACTION
     *
     * Both subscription update and activity logging should
     * succeed together.
     * ---------------------------------------------------------
     */

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      /*
       * Activate / renew Pro subscription.
       */

      const subscriptionQuery = `
        INSERT INTO subscriptions
          (
            user_id,
            plan_name,
            renewal_date,
            storage_used,
            storage_total,
            updated_at
          )
        VALUES
          (
            $1,
            'pro',
            $2,
            0.00,
            50.00,
            CURRENT_TIMESTAMP
          )
        ON CONFLICT (user_id)
        DO UPDATE SET
          plan_name = 'pro',
          renewal_date = $2,
          storage_total = 50.00,
          updated_at = CURRENT_TIMESTAMP
        RETURNING
          id,
          user_id,
          plan_name,
          renewal_date,
          storage_used,
          storage_total,
          updated_at;
      `;

      const subscriptionResult = await client.query(subscriptionQuery, [
        userId,
        renewalDate,
      ]);

      /*
       * -------------------------------------------------------
       * ACTIVITY LOG
       * -------------------------------------------------------
       */

      const logQuery = `
        INSERT INTO activity_logs
          (
            user_id,
            action,
            details
          )
        VALUES
          (
            $1,
            'SUBSCRIPTION_UPGRADED',
            $2
          );
      `;

      await client.query(logQuery, [
        userId,
        "Upgraded to DocuGuard Pro using the capstone demo payment.",
      ]);

      await client.query("COMMIT");

      /*
       * -------------------------------------------------------
       * RESPONSE
       * -------------------------------------------------------
       */

      const subscription = subscriptionResult.rows[0];

      return res.status(200).json({
        success: true,
        message: "DocuGuard Pro activated successfully.",
        subscription: {
          plan: subscription.plan_name,
          renewal_date: subscription.renewal_date,
          storage_used: subscription.storage_used,
          storage_total: subscription.storage_total,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
