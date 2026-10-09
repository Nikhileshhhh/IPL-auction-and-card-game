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

/**
 * Auth adapter boundary (ADR-005, ADR-016). Phase 02 needs token verification;
 * phase 03 extends this interface with sign-in, invitation, recovery and MFA.
 */
export interface AuthProvider {
  readonly kind: 'supabase' | 'local';
  verifyAccessToken(token: string): Promise<VerifiedIdentity>;
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
