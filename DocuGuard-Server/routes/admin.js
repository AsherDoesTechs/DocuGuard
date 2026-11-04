"use strict";

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const { asyncHandler } = require("../utils/asyncHandler");
const adminController = require("../controllers/adminController");

// All admin endpoints require a valid token and a database-confirmed admin role.
router.use(authMiddleware, requireAdmin);

// Existing route
router.get("/overview", asyncHandler(adminController.getOverview));

// New Admin Management Endpoints
router.get("/users", asyncHandler(adminController.getUsers));
router.patch(
  "/users/:id/status",
  asyncHandler(adminController.updateUserStatus),
);

router.get("/documents", asyncHandler(adminController.getDocuments));
router.get("/logs", asyncHandler(adminController.getLogs));
router.get("/health", asyncHandler(adminController.getSystemHealth));

module.exports = router;
