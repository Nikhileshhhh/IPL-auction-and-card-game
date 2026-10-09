import type { FailureEnvelope, SuccessEnvelope, ErrorCode } from '@stumps/contracts';
import { ERROR_CODES } from '@stumps/contracts';

export function success<T>(data: T, requestId: string, now: Date): SuccessEnvelope<T> {
  return { ok: true, data, serverNow: now.toISOString(), requestId };
}

export function failure(
  code: ErrorCode,
  message: string,
  requestId: string,
  now: Date,
  details?: Record<string, unknown>,
): FailureEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: ERROR_CODES[code].retryable,
      ...(details ? { details } : {}),
    },
    serverNow: now.toISOString(),
    requestId,
  };
}
