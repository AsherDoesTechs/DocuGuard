const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const profileController = require("../controllers/profileController");

router.use(authMiddleware);

router.get("/", profileController.getProfile);
router.patch("/security", profileController.updateSecurity);
router.patch("/preferences", profileController.updatePreferences);
router.post("/support", profileController.submitSupportTicket);
router.post("/subscription", profileController.handleCheckoutSubscription);

module.exports = router;
