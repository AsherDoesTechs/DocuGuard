const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const reminderController = require("../controllers/reminderController");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.use(authMiddleware);

router.get("/", asyncHandler(reminderController.getReminders));
router.patch("/preferences", asyncHandler(reminderController.updateNotificationPrefs));

module.exports = router;