const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const profileController = require("../controllers/profileController");
const { asyncHandler } = require("../utils/asyncHandler");
const privacyConsentController = require("../controllers/privacyConsentController");

router.use(authMiddleware);
router.get(
  "/privacy-consent",
  asyncHandler(privacyConsentController.getPrivacyConsent),
);

router.post(
  "/privacy-consent",
  asyncHandler(privacyConsentController.acceptPrivacyConsent),
);

router.post(
  "/privacy-consent/withdraw",
  asyncHandler(privacyConsentController.withdrawPrivacyConsent),
);

router.get("/", asyncHandler(profileController.getProfile));
router.patch("/", asyncHandler(profileController.updateProfile));
router.patch("/security", asyncHandler(profileController.updateSecurity));
router.post("/security/2fa/setup", asyncHandler(profileController.setup2FA));
router.post("/security/2fa/verify", asyncHandler(profileController.verify2FA));
router.patch("/preferences", asyncHandler(profileController.updatePreferences));
router.post("/support", asyncHandler(profileController.submitSupportTicket));
router.post(
  "/subscription",
  asyncHandler(profileController.handleCheckoutSubscription),
);
router.get("/settings", asyncHandler(profileController.getUserSettings));
router.patch("/settings", asyncHandler(profileController.updateUserSettings));
router.get("/sessions", asyncHandler(profileController.getLoginSessions));
router.delete(
  "/sessions/:sessionId",
  asyncHandler(profileController.terminateSession),
);
router.delete(
  "/sessions",
  asyncHandler(profileController.terminateAllOtherSessions),
);
router.patch("/appearance", asyncHandler(profileController.updateAppearance));
router.patch("/privacy", asyncHandler(profileController.updatePrivacy));
router.get("/export", asyncHandler(profileController.exportUserData));
router.delete("/", asyncHandler(profileController.deleteAccount));

module.exports = router;
