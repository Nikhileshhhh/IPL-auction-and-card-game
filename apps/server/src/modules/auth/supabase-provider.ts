import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../../http/app-error';
import {
  identityFromClaims,
  type AuthProvider,
  type AuthTokens,
  type TotpEnrollment,
  type VerifiedIdentity,
} from './provider';

export interface SupabaseProviderOptions {
  /** Pinned issuer, e.g. https://<project>.supabase.co/auth/v1 */
  issuer: string;
  /** Pinned JWKS URL; never derived from a token header. */
  jwksUrl?: string;
  /** Injectable key resolver for tests. */
  keys?: JWTVerifyGetKey;
  url?: string;
  publishableKey?: string;
  /** Highly privileged; only the invite/admin calls below use it (DB/realtime §6). */
  serviceRoleKey?: string;
}

function tokensFrom(session: Session | null): AuthTokens {
  if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in again.');
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(
      (session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in) * 1000,
    ),
  };
}

/**
 * Production adapter. Verification uses the pinned issuer/JWKS; account
 * operations use the supported Auth APIs (never direct writes to auth tables).
 * Exercised against a real project only in staging (ADR-016).
 */
export class SupabaseAuthProvider implements AuthProvider {
  readonly kind = 'supabase' as const;
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly options: SupabaseProviderOptions) {
    if (options.keys) this.keys = options.keys;
    else if (options.jwksUrl) this.keys = createRemoteJWKSet(new URL(options.jwksUrl));
    else throw new Error('SupabaseAuthProvider requires jwksUrl');
  }

  private publicClient(): SupabaseClient {
    if (!this.options.url || !this.options.publishableKey)
      throw new Error('Supabase URL/publishable key missing');
    return createClient(this.options.url, this.options.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  private adminClient(): SupabaseClient {
    if (!this.options.url || !this.options.serviceRoleKey)
      throw new Error('Supabase service key missing');
    return createClient(this.options.url, this.options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  private async sessionClient(session: AuthTokens): Promise<SupabaseClient> {
    const client = this.publicClient();
    const { error } = await client.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    if (error) throw new AppError('UNAUTHENTICATED', 'Sign in again.');
    return client;
  }

  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
        clockTolerance: 5,
      });
      return identityFromClaims(payload);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UNAUTHENTICATED', 'Sign in again.');
    }
  }

  async signInWithPassword(email: string, password: string): Promise<AuthTokens> {
    const { data, error } = await this.publicClient().auth.signInWithPassword({ email, password });
    if (error || !data.session)
      throw new AppError('BAD_CREDENTIALS', 'Email or password is incorrect.');
    return tokensFrom(data.session);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { data, error } = await this.publicClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    return tokensFrom(data.session);
  }

  async signOut(identity: VerifiedIdentity, scope: 'local' | 'global'): Promise<void> {
    // Admin sign-out by session needs the JWT; fall back to user-wide when global.
    if (scope === 'global')
      await this.adminClient()
        .auth.admin.signOut(identity.userId, 'global')
        .catch(() => undefined);
  }

  async inviteUser(email: string, redirectTo: string): Promise<{ invited: boolean }> {
    const { error } = await this.adminClient().auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error && /already/i.test(error.message)) return { invited: false };
    if (error) throw new AppError('SERVICE_UNAVAILABLE', 'Invitation could not be sent right now.');
    return { invited: true };
  }

  async verifyEmailToken(tokenHash: string, type: 'invite' | 'recovery'): Promise<AuthTokens> {
    const { data, error } = await this.publicClient().auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error || !data.session)
      throw new AppError('CALLBACK_EXPIRED', 'This link has expired or was already used.');
    return tokensFrom(data.session);
  }

  async sendRecovery(email: string, redirectTo: string): Promise<void> {
    await this.publicClient().auth.resetPasswordForEmail(email, { redirectTo });
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await this.adminClient().auth.admin.updateUserById(userId, { password });
    if (error) throw new AppError('PASSWORD_POLICY', 'Choose a different password.');
  }

  async revokeOtherSessions(userId: string): Promise<void> {
    await this.adminClient()
      .auth.admin.signOut(userId, 'others')
      .catch(() => undefined);
  }

  async listVerifiedFactors(session: AuthTokens) {
    const client = await this.sessionClient(session);
    const { data } = await client.auth.mfa.listFactors();
    return (data?.totp ?? []).filter((f) => f.status === 'verified').map((f) => ({ id: f.id }));
  }

  async enrollTotp(session: AuthTokens, label: string): Promise<TotpEnrollment> {
    const client = await this.sessionClient(session);
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: label,
    });
    if (error || !data) throw new AppError('SERVICE_UNAVAILABLE', 'MFA enrollment failed.');
    return { factorId: data.id, otpauthUri: data.totp.uri, secret: data.totp.secret };
  }

  async challengeTotp(session: AuthTokens, factorId: string) {
    const client = await this.sessionClient(session);
    const { data, error } = await client.auth.mfa.challenge({ factorId });
    if (error || !data) throw new AppError('MFA_REQUIRED', 'Could not start verification.');
    return { challengeId: data.id };
  }

  async verifyTotp(
    session: AuthTokens,
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<AuthTokens> {
    const client = await this.sessionClient(session);
    const { data, error } = await client.auth.mfa.verify({ factorId, challengeId, code });
    if (error || !data) throw new AppError('MFA_REQUIRED', 'The code is not valid.');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}
