const jwt = require("jsonwebtoken");
const { ErrorCodes } = require("../utils/errorCodes");
const { debug, warn, error: logError } = require("../utils/debugLogger");

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    debug("Auth", "Auth middleware - no token provided", {
      path: req.path,
      method: req.method,
    }, ErrorCodes.AUTH_REQUIRED);
    return res.status(401).json({
      error: "Access denied. No token provided.",
      code: ErrorCodes.AUTH_REQUIRED,
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    debug("Auth", "Auth middleware - token verified", {
      userId: decoded.userId,
      path: req.path,
    });
    next();
  } catch (err) {
    logError("Auth", "Auth middleware - invalid token", {
      error: err.message,
      path: req.path,
      method: req.method,
    }, ErrorCodes.AUTH_TOKEN_EXPIRED);
    return res.status(401).json({
      error: "Invalid or expired token.",
      code: ErrorCodes.AUTH_TOKEN_EXPIRED,
    });
  }
};

module.exports = authMiddleware;
