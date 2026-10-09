import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import * as OTPAuth from 'otpauth';
import type pg from 'pg';
import { AppError } from '../../http/app-error';
import { randomToken, sha256 } from '../../security/crypto';
import { ARGON2_PARAMS } from '../../security/password-hash';
import {
  identityFromClaims,
  type AuthProvider,
  type AuthTokens,
  type TotpEnrollment,
  type VerifiedIdentity,
} from './provider';
import { one } from '../../db/rows';

export const LOCAL_AUTH_ISSUER = 'stumps-local-auth';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const EMAIL_TOKEN_TTL_MS = 60 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;

export interface LocalProviderOptions {
  nodeEnv: 'development' | 'test' | 'production';
  /** HS256 secret, at least 32 bytes. Dev/test only. */
  jwtSecret: string;
  /** Required for account operations; verification-only use may omit it. */
  pool?: pg.Pool;
  accessTokenTtlSeconds?: number;
}

/**
 * Development/test Auth adapter (ADR-016) mirroring the Supabase Auth behaviors
 * the product relies on. Refuses to exist in production so a misconfiguration
 * cannot silently swap in a home-grown password store.
 */
export class LocalAuthProvider implements AuthProvider {
  readonly kind = 'local' as const;
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;
  /** Real Argon2id hash of a random value so unknown accounts cost the same work. */
  private dummyHash?: Promise<string>;

  constructor(private readonly options: LocalProviderOptions) {
    if (options.nodeEnv === 'production') {
      throw new Error('LocalAuthProvider is disabled in production');
    }
    const secret = new TextEncoder().encode(options.jwtSecret);
    if (secret.byteLength < 32) throw new Error('LOCAL_AUTH_JWT_SECRET must be at least 32 bytes');
    this.secret = secret;
    this.ttlSeconds = options.accessTokenTtlSeconds ?? 3600;
  }

  private get pool(): pg.Pool {
    if (!this.options.pool)
      throw new Error('LocalAuthProvider requires a database pool for account operations');
    return this.options.pool;
  }

  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: LOCAL_AUTH_ISSUER,
        audience: 'authenticated',
        algorithms: ['HS256'],
        clockTolerance: 5,
      });
      return identityFromClaims(payload);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UNAUTHENTICATED', 'Sign in again.');
    }
  }

  private async mint(
    userId: string,
    sessionId: string,
    aal: 1 | 2,
    email: string,
    refreshToken: string,
  ): Promise<AuthTokens> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const accessToken = await new SignJWT({
      session_id: sessionId,
      aal: aal === 2 ? 'aal2' : 'aal1',
      role: 'authenticated',
      email,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(LOCAL_AUTH_ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);
    return { accessToken, refreshToken, expiresAt };
  }

  private async newSession(userId: string, email: string): Promise<AuthTokens> {
    const refresh = randomToken();
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO auth_local.sessions (user_id, refresh_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
      [userId, sha256(refresh), new Date(Date.now() + REFRESH_TTL_MS)],
    );
    return this.mint(userId, one(res).id, 1, email, refresh);
  }

  async signInWithPassword(email: string, password: string): Promise<AuthTokens> {
    const res = await this.pool.query<{ id: string; email: string; password_hash: string }>(
      `SELECT u.id, u.email, c.password_hash FROM auth.users u JOIN auth_local.credentials c ON c.user_id = u.id
        WHERE lower(u.email) = lower($1) AND u.email_confirmed_at IS NOT NULL`,
      [email],
    );
    const row = res.rows[0];
    // Uniform work whether or not the account exists.
    this.dummyHash ??= argon2.hash(randomToken(), ARGON2_PARAMS);
    const hash = row?.password_hash ?? (await this.dummyHash);
    const ok = await argon2.verify(hash, password).catch(() => false);
    if (!row || !ok) throw new AppError('BAD_CREDENTIALS', 'Email or password is incorrect.');
    return this.newSession(row.id, row.email);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const next = randomToken();
    const res = await this.pool.query<{ id: string; user_id: string; aal: 1 | 2; email: string }>(
      `UPDATE auth_local.sessions s SET refresh_hash = $2, rotated_at = now()
         FROM auth.users u
        WHERE s.refresh_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.id = s.user_id
        RETURNING s.id, s.user_id, s.aal, u.email`,
      [sha256(refreshToken), sha256(next)],
    );
    const row = res.rows[0];
    if (!row) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    return this.mint(row.user_id, row.id, row.aal, row.email, next);
  }

  async signOut(identity: VerifiedIdentity, scope: 'local' | 'global'): Promise<void> {
    if (scope === 'global') {
      await this.pool.query(
        'UPDATE auth_local.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [identity.userId],
      );
    } else {
      await this.pool.query('UPDATE auth_local.sessions SET revoked_at = now() WHERE id = $1', [
        identity.sessionId,
      ]);
    }
  }

  private async emailToken(
    userId: string,
    email: string,
    kind: 'invite' | 'recovery',
    redirectTo: string,
  ) {
    const token = randomToken();
    await this.pool.query(
      `INSERT INTO auth_local.one_time_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)`,
      [sha256(token), userId, kind, new Date(Date.now() + EMAIL_TOKEN_TTL_MS)],
    );
    const link = new URL(redirectTo);
    link.searchParams.set('token_hash', token);
    link.searchParams.set('type', kind);
    await this.pool.query('INSERT INTO auth_local.outbox (email, kind, link) VALUES ($1, $2, $3)', [
      email,
      kind,
      link.toString(),
    ]);
  }

  async inviteUser(email: string, redirectTo: string): Promise<{ invited: boolean }> {
    const existing = await this.pool.query<{ id: string; has_password: boolean }>(
      `SELECT u.id, (c.user_id IS NOT NULL) AS has_password
         FROM auth.users u LEFT JOIN auth_local.credentials c ON c.user_id = u.id WHERE lower(u.email) = lower($1)`,
      [email],
    );
    if (existing.rows[0]?.has_password) return { invited: false };
    const userId =
      existing.rows[0]?.id ??
      one(
        await this.pool.query<{ id: string }>(
          'INSERT INTO auth.users (email) VALUES (lower($1)) RETURNING id',
          [email],
        ),
      ).id;
    await this.emailToken(userId, email.toLowerCase(), 'invite', redirectTo);
    return { invited: true };
  }

  async verifyEmailToken(tokenHash: string, type: 'invite' | 'recovery'): Promise<AuthTokens> {
    const res = await this.pool.query<{ user_id: string; email: string }>(
      `UPDATE auth_local.one_time_tokens t SET consumed_at = now()
         FROM auth.users u
        WHERE t.token_hash = $1 AND t.kind = $2 AND t.consumed_at IS NULL AND t.expires_at > now() AND u.id = t.user_id
        RETURNING t.user_id, u.email`,
      [sha256(tokenHash), type],
    );
    const row = res.rows[0];
    if (!row) throw new AppError('CALLBACK_EXPIRED', 'This link has expired or was already used.');
    await this.pool.query(
      'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id = $1',
      [row.user_id],
    );
    return this.newSession(row.user_id, row.email);
  }

  async sendRecovery(email: string, redirectTo: string): Promise<void> {
    const res = await this.pool.query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM auth.users u JOIN auth_local.credentials c ON c.user_id = u.id WHERE lower(u.email) = lower($1)`,
      [email],
    );
    const row = res.rows[0];
    if (row) await this.emailToken(row.id, row.email, 'recovery', redirectTo);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const hash = await argon2.hash(password, ARGON2_PARAMS);
    await this.pool.query(
      `INSERT INTO auth_local.credentials (user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [userId, hash],
    );
  }

  async revokeOtherSessions(userId: string, keepSessionId: string | undefined): Promise<void> {
    await this.pool.query(
      `UPDATE auth_local.sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, keepSessionId ?? null],
    );
  }

  private async sessionUser(session: AuthTokens): Promise<VerifiedIdentity> {
    const identity = await this.verifyAccessToken(session.accessToken);
    const live = await this.pool.query(
      'SELECT 1 FROM auth_local.sessions WHERE id = $1 AND revoked_at IS NULL',
      [identity.sessionId],
    );
    if (live.rowCount !== 1) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    return identity;
  }

  async listVerifiedFactors(session: AuthTokens) {
    const identity = await this.sessionUser(session);
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM auth_local.mfa_factors WHERE user_id = $1 AND status = 'verified' ORDER BY created_at`,
      [identity.userId],
    );
    return res.rows;
  }

  async enrollTotp(session: AuthTokens, label: string): Promise<TotpEnrollment> {
    const identity = await this.sessionUser(session);
    const secret = new OTPAuth.Secret({ size: 20 });
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO auth_local.mfa_factors (user_id, secret, status) VALUES ($1, $2, 'unverified') RETURNING id`,
      [identity.userId, secret.base32],
    );
    const totp = new OTPAuth.TOTP({
      issuer: 'STUMPS',
      label,
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    return { factorId: one(res).id, otpauthUri: totp.toString(), secret: secret.base32 };
  }

  async challengeTotp(session: AuthTokens, factorId: string) {
    const identity = await this.sessionUser(session);
    const factor = await this.pool.query(
      'SELECT 1 FROM auth_local.mfa_factors WHERE id = $1 AND user_id = $2',
      [factorId, identity.userId],
    );
    if (factor.rowCount !== 1) throw new AppError('MFA_REQUIRED', 'Unknown authenticator.');
    const res = await this.pool.query<{ id: string }>(
      'INSERT INTO auth_local.mfa_challenges (factor_id, expires_at) VALUES ($1, $2) RETURNING id',
      [factorId, new Date(Date.now() + CHALLENGE_TTL_MS)],
    );
    return { challengeId: one(res).id };
  }

  async verifyTotp(
    session: AuthTokens,
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<AuthTokens> {
    const identity = await this.sessionUser(session);
    const factor = await this.pool.query<{ secret: string }>(
      'SELECT secret FROM auth_local.mfa_factors WHERE id = $1 AND user_id = $2',
      [factorId, identity.userId],
    );
    const secret = factor.rows[0]?.secret;
    const challenge = await this.pool.query(
      `UPDATE auth_local.mfa_challenges SET verified_at = now()
        WHERE id = $1 AND factor_id = $2 AND verified_at IS NULL AND expires_at > now() RETURNING id`,
      [challengeId, factorId],
    );
    const totp = secret
      ? new OTPAuth.TOTP({
          secret: OTPAuth.Secret.fromBase32(secret),
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        })
      : undefined;
    if (!totp || challenge.rowCount !== 1 || totp.validate({ token: code, window: 1 }) === null) {
      throw new AppError('MFA_REQUIRED', 'The code is not valid.');
    }
    await this.pool.query(`UPDATE auth_local.mfa_factors SET status = 'verified' WHERE id = $1`, [
      factorId,
    ]);
    const next = randomToken();
    await this.pool.query(
      'UPDATE auth_local.sessions SET aal = 2, refresh_hash = $2, rotated_at = now() WHERE id = $1',
      [identity.sessionId, sha256(next)],
    );
    return this.mint(identity.userId, identity.sessionId, 2, identity.email ?? '', next);
  }
}
