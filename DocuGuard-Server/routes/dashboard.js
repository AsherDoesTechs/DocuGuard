const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const authMiddleware = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

router.get("/", authMiddleware, asyncHandler(dashboardController.getDashboardData));

module.exports = router;