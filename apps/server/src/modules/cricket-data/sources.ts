import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import {
  aggregateMatches,
  DEMO_TEAMS,
  findLegends,
  generateDemoLeague,
  type CatalogPlan,
  type CricsheetMatch,
  type LegendOverride,
} from '@stumps/game-engines';
import { AppError } from '../../http/app-error';
import type { ImportBundle } from './import';

/** Allowlisted Cricsheet downloads (scripts/data/fetch-cricsheet.ts); never user-supplied URLs. */
export const CRICSHEET_FILES = {
  matches: { file: 'ipl_json.zip', url: 'https://cricsheet.org/downloads/ipl_json.zip' },
  people: { file: 'people.csv', url: 'https://cricsheet.org/register/people.csv' },
} as const;

export const CRICSHEET_LICENCE = 'ODC-By 1.0 (Open Data Commons Attribution)';
export const CRICSHEET_ATTRIBUTION =
  'Ball-by-ball data from Cricsheet (cricsheet.org), ODC-By 1.0.';

/** Factual team colours (text/hex only; no logos or emblems are reproduced). */
export const IPL_TEAM_COLOURS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['Chennai Super Kings', ['#F9CD05', '#0081E9']],
  ['Mumbai Indians', ['#004BA0', '#D1AB3E']],
  ['Royal Challengers Bengaluru', ['#EC1C24', '#2B2A29']],
  ['Royal Challengers Bangalore', ['#EC1C24', '#2B2A29']],
  ['Kolkata Knight Riders', ['#3A225D', '#B3A123']],
  ['Sunrisers Hyderabad', ['#FF822A', '#1A1A1A']],
  ['Rajasthan Royals', ['#EA1A85', '#254AA5']],
  ['Delhi Capitals', ['#17479E', '#EF1C25']],
  ['Punjab Kings', ['#DD1F2D', '#A7A9AC']],
  ['Gujarat Titans', ['#1B2133', '#B09862']],
  ['Lucknow Super Giants', ['#A72056', '#FFCC00']],
]);

/**
 * Platinum dual cards (ADR-020, product owner's list), by Cricsheet register ID.
 * A pair whose players are not both in the pack is skipped.
 */
export const IPL_DUAL_PAIRS: readonly { label: string; pair: readonly [string, string] }[] = [
  { label: 'Ro-Ko: Rohit Sharma & Virat Kohli', pair: ['740742ef', 'ba607b88'] },
  { label: 'Virat Kohli & MS Dhoni', pair: ['ba607b88', '4a8a2e3b'] },
  { label: 'MS Dhoni & Ravindra Jadeja', pair: ['4a8a2e3b', 'fe93fd9d'] },
  { label: 'Rohit Sharma & Jasprit Bumrah', pair: ['740742ef', '462411b3'] },
  { label: 'Sunil Narine & Andre Russell', pair: ['9d430b40', 'bbd41817'] },
  { label: 'Hardik Pandya & Suryakumar Yadav', pair: ['dbe50b21', '271f83cd'] },
  { label: 'Virat Kohli & AB de Villiers', pair: ['ba607b88', 'c4487b84'] },
  { label: 'MS Dhoni & Suresh Raina', pair: ['4a8a2e3b', '1dc12ab9'] },
  { label: 'Rohit Sharma & Kieron Pollard', pair: ['740742ef', 'a757b0d8'] },
  { label: 'Jasprit Bumrah & Lasith Malinga', pair: ['462411b3', 'a12e1d51'] },
];

/**
 * All-time greats who get legend cards without 100 matches for one franchise
 * (product owner, 11 October 2026), by Cricsheet register ID. Shown in the
 * franchise they played most for.
 */
export const IPL_EXTRA_LEGENDS: readonly { label: string; id: string }[] = [
  { label: 'Sachin Tendulkar', id: 'd2c2b2d5' },
  { label: 'Chris Gayle', id: 'db584dad' },
];

/**
 * Card values set by the product owner (12 October 2026, ADR-022 amendment),
 * in points (display × 10). Sachin Tendulkar alone: Batting 98 / 100 / 101 on
 * Normal / Silver / Gold, Bowling 20 and Runs 42 on all three.
 */
export const LEGEND_CARD_OVERRIDES: ReadonlyMap<string, LegendOverride> = new Map([
  [
    'd2c2b2d5',
    {
      normal: { batting: 980, bowling: 200, runs: 420 },
      silver: { batting: 1000, bowling: 200, runs: 420 },
      gold: { batting: 1010, bowling: 200, runs: 420 },
    },
  ],
]);

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.length > 0)) rows.push(row);
  return rows;
}

export interface CricsheetPerson {
  name: string;
  uniqueName: string;
  cricinfo: string | null;
}

export function parsePeople(csv: string): Map<string, CricsheetPerson> {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return new Map();
  const col = (name: string) => header.indexOf(name);
  const id = col('identifier');
  const name = col('name');
  const unique = col('unique_name');
  const cricinfo = col('key_cricinfo');
  const out = new Map<string, CricsheetPerson>();
  for (const r of rows) {
    const key = r[id];
    if (!key) continue;
    out.set(key, {
      name: r[name] ?? key,
      uniqueName: r[unique] || r[name] || key,
      cricinfo: cricinfo >= 0 && r[cricinfo] ? (r[cricinfo] as string) : null,
    });
  }
  return out;
}

export function parseMatchesZip(bytes: Uint8Array): CricsheetMatch[] {
  const files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.json') });
  const matches: CricsheetMatch[] = [];
  for (const [, data] of Object.entries(files)) {
    try {
      const parsed = JSON.parse(strFromU8(data)) as CricsheetMatch;
      if (parsed.info?.dates?.length && parsed.info.teams?.length === 2) matches.push(parsed);
    } catch {
      // A malformed file is skipped and counted by the caller via matches.length.
    }
  }
  return matches;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Build an import bundle from a downloaded Cricsheet IPL archive. */
export async function cricsheetBundle(
  dir: string,
  options: { label: string; latestSeason?: number },
): Promise<ImportBundle & { aliases: Map<string, { source: string; id: string }[]> }> {
  let zip: Buffer;
  let people: string;
  try {
    zip = await readFile(join(dir, CRICSHEET_FILES.matches.file));
    people = await readFile(join(dir, CRICSHEET_FILES.people.file), 'utf8');
  } catch {
    throw new AppError(
      'CONFIG_INVALID',
      'The Cricsheet archive is not downloaded yet. Run pnpm data:fetch on the server (needs cricsheet.org network access).',
      { reason: 'DATA_MISSING' },
    );
  }
  const matches = parseMatchesZip(zip);
  if (matches.length === 0)
    throw new AppError('CONFIG_INVALID', 'The Cricsheet archive contains no IPL matches.');
  const register = parsePeople(people);
  const all = aggregateMatches(matches);
  const seasons = [...new Set(all.seasons.map((s) => s.season))].sort((a, b) => a - b);
  const latest = options.latestSeason ?? seasons[seasons.length - 1];
  if (latest === undefined || !seasons.includes(latest)) {
    throw new AppError('CONFIG_INVALID', `Season ${String(latest)} is not in the archive.`);
  }
  const windowSeasons = seasons.filter((s) => s >= latest - 2 && s <= latest);
  const lastDate = matches
    .map((m) => [...m.info.dates].sort()[0] ?? '')
    .filter((d) => Number(d.slice(0, 4)) === latest)
    .sort()
    .pop();
  const cutoffDate = lastDate ?? `${latest}-12-31`;
  // Only data on or before the cutoff; later seasons never leak into a historical pack.
  const scoped = aggregateMatches(matches, { toDate: cutoffDate });
  const career = new Map<string, number>();
  for (const s of scoped.seasons)
    career.set(s.playerId, (career.get(s.playerId) ?? 0) + s.appearances);

  const names = new Map<string, { name: string; country?: string | null }>();
  const aliases = new Map<string, { source: string; id: string }[]>();
  for (const s of scoped.seasons) {
    if (names.has(s.playerId)) continue;
    const person = register.get(s.playerId);
    names.set(s.playerId, {
      name: person?.uniqueName ?? scoped.names.get(s.playerId) ?? s.playerId,
      country: null,
    });
    if (person?.cricinfo) aliases.set(s.playerId, [{ source: 'cricinfo', id: person.cricinfo }]);
  }
  const first = windowSeasons[0] ?? latest;
  // ADR-020: legends (100+ matches for one franchise, all seasons up to the cutoff),
  // plus the named all-time greats (ADR-022).
  // Retired legends join the pack on their own last three seasons, shown in the
  // franchise they are legends of.
  const legends = findLegends(scoped.seasons);
  // Named all-time greats join with their most-played franchise (any match count).
  const anyTeam = findLegends(scoped.seasons, 1);
  for (const { id } of IPL_EXTRA_LEGENDS) {
    const great = anyTeam.get(id);
    if (great && !legends.has(id)) legends.set(id, great);
  }
  const latestSeasonOf = new Map<string, number>();
  const teamOf = new Map<string, string>();
  for (const [id, legend] of legends) {
    if (legend.lastSeason < first) {
      latestSeasonOf.set(id, legend.lastSeason);
      teamOf.set(id, legend.team);
    }
  }
  return {
    kind: 'factual',
    catalogPlan: {
      legends: new Set(legends.keys()),
      duals: IPL_DUAL_PAIRS.map((d) => d.pair),
      overrides: LEGEND_CARD_OVERRIDES,
    },
    latestSeasonOf,
    teamOf,
    label: options.label,
    competition: 'IPL',
    externalSource: 'cricsheet',
    latestSeason: latest,
    cutoffDate,
    // ADR-022: card stats are whole IPL careers (from the first season) up to the cutoff.
    windowLabel: `IPL careers ${seasons[0]}–${latest}, as of ${fmtDate(cutoffDate)}`,
    source: {
      publisher: 'Cricsheet',
      url: CRICSHEET_FILES.matches.url,
      licence: CRICSHEET_LICENCE,
      attribution: CRICSHEET_ATTRIBUTION,
      checksum: createHash('sha256').update(zip).digest('hex'),
      scope: `IPL ball-by-ball, ${matches.length} matches, seasons ${seasons[0]}–${seasons[seasons.length - 1]}`,
    },
    aggregate: scoped,
    careerAppearances: career,
    people: names,
    teamColors: IPL_TEAM_COLOURS,
    fictional: false,
    aliases,
  };
}

/** The deterministic fictional league (offline demo pack and CI fixture). */
export function demoBundle(options: { label: string; seed?: number }): ImportBundle & {
  kits: Map<string, readonly [string, string]>;
} {
  const league = generateDemoLeague({ seed: options.seed ?? 2026, seasons: [2023, 2024, 2025] });
  const aggregate = aggregateMatches(league.matches);
  const career = new Map<string, number>();
  for (const s of aggregate.seasons)
    career.set(s.playerId, (career.get(s.playerId) ?? 0) + s.appearances);
  return {
    kind: 'demo',
    label: options.label,
    competition: 'Demo Premier League',
    externalSource: 'demo',
    latestSeason: 2025,
    cutoffDate: aggregate.lastDate ?? '2025-12-31',
    windowLabel: 'Demo league 2023–2025 (fictional players)',
    source: {
      publisher: 'STUMPS demo generator',
      url: 'stumps:demo-league/v1',
      licence: 'Original synthetic data',
      attribution: 'Fictional players and results generated by STUMPS.',
      scope: 'Fictional 8-team league, three seasons',
    },
    aggregate,
    careerAppearances: career,
    people: new Map(
      league.players.map((p) => [
        p.id,
        {
          name: p.name,
          country: p.country,
          battingStyle: p.battingStyle,
          bowlingStyle: p.bowlingStyle,
        },
      ]),
    ),
    teamColors: new Map(DEMO_TEAMS.map((t) => [t.name, t.kit])),
    fictional: true,
    // The fictional league is too young for 100-match legends; its four strongest
    // players stand in so every card type exists offline (ADR-020).
    catalogPlan: demoPlan(league.players),
    kits: new Map(league.players.map((p) => [p.id, p.kit])),
  };
}

function demoPlan(players: readonly { id: string; bat: number; bowl: number }[]): CatalogPlan {
  const top = [...players]
    .sort((a, b) => b.bat + b.bowl - (a.bat + a.bowl) || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map((p) => p.id);
  const [a, b, c, d] = top as [string, string, string, string];
  return {
    legends: new Set(top),
    duals: [
      [a, b],
      [c, d],
    ],
  };
}
