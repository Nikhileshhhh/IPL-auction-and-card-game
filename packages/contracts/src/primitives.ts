import { z } from 'zod';

/** UUID (any version) as produced by gen_random_uuid(). */
export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** Non-negative bigint serialized as a decimal string (versions, sequence numbers). */
export const DecimalString = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/, 'expected a non-negative decimal integer string');

/** Integer rupees serialized as a decimal string. Never a float. */
export const RupeesString = DecimalString;

/** ISO-8601 UTC timestamp. */
export const IsoTimestamp = z.iso.datetime({ offset: false });

/** Parse a decimal string into a bigint after schema validation. */
export function toBigInt(value: string): bigint {
  return BigInt(DecimalString.parse(value));
}

/** Serialize a non-negative bigint for transport. */
export function fromBigInt(value: bigint): string {
  if (value < 0n) throw new RangeError('negative values are not transportable');
  return value.toString(10);
}

/** Maximum JSON payload accepted by ordinary endpoints (DB/realtime §8). */
export const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Maximum admin import payload. */
export const MAX_ADMIN_IMPORT_BYTES = 5 * 1024 * 1024;
