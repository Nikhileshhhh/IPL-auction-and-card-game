import type pg from 'pg';

export interface CheckResult {
  ok: boolean;
  detail?: string;
}

export interface ReadinessCheck {
  name: string;
  run(): Promise<CheckResult>;
}

/** Fails closed when no database is configured: liveness is not readiness. */
export function databaseCheck(pool: pg.Pool | undefined): ReadinessCheck {
  return {
    name: 'database',
    async run() {
      if (!pool) return { ok: false, detail: 'DATABASE_URL not configured' };
      try {
        await pool.query('SELECT 1');
        return { ok: true };
      } catch {
        return { ok: false, detail: 'database unreachable' };
      }
    },
  };
}

export async function runChecks(checks: readonly ReadinessCheck[], timeoutMs = 2_000) {
  return Promise.all(
    checks.map(async (check) => {
      const timeout = new Promise<CheckResult>((resolve) =>
        setTimeout(() => resolve({ ok: false, detail: 'timed out' }), timeoutMs).unref(),
      );
      const result = await Promise.race([
        check.run().catch((): CheckResult => ({ ok: false, detail: 'check failed' })),
        timeout,
      ]);
      return { name: check.name, ...result };
    }),
  );
}
