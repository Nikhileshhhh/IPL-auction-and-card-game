import { z } from 'zod';
import { ERROR_CODE_LIST, type ErrorCode } from './errors';
import { IsoTimestamp } from './primitives';

export const ErrorCodeSchema = z.enum(ERROR_CODE_LIST as [ErrorCode, ...ErrorCode[]]);

export const ApiErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().max(500),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const FailureEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: ApiErrorSchema,
    serverNow: IsoTimestamp,
    requestId: z.string().min(1).max(64),
  })
  .strict();
export type FailureEnvelope = z.infer<typeof FailureEnvelopeSchema>;

export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      ok: z.literal(true),
      data,
      serverNow: IsoTimestamp,
      requestId: z.string().min(1).max(64),
    })
    .strict();
}

export type SuccessEnvelope<T> = {
  ok: true;
  data: T;
  serverNow: string;
  requestId: string;
};

export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;
