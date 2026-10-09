import { describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { LocalAuthProvider, LOCAL_AUTH_ISSUER, SupabaseAuthProvider } from '../../src/modules/auth';
import { AppError } from '../../src/http/app-error';

const USER = '9e21c15b-c550-4637-a0f5-00e200000001';
const SESSION = '9e21c15b-c550-4637-a0f5-00e200000002';
const ISSUER = 'https://project.supabase.test/auth/v1';
const SECRET = 'local-test-secret-that-is-at-least-32-bytes';

function claims(overrides: Record<string, unknown> = {}) {
  return {
    sub: USER,
    session_id: SESSION,
    aal: 'aal1',
    role: 'authenticated',
    email: 'u@example.test',
    ...overrides,
  };
}

async function expectUnauthenticated(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('UNAUTHENTICATED');
}

describe('SupabaseAuthProvider (pinned issuer + JWKS)', () => {
  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
    const provider = new SupabaseAuthProvider({
      issuer: ISSUER,
      keys: createLocalJWKSet({ keys: [jwk] }),
    });
    const sign = (
      payload: Record<string, unknown>,
      opts: { iss?: string; aud?: string; exp?: string | number } = {},
    ) =>
      new SignJWT(payload)
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(opts.iss ?? ISSUER)
        .setAudience(opts.aud ?? 'authenticated')
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? '5m')
        .sign(privateKey);
    return { provider, sign };
  }

  it('accepts a valid token and exposes identity only (no roles)', async () => {
    const { provider, sign } = await setup();
    const identity = await provider.verifyAccessToken(await sign(claims()));
    expect(identity).toMatchObject({ userId: USER, sessionId: SESSION, aal: 'aal1' });
    expect(Object.keys(identity).sort()).toEqual([
      'aal',
      'email',
      'expiresAt',
      'sessionId',
      'userId',
    ]);
  });

  it('ignores admin flags smuggled into metadata', async () => {
    const { provider, sign } = await setup();
    const identity = await provider.verifyAccessToken(
      await sign(
        claims({
          user_metadata: { isAdmin: true, role: 'super_admin' },
          app_metadata: { role: 'admin' },
        }),
      ),
    );
    expect(identity).not.toHaveProperty('isAdmin');
    expect(JSON.stringify(identity)).not.toContain('admin');
  });

  it('rejects wrong issuer, wrong audience, expired, service-role and malformed tokens', async () => {
    const { provider, sign } = await setup();
    await expectUnauthenticated(
      provider.verifyAccessToken(await sign(claims(), { iss: 'https://evil.test/auth/v1' })),
    );
    await expectUnauthenticated(provider.verifyAccessToken(await sign(claims(), { aud: 'other' })));
    await expectUnauthenticated(
      provider.verifyAccessToken(await sign(claims(), { exp: Math.floor(Date.now() / 1000) - 60 })),
    );
    await expectUnauthenticated(
      provider.verifyAccessToken(await sign(claims({ role: 'service_role' }))),
    );
    await expectUnauthenticated(
      provider.verifyAccessToken(await sign(claims({ session_id: undefined }))),
    );
    await expectUnauthenticated(provider.verifyAccessToken('not.a.jwt'));
  });

  it('rejects tokens signed by an unknown key and alg=none', async () => {
    const { provider } = await setup();
    const other = await generateKeyPair('ES256');
    const forged = await new SignJWT(claims())
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expectUnauthenticated(provider.verifyAccessToken(forged));
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ ...claims(), iss: ISSUER, aud: 'authenticated', exp: 9_999_999_999 }),
    ).toString('base64url')}.`;
    await expectUnauthenticated(provider.verifyAccessToken(unsigned));
  });

  it('rejects symmetric HS256 tokens even if the secret were known (algorithm pinning)', async () => {
    const { provider } = await setup();
    const hs = await new SignJWT(claims())
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    await expectUnauthenticated(provider.verifyAccessToken(hs));
  });
});

describe('LocalAuthProvider (dev/test only)', () => {
  it('refuses to construct in production or with a short secret', () => {
    expect(() => new LocalAuthProvider({ nodeEnv: 'production', jwtSecret: SECRET })).toThrow(
      /production/,
    );
    expect(() => new LocalAuthProvider({ nodeEnv: 'test', jwtSecret: 'short' })).toThrow(
      /32 bytes/,
    );
  });

  it('verifies its own HS256 tokens and rejects foreign issuers', async () => {
    const provider = new LocalAuthProvider({ nodeEnv: 'test', jwtSecret: SECRET });
    const key = new TextEncoder().encode(SECRET);
    const good = await new SignJWT(claims({ aal: 'aal2' }))
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(LOCAL_AUTH_ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(key);
    expect((await provider.verifyAccessToken(good)).aal).toBe('aal2');
    const foreign = await new SignJWT(claims())
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('someone-else')
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(key);
    await expectUnauthenticated(provider.verifyAccessToken(foreign));
  });
});
