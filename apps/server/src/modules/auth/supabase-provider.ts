import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../../http/app-error';
import { identityFromClaims, type AuthProvider, type VerifiedIdentity } from './provider';

export interface SupabaseProviderOptions {
  /** Pinned issuer, e.g. https://<project>.supabase.co/auth/v1 */
  issuer: string;
  /** Pinned JWKS URL; never derived from a token header. */
  jwksUrl?: string;
  /** Injectable key resolver for tests. */
  keys?: JWTVerifyGetKey;
}

/** Production adapter: verifies Supabase-issued asymmetric JWTs against pinned JWKS. */
export class SupabaseAuthProvider implements AuthProvider {
  readonly kind = 'supabase' as const;
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly options: SupabaseProviderOptions) {
    if (options.keys) this.keys = options.keys;
    else if (options.jwksUrl) this.keys = createRemoteJWKSet(new URL(options.jwksUrl));
    else throw new Error('SupabaseAuthProvider requires jwksUrl');
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
}
