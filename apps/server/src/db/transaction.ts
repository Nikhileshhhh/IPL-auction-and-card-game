import type pg from 'pg';
import { AppError } from '../http/app-error';

/** Minimal parameterized query surface handed to transaction callbacks. */
export interface Tx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export type Isolation = 'read committed' | 'repeatable read' | 'serializable';

export interface TxOptions {
  isolation?: Isolation;
  readOnly?: boolean;
  /** SET LOCAL statement_timeout (default 3 s). */
  statementTimeoutMs?: number;
  /** SET LOCAL lock_timeout so a stuck room lock fails fast (default 2 s). */
  lockTimeoutMs?: number;
  /** Retries for deadlock/serialization failures (DB/realtime §3: at most 3). */
  maxRetries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_SQLSTATE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const UNAVAILABLE_SQLSTATE = new Set([
  '55P03',
  '57014',
  '08000',
  '08003',
  '08006',
  '57P01',
  '53300',
]);

function sqlState(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

export function isRetryableSqlError(error: unknown): boolean {
  const code = sqlState(error);
  return code !== undefined && RETRYABLE_SQLSTATE.has(code);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` inside one transaction with bounded timeouts. Deadlocks and
 * serialization failures are retried (same callback, so callers must keep
 * the same idempotency key) up to `maxRetries` with jittered backoff; then
 * the caller receives SERVICE_UNAVAILABLE. Lock/statement timeouts and lost
 * connections fail closed as SERVICE_UNAVAILABLE as well.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
  options: TxOptions = {},
): Promise<T> {
  const {
    isolation = 'read committed',
    readOnly = false,
    statementTimeoutMs = 3_000,
    lockTimeoutMs = 2_000,
    maxRetries = 3,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  for (let attempt = 0; ; attempt += 1) {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'Database unavailable.');
    }
    let released = false;
    try {
      await client.query(
        `BEGIN ISOLATION LEVEL ${isolation.toUpperCase()}${readOnly ? ' READ ONLY' : ''}`,
      );
      await client.query(
        `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)`,
        [`${Math.trunc(statementTimeoutMs)}ms`, `${Math.trunc(lockTimeoutMs)}ms`],
      );
      const result = await fn({
        query: (text, values) => client.query(text, values as unknown[] | undefined),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection is broken; release it as unusable below.
        client.release(true);
        released = true;
      }
      if (isRetryableSqlError(error) && attempt < maxRetries) {
        await sleep(Math.round(20 * 2 ** attempt * (0.5 + random())));
        continue;
      }
      if (isRetryableSqlError(error)) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'The server is busy. Retry with the same request.',
          {
            reason: 'contention',
          },
        );
      }
      const code = sqlState(error);
      if (code !== undefined && UNAVAILABLE_SQLSTATE.has(code)) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'The server is busy. Retry with the same request.',
          {
            reason: code === '55P03' ? 'lock_timeout' : 'database',
          },
        );
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }
}

/** Authoritative clock: database time read inside the current transaction (ADR-007). */
export async function dbNow(tx: Tx): Promise<Date> {
  const result = await tx.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const row = result.rows[0];
  if (!row) throw new AppError('INTERNAL', 'Clock unavailable.');
  return row.now;
}
