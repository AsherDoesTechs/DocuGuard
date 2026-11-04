const express = require("express");
const router = express.Router();
const searchController = require("../controllers/searchController");
const authMiddleware = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

router.use(authMiddleware);

router.get("/", asyncHandler(searchController.searchDocuments));

module.exports = router;
