const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const docRoutes = require("./routes/documents");
const dashboardRoutes = require("./routes/dashboard");
const reminderRoutes = require("./routes/reminder");
const profileRoutes = require("./routes/profile");
const notificationRoutes = require("./routes/notification");
const exportRoutes = require("./routes/export");
const subscriptionRoutes = require("./routes/subscription");

// Security & Error Middlewares
const {
  helmet,
  apiLimiter,
  authLimiter,
  uploadLimiter,
  corsOptions,
} = require("./middleware/security");
const { errorHandler } = require("./utils/errors");
const { ErrorCodes } = require("./utils/errorCodes");
const { assertEnvOrExit } = require("./config/env");

// Import background cron job
require("./jobs/expirationChecker");

assertEnvOrExit();

const app = express();

// Behind a reverse proxy (Render) req.ip is otherwise the proxy's address,
// which collapses every user into a single rate-limit bucket.
app.set("trust proxy", 1);

// 1. Core Security & Parsing Middlewares
app.use(helmet());
app.use(cors(corsOptions()));
app.use(express.json({ limit: "1mb" }));

// 2. Rate Limiters
// The previous `app.use("/api/", apiLimiter)` only matched the two routes
// mounted under /api, leaving documents, profile, reminders and dashboard
// completely unthrottled.
app.use("/auth/login", authLimiter);
app.use("/auth/register", authLimiter);
app.use("/auth/forgot-password", authLimiter);
app.use("/auth/reset-password", authLimiter);
app.use("/auth/verify-email", authLimiter);
app.use("/auth/resend-verification", authLimiter);
app.use("/documents/upload-url", uploadLimiter);
app.use(apiLimiter);

// 3. Health Check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 4. API Routes
app.use("/auth", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/documents", docRoutes);
app.use("/reminders", reminderRoutes);
app.use("/profile", profileRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/export", exportRoutes);
app.use("/subscription", subscriptionRoutes);

// 5. Unmatched paths should be JSON, not Express's default HTML 404.
app.use((req, res) => {
  res.status(404).json({
    status: "fail",
    code: ErrorCodes.GENERIC_ERROR,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// 6. Centralized Error Handler (Must be registered LAST after all routes)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
