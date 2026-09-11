const ErrorCodes = {
  AUTH_TOKEN_EXPIRED: 1001,
  AUTH_TOKEN_INVALID: 1002,
  AUTH_REQUIRED: 1003,
  AUTH_LOGIN_FAILED: 1004,
  AUTH_REGISTER_FAILED: 1005,
  AUTH_FORBIDDEN: 1006,

  DOC_NOT_FOUND: 2001,
  DOC_VALIDATION: 2002,
  DOC_CREATE_FAILED: 2003,
  DOC_UPDATE_FAILED: 2004,
  DOC_DELETE_FAILED: 2005,
  DOC_UPLOAD_FAILED: 2006,
  DOC_PROCESS_FAILED: 2007,
  DOC_FILE_TOO_LARGE: 2008,
  DOC_INVALID_FILE_TYPE: 2009,
  DOC_ALREADY_EXISTS: 2010,

  DB_QUERY_FAILED: 3001,
  DB_CONNECTION: 3002,
  DB_TRANSACTION: 3003,

  OCR_PROCESS_FAILED: 5001,
  OCR_NO_TEXT_FOUND: 5002,
  OCR_INVALID_IMAGE: 5003,
  AI_EXTRACTION_FAILED: 5004,

  NETWORK_TIMEOUT: 6001,
  NETWORK_SERVER_ERROR: 6003,
  NETWORK_INVALID_RESPONSE: 6004,

  SYNC_CONFLICT: 7001,
  SYNC_PARTIAL: 7002,
  SYNC_NOT_AUTHENTICATED: 7003,
  SYNC_BACKEND_UNAVAILABLE: 7004,

  NOTIF_TOKEN_MISSING: 8001,
  NOTIF_PERMISSION_DENIED: 8002,
  NOTIF_SCHEDULE_FAILED: 8003,

  PROFILE_LOAD_FAILED: 9001,
  PROFILE_UPDATE_FAILED: 9002,
  PROFILE_EXPORT_FAILED: 9003,

  GENERIC_ERROR: 9997,
  UNKNOWN_ERROR: 9999,
};

const messages = {
  [ErrorCodes.AUTH_TOKEN_EXPIRED]: "Your session has expired. Please sign in again.",
  [ErrorCodes.AUTH_TOKEN_INVALID]: "Authentication token is invalid. Please sign in again.",
  [ErrorCodes.AUTH_REQUIRED]: "Authentication required. Please sign in to continue.",
  [ErrorCodes.AUTH_LOGIN_FAILED]: "Login failed. Please check your credentials.",
  [ErrorCodes.AUTH_REGISTER_FAILED]: "Registration failed. Please try again.",
  [ErrorCodes.AUTH_FORBIDDEN]: "You do not have permission to perform this action.",
  [ErrorCodes.DOC_NOT_FOUND]: "Document not found. It may have been deleted.",
  [ErrorCodes.DOC_VALIDATION]: "Validation failed. Please check your input.",
  [ErrorCodes.DOC_CREATE_FAILED]: "Failed to create document.",
  [ErrorCodes.DOC_UPDATE_FAILED]: "Failed to update document.",
  [ErrorCodes.DOC_DELETE_FAILED]: "Failed to delete document.",
  [ErrorCodes.DOC_UPLOAD_FAILED]: "Document upload failed. Please check your connection.",
  [ErrorCodes.DOC_PROCESS_FAILED]: "Document processing failed. Please try again.",
  [ErrorCodes.DOC_FILE_TOO_LARGE]: "File is too large. Maximum size is 10MB.",
  [ErrorCodes.DOC_INVALID_FILE_TYPE]: "Invalid file type. Please upload PDF or image.",
  [ErrorCodes.DOC_ALREADY_EXISTS]: "A document with this number already exists.",
  [ErrorCodes.DB_QUERY_FAILED]: "Database query failed.",
  [ErrorCodes.DB_CONNECTION]: "Database connection error.",
  [ErrorCodes.DB_TRANSACTION]: "Database transaction failed.",
  [ErrorCodes.OCR_PROCESS_FAILED]: "OCR processing failed.",
  [ErrorCodes.OCR_NO_TEXT_FOUND]: "No text could be extracted from the document.",
  [ErrorCodes.OCR_INVALID_IMAGE]: "Invalid image format for OCR.",
  [ErrorCodes.AI_EXTRACTION_FAILED]: "AI data extraction failed.",
  [ErrorCodes.NETWORK_TIMEOUT]: "Request timed out. Please check your connection.",
  [ErrorCodes.NETWORK_SERVER_ERROR]: "Server error. Please try again later.",
  [ErrorCodes.NETWORK_INVALID_RESPONSE]: "Invalid response from server.",
  [ErrorCodes.SYNC_CONFLICT]: "Sync conflict detected. Please review your documents.",
  [ErrorCodes.SYNC_PARTIAL]: "Some documents could not be synced. Please try again.",
  [ErrorCodes.SYNC_NOT_AUTHENTICATED]: "Please sign in to sync with the cloud.",
  [ErrorCodes.SYNC_BACKEND_UNAVAILABLE]: "Cloud backup is temporarily unavailable.",
  [ErrorCodes.NOTIF_TOKEN_MISSING]: "Push token not registered.",
  [ErrorCodes.NOTIF_PERMISSION_DENIED]: "Notification permissions denied.",
  [ErrorCodes.NOTIF_SCHEDULE_FAILED]: "Failed to schedule notification.",
  [ErrorCodes.PROFILE_LOAD_FAILED]: "Failed to load profile data.",
  [ErrorCodes.PROFILE_UPDATE_FAILED]: "Failed to update profile.",
  [ErrorCodes.PROFILE_EXPORT_FAILED]: "Failed to export profile data.",
  [ErrorCodes.GENERIC_ERROR]: "An unexpected error occurred.",
  [ErrorCodes.UNKNOWN_ERROR]: "Unknown error. Please contact support.",
};

function getErrorMessage(code) {
  return messages[code] || messages[ErrorCodes.UNKNOWN_ERROR];
}

function formatError(code, detail) {
  const message = getErrorMessage(code);
  return detail ? `${message}\n${detail}` : message;
}

module.exports = {
  ErrorCodes,
  getErrorMessage,
  formatError,
};
