"use strict";

const { logAuthenticated, EVENT_TYPE } = require("../services/auditService");
const { debug } = require("../utils/debugLogger");

/**
 * Express middleware that logs the request outcome after the route handler
 * completes. It captures the response status code and classifies it as
 * success/failure/blocked for audit purposes.
 *
 * Placed after authMiddleware so req.user is available. Does not modify the
 * request or response.
 */
function auditMiddleware(req, res, next) {
  const originalSend = res.send;

  res.send = function (body) {
    try {
      const status = res.statusCode;
      let outcome = "success";

      if (status >= 400 && status < 500) {
        outcome = status === 401 || status === 403 ? "blocked" : "failure";
      } else if (status >= 500) {
        outcome = "failure";
      }

      // Infer event type from the request path and method.
      const eventType = eventTypeFor(req.method, req.path);

      if (eventType) {
        void logAuthenticated({
          req,
          userId: req.user && req.user.userId,
          eventType,
          outcome,
          resource: resourceFor(req.path),
          details: { method: req.method, path: req.path, statusCode: status },
        });
      }
    } catch (error) {
      debug("Audit", "Audit middleware wrapping failed", {
        error: error.message,
      });
    }

    return originalSend.call(this, body);
  };

  next();
}

function eventTypeFor(method, path) {
  const segments = path.split("/").filter(Boolean);
  const first = segments[0];

  // Auth events
  if (first === "auth") {
    const second = segments[1];
    if (method === "POST") {
      if (second === "login") return EVENT_TYPE.LOGIN_SUCCESS;
      if (second === "register") return EVENT_TYPE.REGISTER;
      if (second === "forgot-password") return EVENT_TYPE.PASSWORD_RESET_REQUEST;
      if (second === "reset-password") return EVENT_TYPE.PASSWORD_RESET_SUCCESS;
      if (second === "verify-email") return EVENT_TYPE.EMAIL_VERIFY;
      if (second === "resend-verification") return EVENT_TYPE.EMAIL_VERIFY;
    }
    if (method === "PUT" && second === "fcm-token") {
      return EVENT_TYPE.TOKEN_REFRESH;
    }
  }

  // Document events
  if (first === "documents") {
    if (method === "POST" && segments.length === 1) return EVENT_TYPE.DOC_CREATE;
    if (method === "GET" && segments.length === 2) return EVENT_TYPE.DOC_READ;
    if (method === "PUT" && segments.length === 2) return EVENT_TYPE.DOC_UPDATE;
    if (method === "DELETE" && segments.length === 2) return EVENT_TYPE.DOC_DELETE;
    if (method === "POST" && segments.includes("process")) return EVENT_TYPE.DOC_OCR;
    if (method === "POST" && segments.includes("verify")) return EVENT_TYPE.DOC_VERIFY;
    if (method === "POST" && segments.includes("sync")) return EVENT_TYPE.DOC_SYNC;
  }

  // Profile events
  if (first === "profile") {
    const second = segments[1];
    if (method === "PATCH" && second === "security") {
      return EVENT_TYPE.PROFILE_UPDATE;
    }
    if (method === "PATCH" && second === "preferences") {
      return EVENT_TYPE.PREFERENCES_UPDATE;
    }
    if (method === "POST" && second === "security/2fa/setup") {
      return EVENT_TYPE.TWO_FA_SETUP;
    }
    if (method === "POST" && second === "security/2fa/verify") {
      return EVENT_TYPE.TWO_FA_ENABLE;
    }
    if (method === "PATCH" && second === "privacy") {
      return EVENT_TYPE.PREFERENCES_UPDATE;
    }
    if (method === "DELETE" && second === "") {
      return EVENT_TYPE.ACCOUNT_DELETE;
    }
    if (method === "GET" && second === "export") {
      return EVENT_TYPE.DATA_EXPORT_REQUEST;
    }
    if (method === "DELETE" && segments.includes("sessions")) {
      return segments.length > 2
        ? EVENT_TYPE.SESSION_TERMINATE
        : EVENT_TYPE.SESSION_TERMINATE_ALL;
    }
  }

  // Subscription events
  if (first === "subscription") {
    return EVENT_TYPE.PROFILE_UPDATE;
  }

  return null;
}

function resourceFor(path) {
  const segments = path.split("/").filter(Boolean);
  const first = segments[0];

  if (first === "documents" && segments.length >= 2) {
    return { type: "document", id: segments[1] };
  }

  if (first === "profile" && segments.includes("sessions")) {
    return { type: "session", id: segments[segments.length - 1] };
  }

  return { type: first };
}

module.exports = auditMiddleware;
