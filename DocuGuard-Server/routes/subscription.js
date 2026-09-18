const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/auth");
const db = require("../config/db");
const { asyncHandler } = require("../utils/asyncHandler");

console.log("=== SUBSCRIPTION ROUTE DEBUG ===");
console.log("authenticateToken type:", typeof authenticateToken);
console.log("asyncHandler type:", typeof asyncHandler);

const testHandler = asyncHandler(async (req, res) => {
  res.json({ ok: true });
});

console.log("testHandler type:", typeof testHandler);

router.post("/subscription", authenticateToken, testHandler);

module.exports = router;
