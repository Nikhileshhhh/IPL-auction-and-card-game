/**
 * pnpm data:profiles -- --template out.csv [--version <dataVersionId>]
 * pnpm data:profiles -- --manifest players.csv [--photos-dir ./photos]
 *
 * Player sheet (ADR-019): full name, country, batting and bowling style and a
 * licensed photo of each player in IPL franchise jersey. `photo` may be a
 * file path inside --photos-dir or an https URL on PHOTO_IMPORT_HOSTS.
 * Env: DATABASE_URL (runtime role), MEDIA_* storage settings.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import {
  applyManifest,
  manifestTemplate,
  parseManifest,
} from '../../apps/server/src/modules/cricket-data/manifest';
import { LocalDiskStorage, SupabaseStorage } from '../../apps/server/src/modules/media/storage';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const env = loadEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool({ connectionString: env.DATABASE_URL, max: 2 });

try {
  const templatePath = arg('--template');
  const manifestPath = arg('--manifest');
  if (templatePath) {
    const version =
      arg('--version') ??
      (
        await pool.query<{ id: string }>(
          `SELECT id FROM app_private.data_versions WHERE status = 'draft'
            ORDER BY (kind = 'factual') DESC, created_at DESC LIMIT 1`,
        )
      ).rows[0]?.id;
    if (!version) throw new Error('No draft data version found; import the IPL data first.');
    await writeFile(templatePath, await manifestTemplate(pool, version));
    console.warn(`Player sheet written to ${templatePath}. Fill it in and run with --manifest.`);
  } else if (manifestPath) {
    const parsed = parseManifest(await readFile(manifestPath, 'utf8'));
    const storage =
      env.MEDIA_STORAGE === 'supabase'
        ? new SupabaseStorage(
            env.SUPABASE_URL ?? '',
            env.SUPABASE_SERVICE_ROLE_KEY ?? '',
            env.MEDIA_BUCKET,
          )
        : new LocalDiskStorage(env.MEDIA_DIR);
    const photosDir = arg('--photos-dir');
    const report = await applyManifest(pool, storage, parsed.rows, {
      ...(photosDir ? { photosDir } : {}),
      allowedHosts: env.PHOTO_IMPORT_HOSTS,
      actorId: null,
    });
    const issues = [...parsed.issues, ...report.issues].sort((a, b) => a.line - b.line);
    console.warn(
      `${report.updatedFacts} players updated, ${report.photos} IPL jersey photos imported.`,
    );
    for (const i of issues) console.warn(`  line ${i.line} (${i.playerKey}): ${i.message}`);
    if (issues.length) process.exitCode = 1;
  } else {
    console.warn(
      'Usage: pnpm data:profiles -- --template out.csv | --manifest sheet.csv [--photos-dir dir]',
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
