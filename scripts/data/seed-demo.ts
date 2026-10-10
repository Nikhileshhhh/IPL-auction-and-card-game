/**
 * pnpm data:demo — import and publish the fictional demo pack (original
 * illustrated portraits) so card screens work offline in development and E2E.
 * Env: DATABASE_URL (runtime role), MEDIA_DIR. Real IPL data uses data:fetch +
 * the admin catalog instead.
 */
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import { publishVersion } from '../../apps/server/src/modules/cricket-data/publish';
import { importStatus, startImport } from '../../apps/server/src/modules/cricket-data/service';
import { LocalDiskStorage } from '../../apps/server/src/modules/media/storage';

export async function seedDemo(
  databaseUrl: string,
  mediaDir: string,
  cricsheetDir = 'data/raw/cricsheet',
) {
  const pool = createPool({ connectionString: databaseUrl, max: 3 });
  try {
    const existing = await pool.query(
      `SELECT 1 FROM app_private.data_versions WHERE kind = 'demo' AND status = 'published'`,
    );
    if (existing.rowCount) return 'already published';
    const job = await startImport(
      { pool, storage: new LocalDiskStorage(mediaDir), cricsheetDir },
      { kind: 'demo', label: 'Demo pack' },
      null,
    );
    await job.done;
    const status = await importStatus(pool, job.importId);
    if (status.status !== 'succeeded' || !status.dataVersionId) {
      throw new Error(`demo import failed: ${JSON.stringify(status.summary)}`);
    }
    await publishVersion(pool, status.dataVersionId, { prune: false, actorId: null });
    return `published ${String(status.summary.cards)} demo cards`;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  console.warn(await seedDemo(env.DATABASE_URL, env.MEDIA_DIR, env.CRICSHEET_DIR));
}
