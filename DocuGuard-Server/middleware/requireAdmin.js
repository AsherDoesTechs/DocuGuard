"use strict";

const db = require("../config/db");
const { ErrorCodes } = require("../utils/errorCodes");

/**
 * Must run after authMiddleware.
 * Checks the current database role instead of trusting the JWT role claim.
 * Fails closed if the database cannot verify authorization.
 */
module.exports = async function requireAdmin(req, res, next) {
  const userId = req.user?.userId;

  if (
    userId === undefined ||
    userId === null ||
    !Number.isSafeInteger(Number(userId)) ||
    Number(userId) <= 0
  ) {
    return res.status(401).json({
      error: "Authentication required.",
      code: ErrorCodes.AUTH_REQUIRED,
    });
  }

  try {
    const result = await db.query(
      "SELECT role FROM public.users WHERE id = $1 LIMIT 1",
      [Number(userId)],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Authentication required.",
        code: ErrorCodes.AUTH_REQUIRED,
      });
    }

    if (result.rows[0].role !== "admin") {
      return res.status(403).json({
        error: "Administrator access required.",
        code: "ADMIN_ACCESS_REQUIRED",
      });
    }

    return next();
  } catch (err) {
    // Log no credentials or database connection details in the response.
    console.error("Admin authorization verification failed.");

    return res.status(503).json({
      error: "Administrator authorization is temporarily unavailable.",
      code: "ADMIN_AUTH_UNAVAILABLE",
    });
  }
};
