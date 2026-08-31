const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const docRoutes = require("./routes/documents");
const dashboardRoutes = require("./routes/dashboard");
const reminderRoutes = require("./routes/reminder");
const profileRoutes = require("./routes/profile");
const notificationRoutes = require("./routes/notification");
const exportRoutes = require("./routes/export");

// Security & Error Middlewares
const { helmet, apiLimiter, authLimiter } = require("./middleware/security");
const { errorHandler } = require("./utils/errors");

// Import background cron job
require("./jobs/expirationChecker");

const app = express();

// 1. Core Security & Parsing Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// 2. Rate Limiters
app.use("/api/", apiLimiter);
app.use("/auth/login", authLimiter);
app.use("/auth/register", authLimiter);

// 3. API Routes
app.use("/auth", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/documents", docRoutes);
app.use("/reminders", reminderRoutes);
app.use("/profile", profileRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/export", exportRoutes);

// 4. Centralized Error Handler (Must be registered LAST after all routes)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
