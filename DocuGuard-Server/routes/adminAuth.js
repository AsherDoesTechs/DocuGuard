"use strict";

const express = require("express");
const router = express.Router();

const adminAuthController = require("../controllers/adminAuthController");
const adminDeviceEnrollmentController = require("../controllers/adminDeviceEnrollmentController");
const {
  adminLoginLimiter,
  adminChallengeLimiter,
  adminDeviceProofLimiter,
  adminEnrollmentLimiter,
} = require("../middleware/security");
const { asyncHandler } = require("../utils/asyncHandler");

// Dedicated administrator authentication flow.
// This router is intentionally separate from the existing mobile auth routes.
router.post(
  "/login",
  adminLoginLimiter,
  asyncHandler(adminAuthController.adminLogin),
);

router.post(
  "/challenge",
  adminChallengeLimiter,
  asyncHandler(adminAuthController.createChallenge),
);

router.post(
  "/verify-device",
  adminDeviceProofLimiter,
  asyncHandler(adminAuthController.verifyDevice),
);

// Enrollment requires a valid, one-time grant issued through a controlled
// provisioning process. This route does not issue grants.
router.post(
  "/enroll-device",
  adminEnrollmentLimiter,
  asyncHandler(adminDeviceEnrollmentController.enrollDevice),
);

module.exports = router;
