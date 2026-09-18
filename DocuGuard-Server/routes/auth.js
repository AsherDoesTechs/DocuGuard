const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

// Wrapper to catch async errors and pass to next()
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Public Auth Endpoints
router.post("/register", asyncHandler(authController.register));
router.post("/login", asyncHandler(authController.login));
router.get("/check-email", asyncHandler(authController.checkEmail));
router.post("/verify-email", asyncHandler(authController.verifyEmail));
router.post("/resend-verification", asyncHandler(authController.resendVerification));
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/reset-password", asyncHandler(authController.resetPassword));

// Protected Auth Endpoints
router.put("/fcm-token", authMiddleware, asyncHandler(authController.updateFcmToken));

module.exports = router;