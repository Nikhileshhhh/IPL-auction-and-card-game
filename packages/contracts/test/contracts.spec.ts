import { describe, expect, it } from 'vitest';
import {
  CommandEnvelopeSchema,
  DecimalString,
  ERROR_CODES,
  FailureEnvelopeSchema,
  fromBigInt,
  isAllowlistedCommand,
  toBigInt,
} from '../src/index';

describe('decimal string primitives', () => {
  it('round-trips money beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    const big = 2n ** 62n;
    expect(toBigInt(fromBigInt(big))).toBe(big);
  });

  it('rejects floats, negatives, leading zeros and exponent notation', () => {
    for (const bad of ['1.5', '-1', '01', '1e9', '', ' 1']) {
      expect(DecimalString.safeParse(bad).success).toBe(false);
    }
    expect(() => fromBigInt(-1n)).toThrow(RangeError);
  });
});

describe('command envelope', () => {
  const valid = {
    type: 'auction.bid',
    commandId: '9e21c15b-c550-4637-a0f5-00e200000001',
    roomId: '9e21c15b-c550-4637-a0f5-00e200000002',
    expectedVersion: '42',
    controlEpoch: '3',
    payload: {
      nominationId: '9e21c15b-c550-4637-a0f5-00e200000003',
      nominationVersion: '8',
      amountRupees: '22000000',
    },
  };

  it('accepts the DB/realtime §8.3 example', () => {
    expect(CommandEnvelopeSchema.parse(valid)).toEqual(valid);
  });

  it('rejects unknown top-level fields (strict schemas)', () => {
    expect(CommandEnvelopeSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });

  it('the dispatcher allowlist excludes internal-only actions', () => {
    expect(isAllowlistedCommand('auction.bid')).toBe(true);
    for (const internal of [
      'auction.sell',
      'card.award',
      'card.deal',
      'vote.resolve',
      '__proto__',
    ]) {
      expect(isAllowlistedCommand(internal)).toBe(false);
    }
  });
});

describe('error envelope', () => {
  it('requires a registered error code', () => {
    const base = { ok: false, serverNow: '2026-10-09T15:20:00.000Z', requestId: 'req_x' };
    expect(
      FailureEnvelopeSchema.safeParse({
        ...base,
        error: { code: 'LATE_BID', message: 'Too late', retryable: false },
      }).success,
    ).toBe(true);
    expect(
      FailureEnvelopeSchema.safeParse({
        ...base,
        error: { code: 'MADE_UP', message: 'x', retryable: false },
      }).success,
    ).toBe(false);
  });

  it('marks only transport/limit failures as retryable', () => {
    const retryable = Object.entries(ERROR_CODES)
      .filter(([, v]) => v.retryable)
      .map(([k]) => k)
      .sort();
    expect(retryable).toEqual([
      'ACCESS_LOCKED',
      'EMAIL_LIMIT',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
    ]);
  });
});
