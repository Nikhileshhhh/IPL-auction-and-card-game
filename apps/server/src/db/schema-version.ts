import type pg from 'pg';
import type { ReadinessCheck } from '../http/readiness';

/**
 * Latest migration this build requires. Expand/contract rollouts allow the
 * database to be newer than the code, never older.
 */
export const REQUIRED_MIGRATION = '045_catalog_media_ratings';

export function schemaCheck(
  pool: pg.Pool | undefined,
  required = REQUIRED_MIGRATION,
): ReadinessCheck {
  return {
    name: 'schema',
    async run() {
      if (!pool) return { ok: false, detail: 'DATABASE_URL not configured' };
      try {
        const result = await pool.query<{ id: string }>(
          'SELECT id FROM app_meta.schema_migrations ORDER BY id DESC LIMIT 1',
        );
        const latest = result.rows[0]?.id;
        if (!latest) return { ok: false, detail: 'no migrations applied' };
        if (latest < required)
          return { ok: false, detail: `schema ${latest} older than required ${required}` };
        return { ok: true };
      } catch {
        return { ok: false, detail: 'migration ledger unavailable' };
      }
    },
  };
}
