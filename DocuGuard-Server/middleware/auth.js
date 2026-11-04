"use strict";

const jwt = require("jsonwebtoken");
const { ErrorCodes } = require("../utils/errorCodes");
const { debug, warn, error: logError } = require("../utils/debugLogger");
const { isSessionActive } = require("../services/sessionService");
const {
  isAdminDeviceActive,
} = require("../services/adminDeviceSessionService");

function rejectInvalidSession(res) {
  return res.status(401).json({
    error:
      "Session is invalid, expired, or has been revoked. Please sign in again.",
    code: ErrorCodes.AUTH_TOKEN_INVALID,
  });
}

function rejectUnavailable(res) {
  return res.status(503).json({
    error:
      "Authentication verification is temporarily unavailable. Please try again.",
    code: "AUTH_SESSION_UNAVAILABLE",
  });
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    debug(
      "Auth",
      "Auth middleware - no token provided",
      { path: req.path, method: req.method },
      ErrorCodes.AUTH_REQUIRED,
    );

    return res.status(401).json({
      error: "Access denied. No token provided.",
      code: ErrorCodes.AUTH_REQUIRED,
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({
      error: "Access denied. No token provided.",
      code: ErrorCodes.AUTH_REQUIRED,
    });
  }

  let decoded;

  // Verify the JWT before attempting any database lookup.
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.userId === undefined || decoded.userId === null) {
      return rejectInvalidSession(res);
    }
  } catch (err) {
    logError(
      "Auth",
      "Auth middleware - invalid token",
      {
        error: err.message,
        path: req.path,
        method: req.method,
      },
      ErrorCodes.AUTH_TOKEN_EXPIRED,
    );

    return res.status(401).json({
      error: "Invalid or expired token.",
      code: ErrorCodes.AUTH_TOKEN_EXPIRED,
    });
  }

  try {
    let active;

    if (decoded.deviceId !== undefined && decoded.deviceId !== null) {
      // Device-bound tokens must explicitly be administrator tokens.
      if (decoded.role !== "admin") {
        return rejectInvalidSession(res);
      }

      active = await isAdminDeviceActive({
        userId: decoded.userId,
        deviceId: decoded.deviceId,
      });
    } else {
      // Includes regular mobile sessions and non-device-bound admin tokens.
      // A role claim alone never bypasses session validation.
      active = await isSessionActive({
        userId: decoded.userId,
        token,
      });
    }

    if (!active) {
      warn("Auth", "Auth middleware - inactive session", {
        userId: decoded.userId,
        path: req.path,
        method: req.method,
      });

      return rejectInvalidSession(res);
    }

    req.user = decoded;

    debug("Auth", "Auth middleware - token and session verified", {
      userId: decoded.userId,
      path: req.path,
    });

    return next();
  } catch (err) {
    // Do not expose database errors or credentials in the response.
    logError("Auth", "Auth middleware - session verification unavailable", {
      path: req.path,
      method: req.method,
    });

    return rejectUnavailable(res);
  }
}

module.exports = authMiddleware;
