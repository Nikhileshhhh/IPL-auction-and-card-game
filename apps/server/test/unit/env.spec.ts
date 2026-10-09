import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';

describe('loadEnv', () => {
  it('applies safe development defaults', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_POOL_MAX).toBe(5);
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('parses a comma separated origin allowlist', () => {
    const env = loadEnv({ ALLOWED_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.ALLOWED_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects production without a database or with insecure origins', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', APP_ORIGIN: 'http://play.test' })).toThrow(
      /DATABASE_URL: required in production.*ALLOWED_ORIGINS: production origins must use https/,
    );
  });

  it('never echoes variable values in errors', () => {
    const secret = 'postgres://user:super-secret-password@db/x';
    try {
      loadEnv({ DATABASE_URL: secret, PORT: 'not-a-port' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-password');
      expect((error as Error).message).toContain('PORT');
    }
  });

  it('bounds the pool size', () => {
    expect(() => loadEnv({ DATABASE_POOL_MAX: '500' })).toThrow(/DATABASE_POOL_MAX/);
  });
});
