import { loadEnv } from './config/env';
import { buildApp } from './app';
import { createPool } from './db/pool';
import { databaseCheck } from './http/readiness';
import { attachGateway } from './realtime/gateway';
import { schemaCheck } from './db/schema-version';

async function main() {
  const env = loadEnv();
  const pool = env.DATABASE_URL
    ? createPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX })
    : undefined;

  const app = await buildApp({ env, readinessChecks: [databaseCheck(pool), schemaCheck(pool)] });
  const io = attachGateway(app.server, { allowedOrigins: env.ALLOWED_ORIGINS });

  await app.listen({ host: env.HOST, port: env.PORT });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'draining');
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
