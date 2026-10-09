import { loadEnv } from './config/env';
import { loadSecrets } from './config/secrets';
import { buildApp } from './app';
import { createPool } from './db/pool';
import { databaseCheck } from './http/readiness';
import { attachGateway } from './realtime/gateway';
import { schemaCheck } from './db/schema-version';
import { LocalAuthProvider, SupabaseAuthProvider, type AuthProvider } from './modules/auth';
import { SecurityBus } from './realtime/security-bus';
import { startSecurityCleanup } from './jobs/security-cleanup';
import type { ServerEnv } from './config/env';
import type pg from 'pg';

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createAuthProvider(env: ServerEnv, pool: pg.Pool): AuthProvider {
  if (env.AUTH_PROVIDER === 'supabase') {
    return new SupabaseAuthProvider({
      issuer: requireValue(env.SUPABASE_JWT_ISSUER, 'SUPABASE_JWT_ISSUER'),
      jwksUrl: requireValue(env.SUPABASE_JWKS_URL, 'SUPABASE_JWKS_URL'),
      ...(env.SUPABASE_URL ? { url: env.SUPABASE_URL } : {}),
      ...(env.SUPABASE_PUBLISHABLE_KEY ? { publishableKey: env.SUPABASE_PUBLISHABLE_KEY } : {}),
      ...(env.SUPABASE_SERVICE_ROLE_KEY ? { serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY } : {}),
    });
  }
  if (env.AUTH_PROVIDER === 'local') {
    return new LocalAuthProvider({
      nodeEnv: env.NODE_ENV,
      jwtSecret: requireValue(env.LOCAL_AUTH_JWT_SECRET, 'LOCAL_AUTH_JWT_SECRET'),
      pool,
    });
  }
  throw new Error('AUTH_PROVIDER must be set to supabase or local');
}

async function main() {
  const env = loadEnv();
  const pool = env.DATABASE_URL
    ? createPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX })
    : undefined;

  // Without a database only liveness/readiness are served (readiness fails closed).
  const runtime = pool
    ? {
        env,
        pool,
        secrets: loadSecrets(env),
        auth: createAuthProvider(env, pool),
        bus: new SecurityBus(),
      }
    : undefined;

  const app = await buildApp({
    env,
    readinessChecks: [databaseCheck(pool), schemaCheck(pool)],
    ...(runtime ? { runtime } : {}),
  });
  const io = attachGateway(app.server, {
    allowedOrigins: env.ALLOWED_ORIGINS,
    ...(pool ? { pool } : {}),
    ...(runtime ? { bus: runtime.bus } : {}),
  });
  const stopCleanup = pool
    ? startSecurityCleanup(pool, 5 * 60_000, () => app.log.warn('security cleanup sweep failed'))
    : () => undefined;

  await app.listen({ host: env.HOST, port: env.PORT });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'draining');
    stopCleanup();
    await io.close();
    await app.close();
    await pool?.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Environment errors list variable names only, never values.
  console.error(error instanceof Error ? error.message : 'startup failed');
  process.exit(1);
});
