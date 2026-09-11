const { ErrorCodes } = require("./errorCodes");

class AppError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.numericCode = ErrorCodes[errorCode] || ErrorCodes.UNKNOWN_ERROR;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  const numericCode = err.numericCode || ErrorCodes.UNKNOWN_ERROR;

  console.error(
    `[DocuGuard Backend Error] Code: ${numericCode} | Status: ${err.statusCode} | Path: ${req.path} | Method: ${req.method}`,
    {
      message: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      body: req.body,
      params: req.params,
      query: req.query,
      user: req.user ? { userId: req.user.userId } : undefined,
    },
  );

  res.status(err.statusCode).json({
    status: err.status,
    code: numericCode,
    errorCode: err.errorCode || "INTERNAL_SERVER_ERROR",
    error: err.message || "Something went wrong on the server",
  });
};

module.exports = { AppError, errorHandler, ErrorCodes };
