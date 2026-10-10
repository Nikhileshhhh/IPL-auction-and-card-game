/**
 * pnpm data:photos -- [--version <dataVersionId>] [--limit N] [--dry-run]
 *
 * Finds freely licensed photos of real players in IPL franchise jersey
 * on Wikimedia Commons via Wikidata (ESPNcricinfo ID), re-encodes them and
 * registers them with full licence/author credit. Never scrapes official IPL,
 * BCCI or agency photos. Players without a free photo are listed for an admin
 * upload (S34). Requires network access to query.wikidata.org,
 * commons.wikimedia.org and upload.wikimedia.org.
 *
 * Env: DATABASE_URL (runtime role), MEDIA_STORAGE/MEDIA_DIR (or Supabase vars).
 */
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import { withTransaction } from '../../apps/server/src/db/transaction';
import {
  attributionFor,
  choosePhoto,
  commonsFileUrl,
  commonsSearchUrl,
  fetchAllowed,
  parseCommonsPages,
  parseWikidata,
  wikidataQuery,
  wikidataUrl,
  type CommonsCandidate,
} from '../../apps/server/src/modules/media/commons';
import { processPortrait } from '../../apps/server/src/modules/media/pipeline';
import { registerPortrait } from '../../apps/server/src/modules/media/service';
import { LocalDiskStorage, SupabaseStorage } from '../../apps/server/src/modules/media/storage';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const limit = Number(arg('--limit') ?? '100000');
const env = loadEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool({ connectionString: env.DATABASE_URL, max: 2 });
const storage =
  env.MEDIA_STORAGE === 'supabase'
    ? new SupabaseStorage(
        env.SUPABASE_URL ?? '',
        env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        env.MEDIA_BUCKET,
      )
    : new LocalDiskStorage(env.MEDIA_DIR);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const version =
  arg('--version') ??
  (
    await pool.query<{ id: string }>(
      `SELECT id FROM app_private.data_versions WHERE kind = 'factual' AND status = 'draft'
        ORDER BY created_at DESC LIMIT 1`,
    )
  ).rows[0]?.id;
if (!version) throw new Error('No factual draft version found; import Cricsheet data first.');

const players = (
  await pool.query<{
    id: string;
    name: string;
    reviewed: boolean;
    team: string | null;
    cricinfo: string | null;
  }>(
    `SELECT p.id, p.canonical_name AS name, p.role_reviewed AS reviewed, ps.team_name AS team, e.external_id AS cricinfo
       FROM app_private.player_seasons ps
       JOIN app_private.players p ON p.id = ps.player_id
       LEFT JOIN app_private.player_external_ids e ON e.player_id = p.id AND e.source = 'cricinfo'
      WHERE ps.data_version_id = $1 AND ps.portrait_asset_id IS NULL
      ORDER BY p.canonical_name LIMIT $2`,
    [version, limit],
  )
).rows;
console.warn(`${players.length} players without an approved photo in version ${version}.`);

// 1. Wikidata: full English names + their main image, in batches of 80.
const wd = new Map<string, { label: string | null; imageFile: string | null }>();
const withIds = players.filter((p) => p.cricinfo);
for (let i = 0; i < withIds.length; i += 80) {
  const batch = withIds.slice(i, i + 80).map((p) => p.cricinfo as string);
  try {
    for (const person of parseWikidata(
      await fetchAllowed(wikidataUrl(wikidataQuery(batch)), 'json'),
    )) {
      wd.set(person.cricinfo, person);
    }
  } catch (error) {
    console.error(`Wikidata lookup failed: ${(error as Error).message}`);
    console.error(
      'Allow query.wikidata.org, commons.wikimedia.org and upload.wikimedia.org in the network settings.',
    );
    process.exit(1);
  }
  await sleep(500);
}

const report = { found: 0, iplKit: 0, missing: [] as string[] };
for (const p of players) {
  const info = p.cricinfo ? wd.get(p.cricinfo) : undefined;
  const fullName = info?.label ?? p.name;
  const candidates: CommonsCandidate[] = [];
  try {
    // Only IPL-context photos qualify (ADR-019), so search for those alone.
    for (const q of [`"${fullName}" "${p.team ?? 'Indian Premier League'}"`, `"${fullName}" IPL`]) {
      candidates.push(...parseCommonsPages(await fetchAllowed(commonsSearchUrl(q), 'json')));
      await sleep(1500);
    }
    if (info?.imageFile) {
      candidates.push(
        ...parseCommonsPages(await fetchAllowed(commonsFileUrl(info.imageFile), 'json')),
      );
    }
  } catch (error) {
    console.error(`${fullName}: search failed (${(error as Error).message})`);
  }
  const choice = choosePhoto(candidates, fullName, p.team);
  // Strict (ADR-019): only photos in IPL franchise context count; others go to the player sheet.
  if (!choice || !choice.iplKit) {
    report.missing.push(fullName);
    continue;
  }
  report.found += 1;
  if (choice.iplKit) report.iplKit += 1;
  console.warn(
    `${fullName}: ${choice.candidate.pageUrl} (${choice.candidate.licence}${choice.iplKit ? ', IPL kit' : ''})`,
  );
  if (dryRun) continue;
  try {
    const bytes = (await fetchAllowed(choice.candidate.thumbUrl, 'bytes')) as Buffer;
    const image = await processPortrait(bytes, { maxBytes: 8 * 1024 * 1024 });
    await withTransaction(pool, async (tx) => {
      if (info?.label && !p.reviewed) {
        await tx.query(
          `UPDATE app_private.players SET canonical_name = $2, updated_at = now() WHERE id = $1`,
          [p.id, info.label.slice(0, 80)],
        );
      }
      await registerPortrait(tx, storage, p.id, image, {
        basis: 'free-license',
        status: 'approved',
        altText: `Photo of ${fullName} in IPL jersey`,
        iplKit: true,
        attribution: attributionFor(choice.candidate),
        licenceLabel: choice.candidate.licence.slice(0, 80),
        licenceUrl: choice.candidate.licenceUrl?.startsWith('https://')
          ? choice.candidate.licenceUrl
          : null,
        author: choice.candidate.artist.slice(0, 200),
        sourcePageUrl: choice.candidate.pageUrl,
      });
    });
  } catch (error) {
    console.error(`${fullName}: could not import (${(error as Error).message})`);
    report.missing.push(fullName);
    report.found -= 1;
  }
  await sleep(1500);
}
console.warn(
  `IPL jersey photos: ${report.found} imported, ${report.missing.length} still needed.` +
    (report.missing.length
      ? `\nAdd licensed IPL jersey photos via the player sheet (pnpm data:profiles) for: ${report.missing.join(', ')}`
      : ''),
);
await pool.end();
