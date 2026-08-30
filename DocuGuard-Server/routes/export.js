const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { exportUserData } = require("../services/supabaseSync");

router.post("/export", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const exportData = await exportUserData(userId);

    res.json({
      status: "success",
      message: "Data exported to Supabase cloud successfully.",
      exportData,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      errorCode: "EXPORT_FAILED",
      error: error.message,
    });
  }
});

module.exports = router;
