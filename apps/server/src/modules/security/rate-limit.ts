import type pg from 'pg';
import { AppError } from '../../http/app-error';
import { hmac } from '../../security/crypto';
import type { ErrorCode } from '@stumps/contracts';
import { one } from '../../db/rows';

export interface RateRule {
  kind: string;
  limit: number;
  windowSeconds: number;
}

/** Default starting policies (master §6); configurable and tested on shared networks. */
export const RATE_RULES = {
  loginIp: { kind: 'login_ip', limit: 20, windowSeconds: 900 },
  loginEmail: { kind: 'login_email', limit: 10, windowSeconds: 900 },
  enrollEmail: { kind: 'enroll_email', limit: 3, windowSeconds: 3600 },
  enrollIp: { kind: 'enroll_ip', limit: 10, windowSeconds: 3600 },
  recoveryEmail: { kind: 'recovery_email', limit: 3, windowSeconds: 3600 },
  adminLoginIp: { kind: 'admin_login_ip', limit: 10, windowSeconds: 900 },
  attemptMint: { kind: 'attempt_mint', limit: 10, windowSeconds: 900 },
  socketTicket: { kind: 'socket_ticket', limit: 30, windowSeconds: 60 },
  usernameCheck: { kind: 'username_check', limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

/**
 * Fixed-window counter keyed by an HMAC of the subject (no raw IPs/emails
 * stored). Throws `errorCode` with Retry-After details when exceeded.
 */
export async function consumeRate(
  pool: pg.Pool,
  lookupKey: Buffer,
  rule: RateRule,
  subject: string,
  errorCode: ErrorCode = 'RATE_LIMITED',
): Promise<void> {
  const bucket = hmac(lookupKey, `rate:${rule.kind}`, subject);
  const res = await pool.query<{ hits: number; window_started_at: Date }>(
    `INSERT INTO app_private.rate_counters (bucket_hash, kind, window_started_at, hits, expires_at)
     VALUES ($1, $2, now(), 1, now() + make_interval(secs => $3::int))
     ON CONFLICT (bucket_hash) DO UPDATE SET
       hits = CASE WHEN app_private.rate_counters.expires_at <= now() THEN 1 ELSE app_private.rate_counters.hits + 1 END,
       window_started_at = CASE WHEN app_private.rate_counters.expires_at <= now() THEN now()
                                ELSE app_private.rate_counters.window_started_at END,
       expires_at = CASE WHEN app_private.rate_counters.expires_at <= now() THEN now() + make_interval(secs => $3::int)
                         ELSE app_private.rate_counters.expires_at END
     RETURNING hits, window_started_at`,
    [bucket, rule.kind, rule.windowSeconds],
  );
  const row = one(res);
  if (row.hits > rule.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((row.window_started_at.getTime() + rule.windowSeconds * 1000 - Date.now()) / 1000),
    );
    throw new AppError(errorCode, 'Too many requests. Try again later.', { retryAfterSeconds });
  }
}
