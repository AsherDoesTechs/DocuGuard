const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { exportUserData } = require("../services/supabaseSync");
const { asyncHandler } = require("../utils/asyncHandler");

router.post("/export", authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const exportData = await exportUserData(userId);

  res.json({
    status: "success",
    message: "Data exported to Supabase cloud successfully.",
    exportData,
  });
}));

module.exports = router;