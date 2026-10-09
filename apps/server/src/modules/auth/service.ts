import type pg from 'pg';
import type { SessionProjection } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import type { IngressContext } from '../../http/ingress';
import { dbNow, withTransaction, type Tx } from '../../db/transaction';
import { hmac, randomToken, sha256 } from '../../security/crypto';
import type { Secrets } from '../../config/secrets';
import { bindGrant, findValidGrant, touchGrant, type GrantRow } from '../access-gate/service';
import { consumeRate, RATE_RULES } from '../security/rate-limit';
import type { AuthProvider, AuthTokens, VerifiedIdentity } from './provider';
import { one } from '../../db/rows';

export interface AuthDeps {
  pool: pg.Pool;
  secrets: Secrets;
  auth: AuthProvider;
  /** Base for Auth email redirects (exact production origin). */
  redirectOrigin: string;
}

export interface MemberContext {
  identity: VerifiedIdentity;
  userId: string;
  appSessionId: string;
  grantId: string;
  grantExpiresAt: Date;
  profile: { username: string; displayName: string; onboarded: boolean };
}

const ENROLLMENT_TTL_MS = 60 * 60_000;
const SESSION_TOUCH_MS = 60_000;

export function emailHash(secrets: Secrets, email: string): Buffer {
  return hmac(secrets.lookupKey, 'email', email.trim().toLowerCase());
}

/** Placeholder username until onboarding (S03) sets the real one. */
function temporaryUsername(userId: string): string {
  return `u_${userId.replace(/-/g, '').slice(0, 12)}`;
}

async function ensureProfile(tx: Tx, userId: string) {
  await tx.query(
    `INSERT INTO app_private.profiles (user_id, username, display_name)
     VALUES ($1, $2, 'New member') ON CONFLICT (user_id) DO NOTHING`,
    [userId, temporaryUsername(userId)],
  );
  await tx.query(
    'INSERT INTO app_private.achievement_summaries (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
    [userId],
  );
  const res = await tx.query<{
    username: string;
    display_name: string;
    onboarded_at: Date | null;
    suspended_until: Date | null;
  }>(
    'SELECT username, display_name, onboarded_at, suspended_until FROM app_private.profiles WHERE user_id = $1',
    [userId],
  );
  return one(res);
}

async function openMemberSession(
  tx: Tx,
  deps: AuthDeps,
  identity: VerifiedIdentity,
  gateToken: string,
  now: Date,
) {
  const profile = await ensureProfile(tx, identity.userId);
  if (profile.suspended_until && profile.suspended_until > now) {
    throw new AppError('BANNED', 'This account is suspended.');
  }
  const grant = await bindGrant(tx, deps.secrets, {
    gateToken,
    userId: identity.userId,
    authSessionId: identity.sessionId,
    now,
  });
  await tx.query(
    `INSERT INTO app_private.app_sessions (user_id, supabase_session_id, gate_grant_id, scope, aal, expires_at)
     VALUES ($1, $2, $3, 'member', $4, $5)
     ON CONFLICT (supabase_session_id, scope) DO UPDATE
       SET gate_grant_id = EXCLUDED.gate_grant_id, expires_at = EXCLUDED.expires_at, revoked_at = NULL,
           last_seen_at = now()`,
    [
      identity.userId,
      identity.sessionId,
      grant.id,
      identity.aal === 'aal2' ? 2 : 1,
      grant.expiresAt,
    ],
  );
  const projection: SessionProjection = {
    userId: identity.userId,
    username: profile.username,
    displayName: profile.display_name,
    onboarded: profile.onboarded_at !== null,
    gate: { status: 'bound', expiresAt: grant.expiresAt.toISOString() },
  };
  return { grant, projection };
}

function gateTokenOf(ingress: IngressContext): string {
  if (!ingress.gateToken) throw new AppError('GATE_REQUIRED', 'Enter the access code first.');
  return ingress.gateToken;
}

/** Any valid grant (preauth or bound) proves the browser passed the gate. */
export async function requireGate(pool: pg.Pool, ingress: IngressContext): Promise<GrantRow> {
  if (!ingress.gateToken) throw new AppError('GATE_REQUIRED', 'Enter the access code first.');
  const token = ingress.gateToken;
  return withTransaction(pool, async (tx) => {
    const grant = await findValidGrant(tx, token, await dbNow(tx));
    if (!grant) throw new AppError('GATE_REQUIRED', 'Enter the access code first.');
    return grant;
  });
}

/**
 * Per-request member authorization (gate + Auth + app session + ban). A valid
 * Auth JWT alone is never enough (E03).
 */
export async function authenticateMember(
  deps: Pick<AuthDeps, 'pool' | 'auth'>,
  ingress: IngressContext,
): Promise<MemberContext> {
  if (!ingress.bearer) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  const identity = await deps.auth.verifyAccessToken(ingress.bearer);
  if (!ingress.gateToken) throw new AppError('GATE_REQUIRED', 'Verify the access code again.');
  const gateToken = ingress.gateToken;
  return withTransaction(deps.pool, async (tx) => {
    const now = await dbNow(tx);
    const session = await tx.query<{ id: string; last_seen_at: Date }>(
      `SELECT id, last_seen_at FROM app_private.app_sessions
        WHERE supabase_session_id = $1 AND scope = 'member' AND user_id = $2
          AND revoked_at IS NULL AND expires_at > $3`,
      [identity.sessionId, identity.userId, now],
    );
    const appSession = session.rows[0];
    if (!appSession) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    const grant = await findValidGrant(tx, gateToken, now);
    if (!grant || grant.kind !== 'bound' || grant.userId !== identity.userId) {
      throw new AppError('GATE_REQUIRED', 'Verify the access code again.');
    }
    const profile = await tx.query<{
      username: string;
      display_name: string;
      onboarded_at: Date | null;
      suspended_until: Date | null;
    }>(
      'SELECT username, display_name, onboarded_at, suspended_until FROM app_private.profiles WHERE user_id = $1',
      [identity.userId],
    );
    const row = profile.rows[0];
    if (!row) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    if (row.suspended_until && row.suspended_until > now)
      throw new AppError('BANNED', 'This account is suspended.');
    await touchGrant(tx, grant.id, grant.lastSeenAt, now);
    if (now.getTime() - appSession.last_seen_at.getTime() > SESSION_TOUCH_MS) {
      await tx.query('UPDATE app_private.app_sessions SET last_seen_at = $2 WHERE id = $1', [
        appSession.id,
        now,
      ]);
    }
    return {
      identity,
      userId: identity.userId,
      appSessionId: appSession.id,
      grantId: grant.id,
      grantExpiresAt: grant.expiresAt,
      profile: {
        username: row.username,
        displayName: row.display_name,
        onboarded: row.onboarded_at !== null,
      },
    };
  });
}

export function projectionOf(ctx: MemberContext): SessionProjection {
  return {
    userId: ctx.userId,
    username: ctx.profile.username,
    displayName: ctx.profile.displayName,
    onboarded: ctx.profile.onboarded,
    gate: { status: 'bound', expiresAt: ctx.grantExpiresAt.toISOString() },
  };
}

export async function login(
  deps: AuthDeps,
  input: { email: string; password: string; ingress: IngressContext },
): Promise<{
  tokens: AuthTokens;
  grant: { token: string; expiresAt: Date };
  projection: SessionProjection;
}> {
  await requireGate(deps.pool, input.ingress);
  await consumeRate(deps.pool, deps.secrets.lookupKey, RATE_RULES.loginIp, input.ingress.clientIp);
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    RATE_RULES.loginEmail,
    input.email.toLowerCase(),
  );
  const tokens = await deps.auth.signInWithPassword(input.email, input.password);
  const identity = await deps.auth.verifyAccessToken(tokens.accessToken);
  try {
    const opened = await withTransaction(deps.pool, async (tx) =>
      openMemberSession(tx, deps, identity, gateTokenOf(input.ingress), await dbNow(tx)),
    );
    return { tokens, grant: opened.grant, projection: opened.projection };
  } catch (error) {
    await deps.auth.signOut(identity, 'local').catch(() => undefined);
    throw error;
  }
}

/**
 * POST /auth/enroll — closed signup. Requires a gate grant; always answers
 * generically so the response never reveals whether an account exists.
 */
export async function enroll(deps: AuthDeps, input: { email: string; ingress: IngressContext }) {
  const grant = await requireGate(deps.pool, input.ingress);
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    RATE_RULES.enrollIp,
    input.ingress.clientIp,
    'EMAIL_LIMIT',
  );
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    RATE_RULES.enrollEmail,
    input.email.toLowerCase(),
    'EMAIL_LIMIT',
  );
  const nonce = randomToken();
  const created = await withTransaction(deps.pool, async (tx) => {
    const now = await dbNow(tx);
    await tx.query(
      `DELETE FROM app_private.enrollment_invites WHERE email_hash = $1 AND consumed_at IS NULL AND expires_at <= $2`,
      [emailHash(deps.secrets, input.email), now],
    );
    const res = await tx.query(
      `INSERT INTO app_private.enrollment_invites (email_hash, nonce_hash, access_version, gate_grant_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [
        emailHash(deps.secrets, input.email),
        sha256(nonce),
        grant.accessVersion,
        grant.id,
        now,
        new Date(now.getTime() + ENROLLMENT_TTL_MS),
      ],
    );
    return res.rowCount === 1;
  });
  if (created) {
    const redirect = new URL('/auth/callback', deps.redirectOrigin);
    redirect.searchParams.set('enrollment', nonce);
    await deps.auth.inviteUser(input.email.trim().toLowerCase(), redirect.toString());
  }
  return { accepted: true as const };
}

/**
 * Invitation callback: Auth's single-use token AND the pending enrollment
 * (same email, current gate version) AND a valid gate grant in this browser.
 */
export async function completeInvite(
  deps: AuthDeps,
  input: { tokenHash: string; enrollment: string; ingress: IngressContext },
) {
  await requireGate(deps.pool, input.ingress);
  const pending = await withTransaction(deps.pool, async (tx) => {
    const now = await dbNow(tx);
    const res = await tx.query<{ email_hash: Buffer }>(
      `UPDATE app_private.enrollment_invites e SET consumed_at = $2
         FROM app_private.access_config c
        WHERE e.nonce_hash = $1 AND e.consumed_at IS NULL AND e.expires_at > $2
          AND c.id = 1 AND e.access_version >= c.min_valid_version
        RETURNING e.email_hash`,
      [sha256(input.enrollment), now],
    );
    return res.rows[0];
  });
  if (!pending)
    throw new AppError('CALLBACK_EXPIRED', 'This invitation has expired or was already used.');
  const tokens = await deps.auth.verifyEmailToken(input.tokenHash, 'invite');
  const identity = await deps.auth.verifyAccessToken(tokens.accessToken);
  if (!identity.email || !emailHash(deps.secrets, identity.email).equals(pending.email_hash)) {
    await deps.auth.signOut(identity, 'local').catch(() => undefined);
    throw new AppError('CALLBACK_EXPIRED', 'This invitation has expired or was already used.');
  }
  const opened = await withTransaction(deps.pool, async (tx) =>
    openMemberSession(tx, deps, identity, gateTokenOf(input.ingress), await dbNow(tx)),
  );
  return { tokens, grant: opened.grant, projection: opened.projection };
}

export async function setPassword(deps: AuthDeps, ctx: MemberContext, password: string) {
  await deps.auth.setPassword(ctx.userId, password);
  await deps.auth.revokeOtherSessions(ctx.userId, ctx.identity.sessionId);
  await deps.pool.query(
    `UPDATE app_private.app_sessions SET revoked_at = now()
      WHERE user_id = $1 AND scope = 'member' AND revoked_at IS NULL AND id <> $2`,
    [ctx.userId, ctx.appSessionId],
  );
}

export async function requestRecovery(
  deps: AuthDeps,
  input: { email: string; ingress: IngressContext },
) {
  await requireGate(deps.pool, input.ingress);
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    RATE_RULES.recoveryEmail,
    input.email.toLowerCase(),
    'EMAIL_LIMIT',
  );
  await deps.auth.sendRecovery(
    input.email.trim().toLowerCase(),
    new URL('/auth/reset', deps.redirectOrigin).toString(),
  );
  return { accepted: true as const };
}

export async function completeRecovery(
  deps: AuthDeps,
  input: { tokenHash: string; password: string; ingress: IngressContext },
) {
  await requireGate(deps.pool, input.ingress);
  const tokens = await deps.auth.verifyEmailToken(input.tokenHash, 'recovery');
  const identity = await deps.auth.verifyAccessToken(tokens.accessToken);
  await deps.auth.setPassword(identity.userId, input.password);
  await deps.auth.revokeOtherSessions(identity.userId, identity.sessionId);
  await deps.pool.query(
    `UPDATE app_private.app_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [identity.userId],
  );
  const opened = await withTransaction(deps.pool, async (tx) =>
    openMemberSession(tx, deps, identity, gateTokenOf(input.ingress), await dbNow(tx)),
  );
  return { tokens, grant: opened.grant, projection: opened.projection };
}

/**
 * Refresh single-flight (E71): concurrent refreshes of one refresh token in
 * this process share a result for 10 seconds, so two tabs do not race the
 * provider's rotation into a logout loop.
 */
const inflight = new Map<string, { promise: Promise<AuthTokens>; expires: number }>();

export async function refresh(
  deps: AuthDeps,
  refreshToken: string,
  scope: 'member' | 'admin',
): Promise<AuthTokens> {
  const key = `${scope}:${sha256(refreshToken).toString('hex')}`;
  const nowMs = Date.now();
  for (const [k, v] of inflight) if (v.expires <= nowMs) inflight.delete(k);
  const existing = inflight.get(key);
  if (existing) return existing.promise;
  const promise = (async () => {
    const tokens = await deps.auth.refresh(refreshToken);
    const identity = await deps.auth.verifyAccessToken(tokens.accessToken);
    const live = await deps.pool.query(
      `SELECT 1 FROM app_private.app_sessions
        WHERE supabase_session_id = $1 AND scope = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [identity.sessionId, scope],
    );
    if (live.rowCount !== 1) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    return tokens;
  })();
  inflight.set(key, { promise, expires: nowMs + 10_000 });
  promise.catch(() => inflight.delete(key));
  return promise;
}

export async function logout(
  deps: AuthDeps,
  identity: VerifiedIdentity,
  scope: 'current' | 'all',
  sessionScope: 'member' | 'admin',
) {
  if (scope === 'all') {
    await deps.pool.query(
      `UPDATE app_private.app_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [identity.userId],
    );
  } else {
    await deps.pool.query(
      `UPDATE app_private.app_sessions SET revoked_at = now()
        WHERE supabase_session_id = $1 AND scope = $2 AND revoked_at IS NULL`,
      [identity.sessionId, sessionScope],
    );
  }
  await deps.auth.signOut(identity, scope === 'all' ? 'global' : 'local');
}
