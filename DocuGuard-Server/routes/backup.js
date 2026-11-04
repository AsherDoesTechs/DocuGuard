const express = require("express");
const router = express.Router();
const backupController = require("../controllers/backupController");
const authMiddleware = require("../middleware/auth");

router.use(authMiddleware);

router.get("/status", backupController.getBackupStatus);

module.exports = router;
