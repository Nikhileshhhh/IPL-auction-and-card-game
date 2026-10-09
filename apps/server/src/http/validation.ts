import type { z } from 'zod';
import { AppError } from './app-error';

/** Parse an untrusted payload with a strict schema; unknown fields fail. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Request is malformed.', {
      fields: result.error.issues
        .slice(0, 10)
        .map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}
