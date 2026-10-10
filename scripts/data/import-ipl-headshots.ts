/**
 * pnpm data:headshots -- --licence "<reference>" --holder "<licence holder>"
 *                        [--credit "<credit line>"] [--version <id>] [--dry-run]
 * pnpm data:headshots -- --countries   (cricket nation from the IPL squads only, no photos)
 *
 * Imports the official IPL player headshots (each player in his franchise
 * jersey) for the players of a draft data version, under the operator's licence
 * (ADR-019 §2a). Licence reference and holder are required and recorded on every
 * photo. Reads only the constant squad feeds on www.iplt20.com for the version's
 * three seasons (latest season's headshot wins) and downloads only the IPL's own
 * player headshot assets. Also fills a missing country from the squad feed.
 * Env: DATABASE_URL (runtime role), MEDIA_* storage settings, CRICSHEET_DIR.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import {
  fetchSquadFeed,
  HEADSHOT_HOSTS,
  IPL_TEAM_SLUGS,
  matchBySeason,
  parseSquadFeed,
  preferredName,
  squadFeedUrl,
  squadPageUrl,
  type PackPlayer,
  type SquadEntry,
} from '../../apps/server/src/modules/cricket-data/ipl-headshots';
import {
  applyManifest,
  type ManifestRow,
} from '../../apps/server/src/modules/cricket-data/manifest';
import { CRICSHEET_FILES, parsePeople } from '../../apps/server/src/modules/cricket-data/sources';
import { LocalDiskStorage, SupabaseStorage } from '../../apps/server/src/modules/media/storage';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    licence: { type: 'string' },
    holder: { type: 'string' },
    credit: { type: 'string' },
    version: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    countries: { type: 'boolean', default: false },
  },
});
const countriesOnly = values.countries ?? false;
const licence = values.licence?.trim() ?? '';
const holder = values.holder?.trim() ?? '';
if (!countriesOnly && (!licence || !holder)) {
  console.error('Both --licence "<reference>" and --holder "<licence holder>" are required.');
  process.exit(1);
}
const credit = (values.credit?.trim() || `Photo: IPL, used under licence by ${holder}`).slice(
  0,
  300,
);
const env = loadEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool({ connectionString: env.DATABASE_URL, max: 2 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  const version = (
    await pool.query<{ id: string; year: number }>(
      `SELECT id, extract(year FROM cutoff_at)::int AS year FROM app_private.data_versions
        WHERE kind = 'factual' AND status = 'draft' AND ($1::uuid IS NULL OR id = $1::uuid)
        ORDER BY created_at DESC LIMIT 1`,
      [values.version ?? null],
    )
  ).rows[0];
  if (!version) throw new Error('No factual draft version found; run pnpm data:import first.');
  // The pack's three seasons, then up to five earlier ones as a same-franchise fallback
  // where the IPL has no headshot (placeholder) for a recent season.
  const window = new Set([version.year, version.year - 1, version.year - 2]);
  const seasons = Array.from({ length: 8 }, (_, i) => version.year - i);

  // Pack players with every known spelling (current name + Cricsheet register names).
  let register = new Map<string, { name: string; uniqueName: string }>();
  try {
    register = parsePeople(
      await readFile(join(env.CRICSHEET_DIR, CRICSHEET_FILES.people.file), 'utf8'),
    );
  } catch {
    /* register optional: current names still match */
  }
  const rows = (
    await pool.query<{
      id: string;
      name: string;
      team: string | null;
      cricsheet: string | null;
      country: string | null;
    }>(
      `SELECT p.id, p.canonical_name AS name, ps.team_name AS team, e.external_id AS cricsheet,
              p.country_code AS country
         FROM app_private.player_seasons ps
         JOIN app_private.players p ON p.id = ps.player_id
         LEFT JOIN app_private.player_external_ids e ON e.player_id = p.id AND e.source = 'cricsheet'
        WHERE ps.data_version_id = $1`,
      [version.id],
    )
  ).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const players: PackPlayer[] = rows.map((r) => {
    const reg = r.cricsheet ? register.get(r.cricsheet) : undefined;
    return {
      id: r.id,
      names: [...new Set([r.name, reg?.name, reg?.uniqueName].filter((n): n is string => !!n))],
      team: r.team,
    };
  });

  const entries: SquadEntry[] = [];
  for (const season of seasons) {
    for (const [team, slug] of IPL_TEAM_SLUGS) {
      try {
        const found = parseSquadFeed(
          await fetchSquadFeed(squadFeedUrl(slug, season)),
          team,
          season,
        );
        console.warn(`${season} ${team}: ${found.length} players with a headshot`);
        entries.push(...found);
      } catch (error) {
        const message = (error as Error).message;
        console.error(`${season} ${team}: could not read the squad (${message})`);
        if (message.includes('fetch failed')) {
          console.error('Allow www.iplt20.com in the network settings.');
          process.exit(1);
        }
      }
      await sleep(1000);
    }
  }

  const storage =
    env.MEDIA_STORAGE === 'supabase'
      ? new SupabaseStorage(
          env.SUPABASE_URL ?? '',
          env.SUPABASE_SERVICE_ROLE_KEY ?? '',
          env.MEDIA_BUCKET,
        )
      : new LocalDiskStorage(env.MEDIA_DIR);
  const slugOf = new Map(IPL_TEAM_SLUGS);
  const hasHeadshot = async () =>
    new Set(
      (
        await pool.query<{ id: string }>(
          `SELECT ps.player_id AS id FROM app_private.player_seasons ps
             JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id
            WHERE ps.data_version_id = $1 AND a.ipl_kit AND a.rights_basis = 'licensed'
              AND a.rights_status = 'approved'`,
          [version.id],
        )
      ).rows.map((r) => r.id),
    );

  // The IPL serves a silhouette placeholder (SVG) where a season has no headshot; the
  // media pipeline refuses it. Such entries are excluded and matching re-runs over all
  // players (so uniqueness still compares everyone) until no new photo arrives.
  const excluded = new Set<SquadEntry>();
  let result = matchBySeason(entries, players, { anyTeamSeasons: window });
  for (const m of result.matches) {
    console.warn(
      `  ${byId.get(m.player.id)?.name} ← ${m.entry.name} (${m.entry.season} ${m.entry.team}, ${m.how})`,
    );
  }
  let failed = new Map<string, string>();
  for (let round = 0; round < 12 && !values['dry-run']; round += 1) {
    const done = countriesOnly ? new Set<string>() : await hasHeadshot();
    const todo = result.matches.filter((m) => !done.has(m.player.id));
    if (todo.length === 0) break;
    const manifest: ManifestRow[] = todo.map((m, i) => ({
      line: i + 1,
      playerKey: m.player.id,
      fullName: countriesOnly
        ? preferredName(byId.get(m.player.id)?.name ?? '', m.entry.name)
        : null,
      // The IPL's own record is the cricket nation (England → GB, West Indies → WI).
      country: m.entry.country,
      battingStyle: null,
      bowlingStyle: undefined,
      photo: countriesOnly ? null : m.entry.headshotUrl,
      licence: countriesOnly ? null : licence.slice(0, 80),
      licenceHolder: countriesOnly ? null : holder.slice(0, 200),
      attribution: countriesOnly ? null : credit,
      sourceUrl: squadPageUrl(slugOf.get(m.entry.team) ?? ''),
    }));
    const report = await applyManifest(pool, storage, manifest, {
      allowedHosts: [...HEADSHOT_HOSTS, ...env.PHOTO_IMPORT_HOSTS],
      actorId: null,
    });
    console.warn(
      countriesOnly
        ? `Updated the cricket nation of ${report.updatedFacts} players.`
        : `Round ${round + 1}: imported ${report.photos} IPL jersey headshots.`,
    );
    if (countriesOnly || report.issues.length === 0) {
      failed = new Map();
      break;
    }
    failed = new Map(report.issues.map((i) => [i.playerKey, i.message]));
    const before = excluded.size;
    for (const m of todo) if (failed.has(m.player.id)) excluded.add(m.entry);
    if (excluded.size === before) break;
    result = matchBySeason(
      entries.filter((e) => !excluded.has(e)),
      players,
      { anyTeamSeasons: window },
    );
  }
  for (const [id, message] of failed) {
    console.warn(`  no usable headshot for ${byId.get(id)?.name ?? id}: ${message}`);
  }
  console.warn(
    `${values['dry-run'] ? '[dry run] ' : ''}Matched ${result.matches.length} of ${players.length} ` +
      `pack players to ${entries.length} squad headshots (${seasons.join(', ')}).`,
  );
  for (const a of result.ambiguous) {
    console.warn(
      `  ambiguous: ${a.entry.name} (${a.entry.season} ${a.entry.team}) could be ${a.candidates.join(' / ')}`,
    );
  }
  if (result.unmatchedPlayers.length) {
    console.warn(
      `No headshot found (supply via the player sheet or publish without them): ` +
        result.unmatchedPlayers.map((p) => byId.get(p.id)?.name).join(', '),
    );
  }
} finally {
  await pool.end();
}
