const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// 1. General API Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    errorCode: "RATE_LIMIT_EXCEEDED",
    error: "Too many requests from this IP, please try again after 15 minutes",
  },
});

// 2. Strict Limiter for Auth Routes (Login/Register) to prevent brute-force
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 login/register attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    errorCode: "AUTH_RATE_LIMIT_EXCEEDED",
    error: "Too many authentication attempts, please try again later.",
  },
});

module.exports = { helmet, apiLimiter, authLimiter };
