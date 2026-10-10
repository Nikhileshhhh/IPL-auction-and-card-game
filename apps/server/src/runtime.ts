import type pg from 'pg';
import type { ServerEnv } from './config/env';
import type { Secrets } from './config/secrets';
import type { AuthProvider } from './modules/auth/provider';
import type { SecurityBus } from './realtime/security-bus';
import type { RoomRuntime } from './modules/rooms/runtime';

/** Long-lived dependencies shared by feature modules. */
export interface RuntimeDeps {
  env: ServerEnv;
  pool: pg.Pool;
  secrets: Secrets;
  auth: AuthProvider;
  bus: SecurityBus;
  rooms: RoomRuntime;
}

export function redirectOrigin(env: ServerEnv): string {
  return env.AUTH_REDIRECT_ORIGIN ?? env.APP_ORIGIN;
}
