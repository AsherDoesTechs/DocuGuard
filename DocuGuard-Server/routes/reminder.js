const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const reminderController = require("../controllers/reminderController");
const { asyncHandler } = require("../utils/asyncHandler");

router.use(authMiddleware);

router.get("/", asyncHandler(reminderController.getReminders));
router.post("/", asyncHandler(reminderController.createReminder));
router.patch("/preferences", asyncHandler(reminderController.updateNotificationPrefs));

module.exports = router;