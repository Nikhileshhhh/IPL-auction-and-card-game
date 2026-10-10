import pg from 'pg';

export interface PoolSettings {
  connectionString: string;
  max: number;
  applicationName?: string;
}

/**
 * Bounded pool (ADR-013): never one connection per socket. Statement and
 * idle-in-transaction timeouts protect the room lock from stuck clients.
 */
export function createPool(
  settings: PoolSettings,
  onIdleError: (error: Error) => void = () => undefined,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: settings.connectionString,
    max: settings.max,
    application_name: settings.applicationName ?? 'stumps-server',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
  });
  // An idle client dropped by the server (restart, failover, admin terminate)
  // must not crash the process; the pool discards it and reconnects on demand.
  pool.on('error', onIdleError);
  return pool;
}
