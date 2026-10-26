const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { z } = require("zod");
// validateSchema lives in the shared validation module, not utils/errors.js.
// Importing it from utils/errors yielded undefined and made every call throw.
const { validateSchema } = require("../../shared/validation/schemas");
const { ErrorCodes } = require("../utils/errorCodes");

const pushTokenSchema = z
  .object({
    expoPushToken: z.string().optional(),
    devicePushToken: z.string().optional(),
  })
  .refine((data) => data.expoPushToken || data.devicePushToken, {
    message: "At least one push token is required",
    path: ["expoPushToken"],
  });

router.post(
  "/push-token",
  authMiddleware,
  asyncHandler(async (req, res) => {
    console.info("[Notifications] Push-token registration request received", {
      userId: req.user?.userId ?? null,
      hasExpoToken:
        typeof req.body?.expoPushToken === "string" &&
        req.body.expoPushToken.length > 0,
      hasDevicePushToken:
        typeof req.body?.devicePushToken === "string" &&
        req.body.devicePushToken.length > 0,
    });
    const validation = validateSchema(pushTokenSchema, req.body);
    if (!validation.success) {
      return res.status(400).json({
        status: "fail",
        code: ErrorCodes.NOTIF_TOKEN_MISSING,
        error: Object.values(validation.errors).join(", "),
        details: validation.errors,
      });
    }

    const { expoPushToken, devicePushToken } = validation.data;
    const userId = req.user.userId;
    const tokenValues = [expoPushToken, devicePushToken].filter(Boolean);

    const result = await db.withTransaction(async (client) => {
      /*
       * A device token belongs to exactly one account at a time.
       *
       * The token is a property of the device, not of the account. It was only
       * ever attached to the account that registered it, so a sign-out that
       * could not reach the server (an offline sign-out, a failed request) left
       * the token on the first account. The next account that signed in on the
       * same device registered the same token, and from then on the daily job
       * pushed the first account's document titles and expiry dates to a device
       * that was signed in as somebody else.
       *
       * Registering the token therefore detaches it from every other account.
       * The token is not revoked and no authorization is widened: the row of the
       * account that is signing in is the only one that keeps it.
       */
      for (const value of tokenValues) {
        await client.query(
          `UPDATE users SET expo_push_token = NULL, fcm_token = NULL
         WHERE id <> $1 AND (expo_push_token = $2 OR fcm_token = $2)`,
          [userId, value],
        );
      }

      const updates = [];
      const values = [];
      let paramCount = 1;

      if (expoPushToken) {
        updates.push(`expo_push_token = $${paramCount++}`);
        values.push(expoPushToken);
      }

      if (devicePushToken) {
        updates.push(`fcm_token = $${paramCount++}`);
        values.push(devicePushToken);
      }

      updates.push(`updated_at = NOW()`);
      values.push(userId);

      const query = `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramCount} RETURNING id, email, expo_push_token, fcm_token`;

      return client.query(query, values);
    });

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "fail",
        code: ErrorCodes.AUTH_USER_NOT_FOUND,
        error: "User not found.",
      });
    }

    console.info("[Notifications] Push-token registration succeeded", {
      userId,
      expoTokenRegistered: Boolean(expoPushToken),
      fcmTokenRegistered: Boolean(devicePushToken),
    });

    res.status(200).json({
      status: "success",
      message: "Push token registered successfully.",
      user: result.rows[0],
    });
  }),
);

/*
 * Removes the push token of the signed-in account.
 *
 * The token is stored on the user row. Without this endpoint the token stayed
 * there after a sign-out, and the expiry job kept pushing that account's
 * document titles and expiry dates to the device - which, after another
 * account signed in, belonged to somebody else.
 *
 * The token is also detached from every other account. A token that is
 * attached to two accounts at once is the cross-account leak this endpoint
 * exists to prevent, and an older client could have left it that way.
 */
router.delete(
  "/push-token",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    await db.withTransaction(async (client) => {
      const owned = await client.query(
        `SELECT expo_push_token, fcm_token FROM users WHERE id = $1`,
        [userId],
      );

      const values = owned.rows[0]
        ? [owned.rows[0].expo_push_token, owned.rows[0].fcm_token].filter(
            Boolean,
          )
        : [];

      await client.query(
        `UPDATE users SET expo_push_token = NULL, fcm_token = NULL WHERE id = $1`,
        [userId],
      );

      for (const value of values) {
        await client.query(
          `UPDATE users SET expo_push_token = NULL, fcm_token = NULL
         WHERE id <> $1 AND (expo_push_token = $2 OR fcm_token = $2)`,
          [userId, value],
        );
      }
    });

    res.status(200).json({
      status: "success",
      message: "Push token removed.",
    });
  }),
);

module.exports = router;
