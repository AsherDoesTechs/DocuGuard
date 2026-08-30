const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const authMiddleware = require("../middleware/auth"); // Assuming you have a JWT verification middleware

// Protected dashboard route
router.get("/", authMiddleware, dashboardController.getDashboardData);

module.exports = router;
