import type pg from 'pg';
import { AppError } from '../../http/app-error';
import type { IngressContext } from '../../http/ingress';
import { dbNow, withTransaction } from '../../db/transaction';
import { one } from '../../db/rows';
import type { Secrets } from '../../config/secrets';
import { consumeRate, RATE_RULES } from '../security/rate-limit';
import type { AuthProvider, AuthTokens, VerifiedIdentity } from '../auth/provider';

export const ADMIN_IDLE_MS = 30 * 60_000;
export const ADMIN_ABSOLUTE_MS = 8 * 60 * 60_000;
export const STEP_UP_MS = 5 * 60_000;

export interface AdminDeps {
  pool: pg.Pool;
  secrets: Secrets;
  auth: AuthProvider;
}

export interface AdminContext {
  identity: VerifiedIdentity;
  userId: string;
  role: 'super_admin' | 'operator';
  appSessionId: string;
  aal: 1 | 2;
  stepUpAt: Date | null;
}

/**
 * Admin authorization on every call: verified JWT + live admin-scope session
 * (30 min idle, 8 h absolute) + current DB assignment (never JWT metadata) +
 * AAL2 + optional step-up within 5 minutes. Admin routes bypass the global
 * gate only for administering access recovery.
 */
export async function requireAdmin(
  deps: Pick<AdminDeps, 'pool' | 'auth'>,
  ingress: IngressContext,
  options: { aal2?: boolean; stepUp?: boolean } = { aal2: true },
): Promise<AdminContext> {
  if (!ingress.bearer) throw new AppError('UNAUTHENTICATED', 'Sign in as an administrator.');
  const identity = await deps.auth.verifyAccessToken(ingress.bearer);
  return withTransaction(deps.pool, async (tx) => {
    const now = await dbNow(tx);
    const res = await tx.query<{
      id: string;
      aal: 1 | 2;
      step_up_at: Date | null;
      last_seen_at: Date;
      role: 'super_admin' | 'operator' | null;
    }>(
      `SELECT s.id, s.aal, s.step_up_at, s.last_seen_at, a.role
         FROM app_private.app_sessions s
         LEFT JOIN app_private.admin_assignments a ON a.user_id = s.user_id AND a.revoked_at IS NULL
        WHERE s.supabase_session_id = $1 AND s.scope = 'admin' AND s.user_id = $2
          AND s.revoked_at IS NULL AND s.expires_at > $3`,
      [identity.sessionId, identity.userId, now],
    );
    const row = res.rows[0];
    if (!row || row.last_seen_at.getTime() + ADMIN_IDLE_MS <= now.getTime()) {
      throw new AppError('SESSION_REVOKED', 'Administrator session expired. Sign in again.');
    }
    if (!row.role) throw new AppError('ADMIN_REQUIRED', 'Not authorized.');
    const aal2 = identity.aal === 'aal2' && row.aal === 2;
    if (options.aal2 !== false && !aal2)
      throw new AppError('MFA_REQUIRED', 'Verify your authenticator code.');
    if (
      options.stepUp &&
      (!row.step_up_at || row.step_up_at.getTime() + STEP_UP_MS <= now.getTime())
    ) {
      throw new AppError('STEP_UP_REQUIRED', 'Confirm your authenticator code to continue.');
    }
    await tx.query('UPDATE app_private.app_sessions SET last_seen_at = $2 WHERE id = $1', [
      row.id,
      now,
    ]);
    return {
      identity,
      userId: identity.userId,
      role: row.role,
      appSessionId: row.id,
      aal: row.aal,
      stepUpAt: row.step_up_at,
    };
  });
}

export async function adminLogin(
  deps: AdminDeps,
  input: { email: string; password: string; ingress: IngressContext },
) {
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    RATE_RULES.adminLoginIp,
    input.ingress.clientIp,
  );
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    RATE_RULES.loginEmail,
    `admin:${input.email.toLowerCase()}`,
  );
  const tokens = await deps.auth.signInWithPassword(input.email, input.password);
  const identity = await deps.auth.verifyAccessToken(tokens.accessToken);
  const assignment = await deps.pool.query<{ mfa_enrollment_until: Date | null }>(
    `SELECT a.mfa_enrollment_until FROM app_private.admin_assignments a
      WHERE a.user_id = $1 AND a.revoked_at IS NULL`,
    [identity.userId],
  );
  if (assignment.rowCount !== 1) {
    await deps.auth.signOut(identity, 'local').catch(() => undefined);
    // Same message as bad credentials: do not reveal which accounts are admins.
    throw new AppError('BAD_CREDENTIALS', 'Email or password is incorrect.');
  }
  await deps.pool.query(
    `INSERT INTO app_private.app_sessions (user_id, supabase_session_id, scope, aal, expires_at)
     VALUES ($1, $2, 'admin', 1, now() + make_interval(secs => $3::int))
     ON CONFLICT (supabase_session_id, scope) DO NOTHING`,
    [identity.userId, identity.sessionId, ADMIN_ABSOLUTE_MS / 1000],
  );
  const factors = await deps.auth.listVerifiedFactors(tokens);
  const window = one(assignment).mfa_enrollment_until;
  return {
    tokens,
    result: {
      mfaRequired: true as const,
      factorIds: factors.map((f) => f.id),
      enrollmentAllowed: factors.length === 0 && window !== null && window > new Date(),
    },
  };
}

function sessionTokens(ingress: IngressContext, refreshToken: string | undefined): AuthTokens {
  if (!ingress.bearer || !refreshToken)
    throw new AppError('UNAUTHENTICATED', 'Sign in as an administrator.');
  return { accessToken: ingress.bearer, refreshToken, expiresAt: new Date() };
}

/** First-factor enrollment is only possible inside the operator-set window. */
export async function adminEnrollTotp(
  deps: AdminDeps,
  ctx: AdminContext,
  ingress: IngressContext,
  refreshToken?: string,
) {
  const session = sessionTokens(ingress, refreshToken);
  const factors = await deps.auth.listVerifiedFactors(session);
  const window = await deps.pool.query<{ open: boolean }>(
    `SELECT (mfa_enrollment_until IS NOT NULL AND mfa_enrollment_until > now()) AS open
       FROM app_private.admin_assignments WHERE user_id = $1 AND revoked_at IS NULL`,
    [ctx.userId],
  );
  if (factors.length > 0 || !window.rows[0]?.open) {
    throw new AppError('FORBIDDEN', 'Authenticator enrollment is not open. Ask an operator.');
  }
  const enrollment = await deps.auth.enrollTotp(session, `admin`);
  await deps.pool.query(
    `INSERT INTO app_private.admin_audit (actor_id, action, target_class) VALUES ($1, 'admin.mfa_enrollment_started', 'mfa_factor')`,
    [ctx.userId],
  );
  return enrollment;
}

export async function adminChallenge(
  deps: AdminDeps,
  ingress: IngressContext,
  refreshToken: string | undefined,
  factorId: string,
) {
  return deps.auth.challengeTotp(sessionTokens(ingress, refreshToken), factorId);
}

/** Verify TOTP → AAL2 session; also serves as step-up for sensitive changes. */
export async function adminVerifyTotp(
  deps: AdminDeps,
  ctx: AdminContext,
  ingress: IngressContext,
  refreshToken: string | undefined,
  input: { factorId: string; challengeId: string; code: string },
): Promise<AuthTokens> {
  const tokens = await deps.auth.verifyTotp(
    sessionTokens(ingress, refreshToken),
    input.factorId,
    input.challengeId,
    input.code,
  );
  const identity = await deps.auth.verifyAccessToken(tokens.accessToken);
  if (identity.aal !== 'aal2' || identity.userId !== ctx.userId)
    throw new AppError('MFA_REQUIRED', 'Verification failed.');
  await withTransaction(deps.pool, async (tx) => {
    const now = await dbNow(tx);
    await tx.query(
      `UPDATE app_private.app_sessions SET aal = 2, step_up_at = $3, supabase_session_id = $2, last_seen_at = $3
        WHERE id = $1`,
      [ctx.appSessionId, identity.sessionId, now],
    );
    await tx.query(
      'UPDATE app_private.admin_assignments SET mfa_enrollment_until = NULL WHERE user_id = $1 AND mfa_enrollment_until IS NOT NULL',
      [ctx.userId],
    );
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class) VALUES ($1, 'admin.mfa_verified', 'admin_session')`,
      [ctx.userId],
    );
  });
  return tokens;
}
