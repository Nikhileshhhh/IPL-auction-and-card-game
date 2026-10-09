import { z } from 'zod';
import { AppError } from '../../http/app-error';

/** Identity proven by a verified Auth access token. Carries no roles. */
export interface VerifiedIdentity {
  userId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  email: string | undefined;
  expiresAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TotpEnrollment {
  factorId: string;
  otpauthUri: string;
  secret: string;
}

/**
 * Auth adapter boundary (ADR-005, ADR-016). The API never stores user
 * passwords itself; production delegates to Supabase Auth.
 */
export interface AuthProvider {
  readonly kind: 'supabase' | 'local';
  verifyAccessToken(token: string): Promise<VerifiedIdentity>;
  /** Throws BAD_CREDENTIALS generically. */
  signInWithPassword(email: string, password: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  signOut(identity: VerifiedIdentity, scope: 'local' | 'global'): Promise<void>;
  /** Sends an invitation email unless the address already has an account. */
  inviteUser(email: string, redirectTo: string): Promise<{ invited: boolean }>;
  /** Single-use email token (invite or recovery) → session. Throws CALLBACK_EXPIRED. */
  verifyEmailToken(tokenHash: string, type: 'invite' | 'recovery'): Promise<AuthTokens>;
  sendRecovery(email: string, redirectTo: string): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
  /** Revoke every Auth session for a user except, optionally, one. */
  revokeOtherSessions(userId: string, keepSessionId: string | undefined): Promise<void>;
  listVerifiedFactors(session: AuthTokens): Promise<{ id: string }[]>;
  enrollTotp(session: AuthTokens, label: string): Promise<TotpEnrollment>;
  challengeTotp(session: AuthTokens, factorId: string): Promise<{ challengeId: string }>;
  /** Verifies the code and returns an AAL2 session. Throws MFA_REQUIRED on failure. */
  verifyTotp(
    session: AuthTokens,
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<AuthTokens>;
}

/**
 * Only these claims are trusted. user_metadata/app_metadata are ignored: a
 * role or isAdmin flag inside a JWT never grants anything (master §6).
 */
const ClaimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  aal: z.enum(['aal1', 'aal2']),
  role: z.literal('authenticated'),
  exp: z.number().int().positive(),
  email: z.string().optional(),
});

export function identityFromClaims(payload: unknown): VerifiedIdentity {
  const parsed = ClaimsSchema.safeParse(payload);
  if (!parsed.success) throw new AppError('UNAUTHENTICATED', 'Sign in again.');
  return {
    userId: parsed.data.sub,
    sessionId: parsed.data.session_id,
    aal: parsed.data.aal,
    email: parsed.data.email,
    expiresAt: new Date(parsed.data.exp * 1000),
  };
}
