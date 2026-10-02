const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { ErrorCodes } = require("../utils/errorCodes");

/**
 * Rate limit keying.
 *
 * Behind Render (or any reverse proxy) every request otherwise arrives with the
 * proxy's IP, so per-IP limiting puts all users in one shared bucket.
 *
 * The global limiter is mounted before the routes, which means the `auth`
 * middleware has not run yet and `req.user` is always undefined here. Keying on
 * `req.user` alone therefore degenerated to pure per-IP limiting, and a single
 * office or carrier NAT exhausted the budget for everyone behind it. So the
 * token is verified locally instead: the result is only used as a bucket key,
 * never for an authorization decision, so it does not change the auth boundary.
 */
function keyGenerator(req) {
  if (req.user && req.user.userId) {
    return `u:${req.user.userId}`;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(
        authHeader.slice(7).trim(),
        process.env.JWT_SECRET,
      );
      if (decoded && decoded.userId) {
        return `u:${decoded.userId}`;
      }
    } catch {
      // Invalid or expired token: fall through to the IP bucket. The route's
      // own auth middleware will reject the request regardless.
    }
  }

  return `ip:${req.ip}`;
}

// 1. General API Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Per authenticated user (or per IP when anonymous)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: {
    status: "fail",
    code: ErrorCodes.RATE_LIMIT_EXCEEDED,
    error: "Too many requests, please try again shortly.",
  },
});

// 2. Strict Limiter for Auth Routes (Login/Register) to prevent brute-force
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 login/register attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip}`,
  message: {
    status: "fail",
    code: ErrorCodes.AUTH_RATE_LIMIT_EXCEEDED,
    error: "Too many authentication attempts, please try again later.",
  },
});

// 3. Upload URLs mint storage credentials, so they get their own tighter budget.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  message: {
    status: "fail",
    code: ErrorCodes.DOC_UPLOAD_FAILED,
    error: "Too many upload requests, please try again later.",
  },
});

/**
 * Allow-list based CORS. The default `cors()` reflects any origin, which on a
 * Bearer-authenticated document API is not a meaningful boundary.
 */
function corsOptions() {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      // Native apps send no Origin header; there is nothing to reject.
      if (!origin) {
        return callback(null, true);
      }

      if (configured.length === 0) {
        // Fail closed in production rather than silently allowing every origin.
        if (process.env.NODE_ENV === "production") {
          return callback(
            new Error("CORS_ALLOWED_ORIGINS must be configured in production"),
          );
        }
        return callback(null, true);
      }

      if (configured.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: false,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  };
}

module.exports = {
  helmet,
  apiLimiter,
  authLimiter,
  uploadLimiter,
  corsOptions,
};
