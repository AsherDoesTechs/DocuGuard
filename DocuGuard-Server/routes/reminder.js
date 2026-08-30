const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const reminderController = require("../controllers/reminderController");

router.use(authMiddleware);

router.get("/", reminderController.getReminders);
router.patch("/preferences", reminderController.updateNotificationPrefs);

module.exports = router;
