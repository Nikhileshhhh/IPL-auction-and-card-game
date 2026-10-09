import { jwtVerify } from 'jose';
import { AppError } from '../../http/app-error';
import { identityFromClaims, type AuthProvider, type VerifiedIdentity } from './provider';

export const LOCAL_AUTH_ISSUER = 'stumps-local-auth';

export interface LocalProviderOptions {
  nodeEnv: 'development' | 'test' | 'production';
  /** HS256 secret, at least 32 bytes. Dev/test only. */
  jwtSecret: string;
}

/**
 * Development/test Auth adapter (ADR-016). Refuses to exist in production so a
 * misconfiguration cannot silently swap in a home-grown password store.
 */
export class LocalAuthProvider implements AuthProvider {
  readonly kind = 'local' as const;
  protected readonly secret: Uint8Array;

  constructor(options: LocalProviderOptions) {
    if (options.nodeEnv === 'production') {
      throw new Error('LocalAuthProvider is disabled in production');
    }
    const secret = new TextEncoder().encode(options.jwtSecret);
    if (secret.byteLength < 32) throw new Error('LOCAL_AUTH_JWT_SECRET must be at least 32 bytes');
    this.secret = secret;
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
}
