import type pg from 'pg';
import { AppError } from '../http/app-error';
import { randomToken, sha256 } from '../security/crypto';
import type { Secrets } from '../config/secrets';
import { consumeRate, RATE_RULES } from '../modules/security/rate-limit';
import type { MemberContext } from '../modules/auth/service';
import { one } from '../db/rows';

export const TICKET_TTL_MS = 30_000;

/** POST /socket-tickets: one-use, 30-second, origin-bound (DB/realtime §2.3). */
export async function issueTicket(
  pool: pg.Pool,
  secrets: Secrets,
  ctx: MemberContext,
  origin: string,
  allowedOrigins: readonly string[],
) {
  if (!allowedOrigins.includes(origin))
    throw new AppError('ORIGIN_FORBIDDEN', 'Origin not allowed.');
  await consumeRate(pool, secrets.lookupKey, RATE_RULES.socketTicket, ctx.userId);
  const ticket = randomToken();
  const res = await pool.query<{ expires_at: Date }>(
    `INSERT INTO app_private.socket_tickets (token_hash, session_id, grant_id, origin, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now() + interval '30 seconds') RETURNING expires_at`,
    [sha256(ticket), ctx.appSessionId, ctx.grantId, origin],
  );
  return { ticket, expiresAt: one(res).expires_at };
}

export interface SocketPrincipal {
  userId: string;
  appSessionId: string;
  grantId: string;
}

/**
 * Atomically consume a ticket and re-verify everything it stands for: live
 * session, valid gate grant at the current minimum version, unsuspended user.
 * A second use, wrong origin or expiry returns null.
 */
export async function consumeTicket(
  pool: pg.Pool,
  ticket: unknown,
  origin: string,
): Promise<SocketPrincipal | null> {
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  const res = await pool.query<SocketPrincipal>(
    `WITH used AS (
       UPDATE app_private.socket_tickets SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND origin = $2
        RETURNING session_id, grant_id
     )
     SELECT s.user_id AS "userId", s.id AS "appSessionId", g.id AS "grantId"
       FROM used
       JOIN app_private.app_sessions s ON s.id = used.session_id
       JOIN app_private.gate_grants g ON g.id = used.grant_id
       JOIN app_private.access_config c ON c.id = 1
       JOIN app_private.profiles p ON p.user_id = s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at > now()
        AND g.revoked_at IS NULL AND g.expires_at > now() AND g.access_version >= c.min_valid_version
        AND (p.suspended_until IS NULL OR p.suspended_until <= now())`,
    [sha256(ticket), origin],
  );
  return res.rows[0] ?? null;
}
