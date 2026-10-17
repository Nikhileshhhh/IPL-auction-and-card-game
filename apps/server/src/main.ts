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
import { startRoomWorkers } from './jobs/room-workers';
import { createRoomRuntime } from './modules/rooms/runtime';
import { LocalDiskStorage, SupabaseStorage, type MediaStorage } from './modules/media/storage';
import { failInterruptedImports } from './modules/cricket-data/service';
import { OutboxDispatcher } from './realtime/dispatcher';
import {
  evictFromRoom,
  joinStream,
  notifyRecovering,
  registerRoomSockets,
} from './realtime/rooms-socket';
import type { ServerEnv } from './config/env';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createMediaStorage(env: ServerEnv): MediaStorage {
  if (env.MEDIA_STORAGE === 'supabase') {
    return new SupabaseStorage(
      requireValue(env.SUPABASE_URL, 'SUPABASE_URL'),
      requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
      env.MEDIA_BUCKET,
    );
  }
  return new LocalDiskStorage(env.MEDIA_DIR);
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
    ? createPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX }, () =>
        console.warn('database connection dropped; reconnecting on demand'),
      )
    : undefined;

  // Without a database only liveness/readiness are served (readiness fails closed).
  const secrets = pool ? loadSecrets(env) : undefined;
  const runtime =
    pool && secrets
      ? {
          env,
          pool,
          secrets,
          auth: createAuthProvider(env, pool),
          bus: new SecurityBus(),
          rooms: createRoomRuntime(pool, secrets),
          media: createMediaStorage(env),
        }
      : undefined;
  const instanceId = randomUUID();

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

  // Rooms: durable outbox → Socket.IO, fenced deadline workers, presence sweep.
  let stopRooms: () => Promise<void> = async () => undefined;
  if (runtime) {
    await failInterruptedImports(runtime.pool).catch(() => undefined);
    const outbox = new OutboxDispatcher(runtime.pool, io);
    runtime.rooms.bind({
      wake: outbox.wake,
      onMemberRemoved: (roomId, memberId) => evictFromRoom(io, roomId, memberId),
      onRoomClosed: (roomId) => evictFromRoom(io, roomId),
      onStreamGranted: (roomId, memberId, streamId) => joinStream(io, roomId, memberId, streamId),
    });
    registerRoomSockets(io, {
      pool: runtime.pool,
      secrets: runtime.secrets,
      rooms: runtime.rooms.deps,
      commands: runtime.rooms.commands,
      instanceId,
      ...(runtime.rooms.gameProjector ? { gameProjector: runtime.rooms.gameProjector } : {}),
    });
    outbox.start();
    const stopWorkers = startRoomWorkers({
      pool: runtime.pool,
      rooms: runtime.rooms,
      instanceId,
      onError: () => app.log.warn('room worker pass failed'),
      media: runtime.media,
      // Cleanup logs carry no room content (ADR-030); sockets get only the notice.
      onRoomClosed: (roomId, notice) => evictFromRoom(io, roomId, undefined, notice),
      onRecovered: (rooms) => {
        app.log.warn({ rooms: rooms.length }, 'recovery pause after coordinator outage');
        for (const r of rooms) {
          notifyRecovering(io, r.roomId, {
            reason: 'SERVER_RESTART',
            reconnectAfterMs: Math.max(0, r.until.getTime() - Date.now()),
            recoveryGeneration: r.generation,
          });
        }
      },
    });
    stopRooms = async () => {
      outbox.stop();
      await stopWorkers();
    };
  }

  await app.listen({ host: env.HOST, port: env.PORT });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'draining');
    stopCleanup();
    await stopRooms();
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
