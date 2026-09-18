const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const profileController = require("../controllers/profileController");
const { asyncHandler } = require("../utils/asyncHandler");

router.use(authMiddleware);

router.get("/", asyncHandler(profileController.getProfile));
router.patch("/security", asyncHandler(profileController.updateSecurity));
router.patch("/preferences", asyncHandler(profileController.updatePreferences));
router.post("/support", asyncHandler(profileController.submitSupportTicket));
router.post("/subscription", asyncHandler(profileController.handleCheckoutSubscription));

module.exports = router;