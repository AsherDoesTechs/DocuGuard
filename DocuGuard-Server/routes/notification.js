const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/auth");

router.post("/push-token", authMiddleware, async (req, res) => {
  try {
    const { pushToken } = req.body;
    const userId = req.user.userId;

    if (!pushToken) {
      return res.status(400).json({
        status: "fail",
        errorCode: "PUSH_TOKEN_MISSING",
        error: "Push token is required.",
      });
    }

    const query = `UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, fcm_token`;
    const result = await db.query(query, [pushToken, userId]);

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
  } catch (error) {
    res.status(500).json({
      status: "error",
      errorCode: "INTERNAL_SERVER_ERROR",
      error: error.message,
    });
  }
});

module.exports = router;
