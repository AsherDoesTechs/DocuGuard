const fs = require("fs");
const path = require("path");

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || "info"];

function formatLog(level, category, message, details, code) {
  const timestamp = new Date().toISOString();
  const codeStr = code ? ` (#${code})` : "";
  const detailsStr = details ? JSON.stringify(details, null, 2) : "";
  return `[${timestamp}] ${level.toUpperCase()} [${category}]${codeStr}: ${message}${detailsStr ? "\n" + detailsStr : ""}`;
}

function log(level, category, message, details, code) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const formatted = formatLog(level, category, message, details, code);
  const prefix = process.env.NODE_ENV === "production" ? "[DocuGuard] " : "";

  if (level === "error") {
    console.error(prefix + formatted);
  } else if (level === "warn") {
    console.warn(prefix + formatted);
  } else {
    console.log(prefix + formatted);
  }

  if (process.env.DEBUG_LOG_FILE) {
    try {
      const logDir = path.dirname(process.env.DEBUG_LOG_FILE);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(process.env.DEBUG_LOG_FILE, formatted + "\n");
    } catch (e) {
      // Silently fail log file writes
    }
  }
}

module.exports = {
  debug: (category, message, details, code) => log("debug", category, message, details, code),
  info: (category, message, details, code) => log("info", category, message, details, code),
  warn: (category, message, details, code) => log("warn", category, message, details, code),
  error: (category, message, details, code) => log("error", category, message, details, code),
  LOG_LEVELS,
};
