import { ErrorCodes, formatError } from "../constants/errorCodes";

export class AppError extends Error {
  public code: number;
  public details?: string;
  public context?: Record<string, any>;

  constructor(
    code: number,
    message?: string,
    options?: {
      details?: string;
      context?: Record<string, any>;
    },
  ) {
    const errorMessage = message || formatError(code, options?.details);
    super(errorMessage);
    this.name = "AppError";
    this.code = code;
    this.details = options?.details;
    this.context = options?.context;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      context: this.context,
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function getErrorCode(err: unknown): number {
  if (isAppError(err)) return err.code;
  return ErrorCodes.UNKNOWN_ERROR;
}

export function getUserMessage(err: unknown): string {
  if (isAppError(err)) return err.message;
  if (err instanceof Error) return `(Code: ${ErrorCodes.UNKNOWN_ERROR}) ${err.message}`;
  return `(Code: ${ErrorCodes.UNKNOWN_ERROR}) An unexpected error occurred.`;
}
