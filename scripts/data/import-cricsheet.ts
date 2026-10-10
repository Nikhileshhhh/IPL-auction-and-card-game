/**
 * pnpm data:import [-- --season 2026] — import the downloaded Cricsheet IPL
 * archive (pnpm data:fetch) as a draft data version, same as the admin
 * catalog's "Import IPL data". Publishing stays an admin decision (ADR-019:
 * every card needs a licensed photo in IPL jersey and complete facts first).
 * Env: DATABASE_URL (runtime role), MEDIA_DIR, CRICSHEET_DIR.
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import { importStatus, startImport } from '../../apps/server/src/modules/cricket-data/service';
import { validateVersion } from '../../apps/server/src/modules/cricket-data/validate';
import { withTransaction } from '../../apps/server/src/db/transaction';
import { LocalDiskStorage } from '../../apps/server/src/modules/media/storage';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { season: { type: 'string' }, label: { type: 'string' } },
});
const env = loadEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const latestSeason = values.season ? Number(values.season) : undefined;
if (latestSeason !== undefined && !Number.isInteger(latestSeason))
  throw new Error('--season must be a year such as 2026');

const pool = createPool({ connectionString: env.DATABASE_URL, max: 3 });
try {
  const job = await startImport(
    { pool, storage: new LocalDiskStorage(env.MEDIA_DIR), cricsheetDir: env.CRICSHEET_DIR },
    {
      kind: 'cricsheet',
      label: values.label ?? 'IPL real-data pack',
      ...(latestSeason ? { latestSeason } : {}),
    },
    null,
  );
  await job.done;
  const status = await importStatus(pool, job.importId);
  if (status.status !== 'succeeded' || !status.dataVersionId) {
    console.error(`Import failed: ${JSON.stringify(status.summary)}`);
    process.exitCode = 1;
  } else {
    const versionId = status.dataVersionId;
    const report = await withTransaction(pool, (tx) => validateVersion(tx, versionId));
    console.warn(`Draft data version ${versionId}: ${JSON.stringify(status.summary)}`);
    console.warn(
      report.ok
        ? 'Ready to publish.'
        : `Before publishing:\n${report.problems.map((p) => `  ${p.code}: ${p.message} (${p.count})`).join('\n')}`,
    );
    console.warn(
      `Next: pnpm data:photos -- --version ${versionId}, then fill the player sheet (pnpm data:profiles -- --template sheet.csv --version ${versionId}).`,
    );
  }
} finally {
  await pool.end();
}
