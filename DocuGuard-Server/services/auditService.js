"use strict";

const db = require("../config/db");

/**
 * Security-relevant event categories (ISO/IEC 27001 A.12.4 / A.16).
 */
const EVENT_CATEGORY = Object.freeze({
  AUTHENTICATION: "authentication",
  AUTHORIZATION: "authorization",
  DATA_ACCESS: "data_access",
  DATA_MODIFICATION: "data_modification",
  DATA_DELETION: "data_deletion",
  DATA_EXPORT: "data_export",
  SECURITY: "security",
  SYSTEM: "system",
});

/**
 * Event types mapped to categories.
 */
const EVENT_TYPE = Object.freeze({
  LOGIN_SUCCESS: "login_success",
  LOGIN_FAILURE: "login_failure",
  LOGIN_2FA_REQUIRED: "login_2fa_required",
  LOGIN_2FA_SUCCESS: "login_2fa_success",
  LOGIN_2FA_FAILURE: "login_2fa_failure",
  LOGOUT: "logout",
  REGISTER: "register",
  PASSWORD_RESET_REQUEST: "password_reset_request",
  PASSWORD_RESET_SUCCESS: "password_reset_success",
  EMAIL_VERIFY: "email_verify",
  TOKEN_REFRESH: "token_refresh",
  TOKEN_REVOKED: "token_revoked",
  DOC_CREATE: "doc_create",
  DOC_READ: "doc_read",
  DOC_UPDATE: "doc_update",
  DOC_DELETE: "doc_delete",
  DOC_RESTORE: "doc_restore",
  DOC_VERIFY: "doc_verify",
  DOC_OCR: "doc_ocr",
  DOC_SYNC: "doc_sync",
  PROFILE_UPDATE: "profile_update",
  PREFERENCES_UPDATE: "preferences_update",
  TWO_FA_SETUP: "2fa_setup",
  TWO_FA_ENABLE: "2fa_enable",
  TWO_FA_DISABLE: "2fa_disable",
  SESSION_TERMINATE: "session_terminate",
  SESSION_TERMINATE_ALL: "session_terminate_all",
  DATA_EXPORT_REQUEST: "data_export_request",
  DATA_EXPORT_COMPLETE: "data_export_complete",
  ACCOUNT_DELETE: "account_delete",
  PERMISSION_DENIED: "permission_denied",
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  INVALID_TOKEN: "invalid_token",
  SUSPICIOUS_ACTIVITY: "suspicious_activity",
});

const CATEGORY_BY_EVENT = {
  [EVENT_TYPE.LOGIN_SUCCESS]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.LOGIN_FAILURE]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.LOGIN_2FA_REQUIRED]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.LOGIN_2FA_SUCCESS]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.LOGIN_2FA_FAILURE]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.LOGOUT]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.REGISTER]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.PASSWORD_RESET_REQUEST]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.PASSWORD_RESET_SUCCESS]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.EMAIL_VERIFY]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.TOKEN_REFRESH]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.TOKEN_REVOKED]: EVENT_CATEGORY.AUTHENTICATION,
  [EVENT_TYPE.DOC_CREATE]: EVENT_CATEGORY.DATA_MODIFICATION,
  [EVENT_TYPE.DOC_READ]: EVENT_CATEGORY.DATA_ACCESS,
  [EVENT_TYPE.DOC_UPDATE]: EVENT_CATEGORY.DATA_MODIFICATION,
  [EVENT_TYPE.DOC_DELETE]: EVENT_CATEGORY.DATA_DELETION,
  [EVENT_TYPE.DOC_RESTORE]: EVENT_CATEGORY.DATA_MODIFICATION,
  [EVENT_TYPE.DOC_VERIFY]: EVENT_CATEGORY.DATA_MODIFICATION,
  [EVENT_TYPE.DOC_OCR]: EVENT_CATEGORY.DATA_ACCESS,
  [EVENT_TYPE.DOC_SYNC]: EVENT_CATEGORY.DATA_ACCESS,
  [EVENT_TYPE.PROFILE_UPDATE]: EVENT_CATEGORY.DATA_MODIFICATION,
  [EVENT_TYPE.PREFERENCES_UPDATE]: EVENT_CATEGORY.DATA_MODIFICATION,
  [EVENT_TYPE.TWO_FA_SETUP]: EVENT_CATEGORY.SECURITY,
  [EVENT_TYPE.TWO_FA_ENABLE]: EVENT_CATEGORY.SECURITY,
  [EVENT_TYPE.TWO_FA_DISABLE]: EVENT_CATEGORY.SECURITY,
  [EVENT_TYPE.SESSION_TERMINATE]: EVENT_CATEGORY.AUTHORIZATION,
  [EVENT_TYPE.SESSION_TERMINATE_ALL]: EVENT_CATEGORY.AUTHORIZATION,
  [EVENT_TYPE.DATA_EXPORT_REQUEST]: EVENT_CATEGORY.DATA_EXPORT,
  [EVENT_TYPE.DATA_EXPORT_COMPLETE]: EVENT_CATEGORY.DATA_EXPORT,
  [EVENT_TYPE.ACCOUNT_DELETE]: EVENT_CATEGORY.DATA_DELETION,
  [EVENT_TYPE.PERMISSION_DENIED]: EVENT_CATEGORY.AUTHORIZATION,
  [EVENT_TYPE.RATE_LIMIT_EXCEEDED]: EVENT_CATEGORY.SECURITY,
  [EVENT_TYPE.INVALID_TOKEN]: EVENT_CATEGORY.SECURITY,
  [EVENT_TYPE.SUSPICIOUS_ACTIVITY]: EVENT_CATEGORY.SECURITY,
};

function categoryFor(eventType) {
  return CATEGORY_BY_EVENT[eventType] || EVENT_CATEGORY.SYSTEM;
}

/**
 * Writes an audit log entry. Never throws: a failure to audit must not
 * fail the primary operation. The entry is best-effort.
 *
 * @param {object} params
 * @param {number|string|null} params.userId The user the event concerns (or null for system events).
 * @param {number|string|null} params.actorUserId The user who caused the event (may equal userId).
 * @param {string} params.eventType One of EVENT_TYPE values.
 * @param {string} params.outcome 'success' | 'failure' | 'blocked'.
 * @param {object} [params.resource] { type, id } of the affected resource.
 * @param {object} [params.request] Express request object (for ip/user-agent).
 * @param {object} [params.details] Additional JSON-serializable context.
 * @returns {Promise<void>}
 */
async function log({
  userId,
  actorUserId,
  eventType,
  outcome,
  resource,
  request,
  details,
}) {
  try {
    const ipAddress =
      request && (request.ip || request.connection?.remoteAddress || null);

    const userAgent = request && request.headers["user-agent"];

    await db.query(
      `
      INSERT INTO audit_log
        (user_id, actor_user_id, event_type, event_category, resource_type,
         resource_id, ip_address, user_agent, outcome, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        userId ?? null,
        actorUserId ?? null,
        eventType,
        categoryFor(eventType),
        resource && resource.type ? resource.type : null,
        resource && resource.id ? String(resource.id) : null,
        ipAddress ?? null,
        userAgent ?? null,
        outcome,
        JSON.stringify(details ?? {}),
      ],
    );
  } catch (error) {
    // Audit logging must never break the primary request.
    console.error("Audit log write failed:", error.message);
  }
}

/**
 * Convenience wrapper for authenticated requests: the actor is the JWT subject.
 */
async function logAuthenticated({
  req,
  userId,
  eventType,
  outcome,
  resource,
  details,
}) {
  return log({
    userId,
    actorUserId: (req && req.user && req.user.userId) ?? null,
    eventType,
    outcome,
    resource,
    request: req,
    details,
  });
}

module.exports = {
  log,
  logAuthenticated,
  EVENT_CATEGORY,
  EVENT_TYPE,
};
