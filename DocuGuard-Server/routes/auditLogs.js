const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const auditLogController = require("../controllers/auditLogController");
const { asyncHandler } = require("../utils/asyncHandler");

router.use(authMiddleware);
router.get("/", asyncHandler(auditLogController.getAuditLogs));
router.post("/", asyncHandler(auditLogController.createAuditLog));

module.exports = router;
