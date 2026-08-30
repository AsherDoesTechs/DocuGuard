const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

// Public Auth Endpoints
router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/check-email", authController.checkEmail);
router.post("/verify-email", authController.verifyEmail);
router.post("/resend-verification", authController.resendVerification);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Protected Auth Endpoints
router.put("/fcm-token", authMiddleware, authController.updateFcmToken);

module.exports = router;
