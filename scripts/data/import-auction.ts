/**
 * pnpm data:auction [-- --fetch] [--version <published data version>] [--publish]
 *
 * Builds the real auction pool for the IPL mega-auction rules (ADR-024):
 * - previous franchise: the official IPL 2026 squads (iplt20.com squad feeds);
 * - current salary and registered base price: the Wikipedia lists of IPL 2025
 *   and 2026 personnel changes (retentions, auction sales, replacements), which
 *   cite ESPNcricinfo and the BCCI;
 * - capped/uncapped: Cricsheet international matches with the 5-year rule.
 * Players retained through both cycles have not registered a base price since
 * 2024; by the product owner's rule they enter at ₹2 cr when capped and ₹30 lakh
 * when uncapped, labelled "not registered since 2024". A reviewed overrides file
 * (data/sources/ipl-auction-base-price-overrides.csv) can set any player's price,
 * and data/sources/ipl-auction-capped-overrides.csv classifies players Cricsheet
 * cannot (it withholds every Afghanistan men's match).
 * Writes data/sources/ipl-auction-pool.csv for review.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  IPL_MEGA_RULES_2025_27 as RULES,
  LAKH,
  type CappedStatus,
  type PoolRole,
} from '@stumps/game-engines';
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import { one } from '../../apps/server/src/db/rows';
import { withTransaction } from '../../apps/server/src/db/transaction';
import {
  IPL_TEAM_SLUGS,
  matchHeadshots,
  nearName,
  normName,
  sameInitialSurname,
  squadFeedUrl,
  type PackPlayer,
  type SquadEntry,
} from '../../apps/server/src/modules/cricket-data/ipl-headshots';
import { parseCsv } from '../../apps/server/src/modules/cricket-data/sources';
import {
  WIKI_PAGES,
  cappedStatus,
  parseReplacements,
  parseRetained,
  parseSold,
  readInternationals,
  wikiPageUrl,
  wikiRawUrl,
  type SoldRow,
} from '../../apps/server/src/modules/auctions/sources';
import {
  insertRuleset,
  publishRuleset,
  type PoolEntryInput,
} from '../../apps/server/src/modules/auctions/rulesets';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fetch: { type: 'boolean', default: false },
    publish: { type: 'boolean', default: false },
    version: { type: 'string' },
  },
});
const env = loadEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const RAW = join('data', 'raw', 'auction');
const INTL = ['t20s_male_json.zip', 'odis_male_json.zip', 'tests_male_json.zip'];
const OVERRIDES = join('data', 'sources', 'ipl-auction-base-price-overrides.csv');
const CAPPED_OVERRIDES = join('data', 'sources', 'ipl-auction-capped-overrides.csv');
/** Product-owner rule (12 Oct 2026) for players with no registration since 2024. */
const UNREGISTERED_PRICE = { capped: 200n * LAKH, uncapped: 30n * LAKH } as const;
const REPORT = join('data', 'sources', 'ipl-auction-pool.csv');
const SQUAD_SEASON = 2026;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { 'user-agent': 'STUMPS-data-import/1.0 (auction pool; contact via repository)' };

async function download(url: string, file: string) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

interface FeedPlayer {
  team: string;
  name: string;
  country: string | null;
  overseas: boolean;
  iplPlayerId: number | null;
}

/** The squad list of one franchise from the IPL's own feed (every player, photo or not). */
function parseFeed(json: unknown, team: string): FeedPlayer[] {
  const list = (json as { data?: { squad?: { players?: unknown } } }).data?.squad?.players;
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[]).flatMap((p) => {
    const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 60) return [];
    const cc = typeof p.countryCode === 'string' ? p.countryCode.toUpperCase() : null;
    return [
      {
        team,
        name,
        country: cc && /^[A-Z]{2}$/.test(cc) ? cc : null,
        overseas: p.isInternational === true,
        iplPlayerId: typeof p.externalId === 'number' ? p.externalId : null,
      },
    ];
  });
}

const sameName = (a: string, b: string) =>
  normName(a) === normName(b) || sameInitialSurname(a, b) || nearName(a, b);

/** The unique row whose name matches, preferring an exact spelling. */
function findByName<T extends { name: string }>(rows: readonly T[], name: string): T | null {
  const exact = rows.filter((r) => normName(r.name) === normName(name));
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const close = rows.filter((r) => sameName(r.name, name));
  return close.length === 1 ? (close[0] ?? null) : null;
}

const lakhs = (r: bigint) => (r / LAKH).toString();
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const pool = createPool({ connectionString: env.DATABASE_URL, max: 2 });
try {
  await mkdir(RAW, { recursive: true });
  await mkdir(join('data', 'sources'), { recursive: true });
  // ---------------------------------------------------------------- sources
  for (const [season, title] of Object.entries(WIKI_PAGES)) {
    const file = join(RAW, `wp-${season}.wiki`);
    if (values.fetch || !existsSync(file)) {
      await download(wikiRawUrl(title), file);
      console.warn(`Fetched ${wikiPageUrl(title)}`);
      await sleep(3000);
    }
  }
  for (const zip of INTL) {
    const file = join(env.CRICSHEET_DIR, zip);
    if (values.fetch || !existsSync(file)) {
      await download(`https://cricsheet.org/downloads/${zip}`, file);
      console.warn(`Fetched Cricsheet ${zip}`);
    }
  }
  const feeds: FeedPlayer[] = [];
  for (const [team, slug] of IPL_TEAM_SLUGS) {
    const file = join(RAW, `squad-${SQUAD_SEASON}-${slug}.json`);
    if (values.fetch || !existsSync(file)) {
      await download(squadFeedUrl(slug, SQUAD_SEASON), file);
      await sleep(1500);
    }
    feeds.push(...parseFeed(JSON.parse(await readFile(file, 'utf8')), team));
  }
  console.warn(`IPL ${SQUAD_SEASON} squads: ${feeds.length} players`);

  const wiki = {
    2025: await readFile(join(RAW, 'wp-2025.wiki'), 'utf8'),
    2026: await readFile(join(RAW, 'wp-2026.wiki'), 'utf8'),
  };
  const retained26 = parseRetained(wiki[2026]);
  const sold26 = parseSold(wiki[2026], 2026);
  const repl26 = parseReplacements(wiki[2026]);
  const retained25 = parseRetained(wiki[2025]);
  const sold25 = parseSold(wiki[2025], 2025);
  const repl25 = parseReplacements(wiki[2025]);
  console.warn(
    `Wikipedia: 2026 ${retained26.length} retained, ${sold26.length} sold, ${repl26.length} replacements; ` +
      `2025 ${retained25.length} retained, ${sold25.length} sold, ${repl25.length} replacements`,
  );

  const intl = readInternationals(
    await Promise.all(INTL.map((z) => readFile(join(env.CRICSHEET_DIR, z)))),
  );
  console.warn(`Cricsheet internationals: ${intl.lastDate.size} players`);

  const overrides = new Map<string, { basePrice: bigint; note: string }>();
  if (existsSync(OVERRIDES)) {
    const [head, ...rows] = parseCsv(await readFile(OVERRIDES, 'utf8'));
    const at = (n: string) => head?.indexOf(n) ?? -1;
    for (const r of rows) {
      const team = r[at('team')] ?? '';
      const name = r[at('player')] ?? '';
      const lakh = Number(r[at('base_price_lakh')]);
      if (!name || !Number.isInteger(lakh) || lakh <= 0) continue;
      overrides.set(`${team}|${normName(name)}`, {
        basePrice: BigInt(lakh) * LAKH,
        note: r[at('source')] ?? '',
      });
    }
  }

  const cappedOverrides = new Map<string, { status: CappedStatus; source: string }>();
  if (existsSync(CAPPED_OVERRIDES)) {
    const [head, ...rows] = parseCsv(await readFile(CAPPED_OVERRIDES, 'utf8'));
    const at = (n: string) => head?.indexOf(n) ?? -1;
    for (const r of rows) {
      const status = r[at('capped_status')];
      if (status !== 'capped' && status !== 'uncapped') continue;
      cappedOverrides.set(`${r[at('team')] ?? ''}|${normName(r[at('player')] ?? '')}`, {
        status,
        source: r[at('source')] ?? '',
      });
    }
  }

  // ---------------------------------------------------------------- pack
  const version = (
    await pool.query<{ id: string }>(
      `SELECT id FROM app_private.data_versions
        WHERE kind = 'factual' AND status = 'published' AND ($1::uuid IS NULL OR id = $1::uuid)
        ORDER BY published_at DESC LIMIT 1`,
      [values.version ?? null],
    )
  ).rows[0];
  if (!version) throw new Error('No published factual data version; publish the real pack first.');
  const rows = (
    await pool.query<{
      id: string;
      name: string;
      team: string | null;
      cricsheet: string | null;
      country: string;
      role: PoolRole | null;
      primary_role: PoolRole;
    }>(
      `SELECT p.id, p.canonical_name AS name, ps.team_name AS team, e.external_id AS cricsheet,
              p.country_code AS country, ps.role, p.primary_role
         FROM app_private.player_seasons ps
         JOIN app_private.players p ON p.id = ps.player_id
         LEFT JOIN app_private.player_external_ids e ON e.player_id = p.id AND e.source = 'cricsheet'
        WHERE ps.data_version_id = $1
          AND EXISTS (SELECT 1 FROM app_private.card_players cp
                        JOIN app_private.card_definitions d ON d.id = cp.card_id
                       WHERE cp.player_id = p.id AND d.data_version_id = ps.data_version_id)`,
      [version.id],
    )
  ).rows;
  const franchises = new Map(
    (
      await pool.query<{ id: string; name: string }>(
        'SELECT id, name FROM app_private.franchises WHERE NOT is_fictional',
      )
    ).rows.map((f) => [f.name, f.id]),
  );
  const packPlayers: PackPlayer[] = rows.map((r) => ({ id: r.id, names: [r.name], team: r.team }));
  const entries: SquadEntry[] = feeds.map((f) => ({
    team: f.team,
    season: SQUAD_SEASON,
    name: f.name,
    headshotUrl: '',
    country: f.country,
    iplPlayerId: f.iplPlayerId,
  }));
  const matched = matchHeadshots(entries, packPlayers);
  const feedOf = new Map(entries.map((e, i) => [e, feeds[i] as FeedPlayer]));
  console.warn(
    `Matched ${matched.matches.length} squad players to the pack; ` +
      `${matched.unmatchedEntries.length + matched.ambiguous.length} squad players are not in the pack ` +
      `(no IPL appearance yet, so no card or photo).`,
  );

  // ---------------------------------------------------------------- pool
  const salaryRows = [
    ...retained26,
    ...sold26.map((s) => ({ ...s, salary: s.price })),
    ...repl26.map((r) => ({ ...r, salary: r.price })),
  ];
  // A replacement is signed from the registered auction list at his listed price.
  const asListing = (r: { team: string; name: string; price: bigint }): SoldRow => ({
    team: r.team,
    name: r.name,
    basePrice: r.price,
    price: r.price,
    category: null,
    previousTeam: null,
    rtm: false,
  });
  const lastListing = (name: string): { row: SoldRow; season: number; how: string } | null => {
    for (const [season, list, how] of [
      [2026, sold26, 'auction'],
      [2026, repl26.map(asListing), 'replacement signing'],
      [2025, sold25, 'auction'],
      [2025, repl25.map(asListing), 'replacement signing'],
    ] as const) {
      const row = findByName(list, name);
      if (row) return { row, season, how };
    }
    return null;
  };
  const sourceIds = await withTransaction(pool, async (tx) => {
    const add = async (
      publisher: string,
      url: string,
      licence: string,
      attribution: string,
      scope: string,
    ) =>
      one(
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.data_sources (publisher, url, fetched_at, licence_label, attribution,
             verification_status, scope)
           VALUES ($1, $2, now(), $3, $4, 'reviewed', $5) RETURNING id`,
          [publisher, url, licence, attribution, scope],
        ),
      ).id;
    return {
      wiki: await add(
        'Wikipedia (citing ESPNcricinfo and the BCCI)',
        wikiPageUrl(WIKI_PAGES[2026]),
        'CC BY-SA 4.0',
        'Wikipedia contributors, "List of 2025/2026 Indian Premier League personnel changes"',
        'Retained salaries, auction base prices and prices, replacements (IPL 2025 and 2026)',
      ),
    };
  });

  const report: string[][] = [];
  const pending: PoolEntryInput[] = [];
  const missing: string[] = [];
  for (const m of matched.matches) {
    const feed = feedOf.get(m.entry);
    const r = rows.find((x) => x.id === m.player.id);
    if (!feed || !r) continue;
    const franchiseId = franchises.get(feed.team) ?? null;
    const salaryRow = findByName(
      salaryRows.filter((s) => s.team === feed.team),
      feed.name,
    );
    const listing = lastListing(feed.name);
    const key = `${feed.team}|${normName(feed.name)}`;
    const override = overrides.get(key);
    const lastInternational = r.cricsheet ? (intl.lastDate.get(r.cricsheet) ?? null) : null;
    const overseas = feed.overseas || (feed.country ?? r.country) !== 'IN';
    const capped: CappedStatus =
      cappedOverrides.get(key)?.status ??
      cappedStatus({
        overseas,
        lastInternational,
        season: RULES.season,
        years: RULES.uncappedAfterYears,
        listedCategory: findByName(sold25, feed.name)?.category ?? listing?.row.category ?? null,
      });
    const unregistered = capped === 'unknown' ? null : UNREGISTERED_PRICE[capped];
    const basePrice = override?.basePrice ?? listing?.row.basePrice ?? unregistered;
    const role = r.role ?? r.primary_role;
    report.push([
      feed.name,
      r.cricsheet ?? '',
      feed.team,
      overseas ? 'yes' : 'no',
      role,
      capped,
      lastInternational ?? '',
      salaryRow ? lakhs(salaryRow.salary) : '',
      basePrice !== null ? lakhs(basePrice) : '',
      override
        ? `override: ${override.note}`
        : listing
          ? `IPL ${listing.season} ${listing.how}`
          : basePrice !== null
            ? 'not registered since 2024 (owner rule)'
            : '',
    ]);
    if (basePrice === null) {
      missing.push(`${feed.name} (${feed.team})`);
      continue;
    }
    pending.push({
      playerId: r.id,
      name: feed.name,
      role,
      previousFranchiseId: franchiseId,
      basePrice,
      cappedStatus: capped,
      overseas,
      currentSalary: salaryRow?.salary ?? null,
      priceSource: override || listing ? 'registered' : 'not_registered',
      sourceId: sourceIds.wiki,
    });
  }
  report.sort(
    (a, b) => (a[2] ?? '').localeCompare(b[2] ?? '') || (a[0] ?? '').localeCompare(b[0] ?? ''),
  );
  await writeFile(
    REPORT,
    [
      [
        'player',
        'cricsheet_id',
        'team_2026',
        'overseas',
        'role',
        'capped_status_2027',
        'last_international',
        'salary_2026_lakh',
        'base_price_lakh',
        'base_price_source',
      ],
      ...report,
    ]
      .map((r) => r.map(csvCell).join(','))
      .join('\n') + '\n',
  );
  const count = (s: CappedStatus) => pending.filter((p) => p.cappedStatus === s).length;
  console.warn(
    `Pool: ${pending.length} players with a base price (${count('capped')} capped, ${count('uncapped')} uncapped, ` +
      `${count('unknown')} unknown); ${pending.filter((p) => p.overseas).length} overseas. Report: ${REPORT}`,
  );
  if (missing.length) {
    console.warn(
      `${missing.length} squad players have no base price (status unknown, never registered):\n  ${missing.join('\n  ')}\n` +
        `Add them to ${OVERRIDES} (team,player,base_price_lakh,source) to include them.`,
    );
  }

  const rulesetId = await withTransaction(
    pool,
    async (tx) => {
      const id = await insertRuleset(tx, {
        rules: RULES,
        dataVersionId: version.id,
        sourceManifest: [
          ...RULES.sources,
          {
            title: 'List of 2026 Indian Premier League personnel changes',
            url: wikiPageUrl(WIKI_PAGES[2026]),
          },
          {
            title: 'List of 2025 Indian Premier League personnel changes',
            url: wikiPageUrl(WIKI_PAGES[2025]),
          },
          { title: 'IPL 2026 squads (iplt20.com)', url: 'https://www.iplt20.com/teams' },
          { title: 'Cricsheet international matches', url: 'https://cricsheet.org/downloads/' },
        ],
        entries: pending,
      });
      if (values.publish) {
        if (missing.length) {
          throw new Error(`Not published: ${missing.length} players have no base price.`);
        }
        await publishRuleset(tx, id);
      }
      return id;
    },
    { statementTimeoutMs: 30_000 },
  );
  console.warn(`Ruleset ${rulesetId} ${values.publish ? 'published' : 'saved as a draft'}.`);
} finally {
  await pool.end();
}
