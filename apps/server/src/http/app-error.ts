import { ERROR_CODES, type ErrorCode } from '@stumps/contracts';

/** Typed application error mapped to the shared failure envelope. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = ERROR_CODES[code].http;
    this.retryable = ERROR_CODES[code].retryable;
    this.details = details;
  }
}
