const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { z } = require("zod");
const { validateSchema, ErrorCodes } = require("../utils/errors");

const pushTokenSchema = z.object({
  expoPushToken: z.string().optional(),
  devicePushToken: z.string().optional(),
}).refine((data) => data.expoPushToken || data.devicePushToken, {
  message: "At least one push token is required",
  path: ["expoPushToken"],
});

router.post("/push-token", authMiddleware, asyncHandler(async (req, res) => {
  const validation = validateSchema(pushTokenSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      status: "fail",
      errorCode: "PUSH_TOKEN_MISSING",
      error: Object.values(validation.errors).join(", "),
      details: validation.errors,
    });
  }

  const { expoPushToken, devicePushToken } = validation.data;
  const userId = req.user.userId;

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
  const result = await db.query(query, values);

  if (result.rows.length === 0) {
    return res.status(404).json({
      status: "fail",
      errorCode: "USER_NOT_FOUND",
      error: "User not found.",
    });
  }

  res.status(200).json({
    status: "success",
    message: "Push token registered successfully.",
    user: result.rows[0],
  });
}));

module.exports = router;