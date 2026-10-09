import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withTransaction, dbNow } from '../../apps/server/src/db/transaction';
import { AppError } from '../../apps/server/src/http/app-error';
import { connect, databaseUrlFor, resetDatabase, runtimeUrl } from '../support/db';

const DB = 'stumps_it_tx';
let pool: pg.Pool;
let admin: pg.Client;

beforeAll(async () => {
  await resetDatabase(DB);
  admin = await connect(databaseUrlFor(DB));
  // Scratch table owned by the test (not an application table).
  await admin.query('CREATE TABLE public.tx_probe (id int PRIMARY KEY, v int NOT NULL)');
  await admin.query('INSERT INTO public.tx_probe VALUES (1, 0), (2, 0)');
  await admin.query('GRANT SELECT, UPDATE ON public.tx_probe TO app_runtime');
  pool = new pg.Pool({ connectionString: runtimeUrl(DB), max: 4 });
});

afterAll(async () => {
  await pool?.end();
  await admin?.end();
});

describe('withTransaction', () => {
  it('commits on success and rolls back on failure', async () => {
    await withTransaction(pool, (tx) => tx.query('UPDATE public.tx_probe SET v = 5 WHERE id = 1'));
    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query('UPDATE public.tx_probe SET v = 99 WHERE id = 1');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const res = await admin.query('SELECT v FROM public.tx_probe WHERE id = 1');
    expect(res.rows[0]).toEqual({ v: 5 });
  });

  it('retries a real deadlock and both units of work eventually commit exactly once', async () => {
    await admin.query('UPDATE public.tx_probe SET v = 0');
    let attempts = 0;
    const barrier = (() => {
      let release!: () => void;
      let count = 0;
      const ready = new Promise<void>((r) => (release = r));
      return async () => {
        count += 1;
        if (count === 2) release();
        await ready;
      };
    })();
    const work = (first: number, second: number) =>
      withTransaction(
        pool,
        async (tx) => {
          attempts += 1;
          await tx.query('UPDATE public.tx_probe SET v = v + 1 WHERE id = $1', [first]);
          if (attempts <= 2) await barrier();
          await tx.query('UPDATE public.tx_probe SET v = v + 1 WHERE id = $1', [second]);
        },
        { lockTimeoutMs: 5_000, statementTimeoutMs: 10_000, sleep: async () => undefined },
      );
    await Promise.all([work(1, 2), work(2, 1)]);
    expect(attempts).toBeGreaterThanOrEqual(3); // one transaction was chosen as deadlock victim and retried
    const res = await admin.query('SELECT id, v FROM public.tx_probe ORDER BY id');
    expect(res.rows).toEqual([
      { id: 1, v: 2 },
      { id: 2, v: 2 },
    ]);
  });

  it('a held lock surfaces SERVICE_UNAVAILABLE after lock_timeout instead of hanging', async () => {
    const blocker = await connect(databaseUrlFor(DB));
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM public.tx_probe WHERE id = 1 FOR UPDATE');
    try {
      const error = await withTransaction(
        pool,
        (tx) => tx.query('UPDATE public.tx_probe SET v = 1 WHERE id = 1'),
        {
          lockTimeoutMs: 200,
        },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('SERVICE_UNAVAILABLE');
      expect((error as AppError).details).toEqual({ reason: 'lock_timeout' });
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });

  it('dbNow reads the database clock inside the transaction', async () => {
    const before = Date.now();
    const now = await withTransaction(pool, (tx) => dbNow(tx));
    expect(Math.abs(now.getTime() - before)).toBeLessThan(5_000);
  });

  it('an unreachable database fails closed as SERVICE_UNAVAILABLE', async () => {
    const dead = new pg.Pool({
      connectionString: 'postgres://nobody@127.0.0.1:1/none',
      connectionTimeoutMillis: 500,
    });
    const error = await withTransaction(dead, (tx) => tx.query('SELECT 1')).catch(
      (e: unknown) => e,
    );
    expect((error as AppError).code).toBe('SERVICE_UNAVAILABLE');
    await dead.end();
  });
});
