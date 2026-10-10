/**
 * pnpm data:headshots -- --licence "<reference>" --holder "<licence holder>"
 *                        [--credit "<credit line>"] [--version <id>] [--dry-run]
 *
 * Imports the official IPL player headshots (players in franchise jersey) for
 * the players of a draft data version, under the operator's licence (ADR-019
 * §2a). Licence reference and holder are required and recorded on every photo.
 * Fetches only the ten constant squad pages on www.iplt20.com and headshots on
 * documents.iplt20.com; both must be allowed in the network settings.
 * Env: DATABASE_URL (runtime role), MEDIA_* storage settings, CRICSHEET_DIR.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import {
  fetchSquadHtml,
  HEADSHOT_HOSTS,
  IPL_SQUAD_PAGES,
  matchHeadshots,
  parseSquadPage,
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
  options: {
    licence: { type: 'string' },
    holder: { type: 'string' },
    credit: { type: 'string' },
    version: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const licence = values.licence?.trim();
const holder = values.holder?.trim();
if (!licence || !holder) {
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
  const version =
    values.version ??
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM app_private.data_versions WHERE kind = 'factual' AND status = 'draft'
          ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0]?.id;
  if (!version) throw new Error('No factual draft version found; run pnpm data:import first.');

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
    await pool.query<{ id: string; name: string; team: string | null; cricsheet: string | null }>(
      `SELECT p.id, p.canonical_name AS name, ps.team_name AS team, e.external_id AS cricsheet
         FROM app_private.player_seasons ps
         JOIN app_private.players p ON p.id = ps.player_id
         LEFT JOIN app_private.player_external_ids e ON e.player_id = p.id AND e.source = 'cricsheet'
        WHERE ps.data_version_id = $1`,
      [version],
    )
  ).rows;
  const players: PackPlayer[] = rows.map((r) => {
    const reg = r.cricsheet ? register.get(r.cricsheet) : undefined;
    return {
      id: r.id,
      names: [...new Set([r.name, reg?.name, reg?.uniqueName].filter((n): n is string => !!n))],
      team: r.team,
    };
  });

  const entries: SquadEntry[] = [];
  for (const page of IPL_SQUAD_PAGES) {
    try {
      const found = parseSquadPage(await fetchSquadHtml(page.url), page.team);
      console.warn(`${page.team}: ${found.length} headshots on the squad page`);
      entries.push(...found);
    } catch (error) {
      console.error(`${page.team}: could not read the squad page (${(error as Error).message})`);
      if ((error as Error).message.includes('fetch failed')) {
        console.error('Allow www.iplt20.com and documents.iplt20.com in the network settings.');
        process.exit(1);
      }
    }
    await sleep(1500);
  }

  const result = matchHeadshots(entries, players);
  const byName = new Map(rows.map((r) => [r.id, r.name]));
  for (const m of result.matches) {
    console.warn(`  ${byName.get(m.player.id)} ← ${m.entry.name} (${m.entry.team}, ${m.how})`);
  }
  if (!values['dry-run'] && result.matches.length > 0) {
    const storage =
      env.MEDIA_STORAGE === 'supabase'
        ? new SupabaseStorage(
            env.SUPABASE_URL ?? '',
            env.SUPABASE_SERVICE_ROLE_KEY ?? '',
            env.MEDIA_BUCKET,
          )
        : new LocalDiskStorage(env.MEDIA_DIR);
    const manifest: ManifestRow[] = result.matches.map((m, i) => ({
      line: i + 1,
      playerKey: m.player.id,
      fullName: null,
      country: null,
      battingStyle: null,
      bowlingStyle: undefined,
      photo: m.entry.headshotUrl,
      licence: licence.slice(0, 80),
      licenceHolder: holder.slice(0, 200),
      attribution: credit,
      sourceUrl: m.entry.profileUrl,
    }));
    const report = await applyManifest(pool, storage, manifest, {
      allowedHosts: [...HEADSHOT_HOSTS, ...env.PHOTO_IMPORT_HOSTS],
      actorId: null,
    });
    console.warn(`Imported ${report.photos} IPL jersey headshots.`);
    for (const i of report.issues) {
      console.warn(`  could not import ${byName.get(i.playerKey) ?? i.playerKey}: ${i.message}`);
    }
  }
  console.warn(
    `${values['dry-run'] ? '[dry run] ' : ''}Matched ${result.matches.length} of ${players.length} pack players ` +
      `to ${entries.length} squad headshots.`,
  );
  for (const a of result.ambiguous) {
    console.warn(
      `  ambiguous: ${a.entry.name} (${a.entry.team}) could be ${a.candidates.join(' / ')}`,
    );
  }
  if (result.unmatchedPlayers.length) {
    console.warn(
      `Not in a current squad (supply via the player sheet or publish without them): ` +
        result.unmatchedPlayers.map((p) => byName.get(p.id)).join(', '),
    );
  }
} finally {
  await pool.end();
}
