import type pg from 'pg';
import {
  buildCatalog,
  computeRatings,
  RATING_METRICS,
  RATINGS_MODEL_VERSION,
  type Aggregate,
  type PlayerRatings,
  type Role,
} from '@stumps/game-engines';
import { AppError } from '../../http/app-error';
import { one } from '../../db/rows';
import { withTransaction, type Tx } from '../../db/transaction';
import { approvedPortrait } from '../media/service';
import { validateVersion } from './validate';

export interface ImportSource {
  publisher: string;
  url: string;
  licence: string;
  attribution: string;
  checksum?: string | null;
  scope: string;
}

export interface ImportBundle {
  kind: 'demo' | 'factual';
  label: string;
  competition: string;
  /** Source of external IDs (`cricsheet` register IDs or `demo`). */
  externalSource: string;
  latestSeason: number;
  cutoffDate: string;
  windowLabel: string;
  source: ImportSource;
  aggregate: Aggregate;
  /** All-time appearances up to the cutoff (experience). */
  careerAppearances: ReadonlyMap<string, number>;
  people: ReadonlyMap<string, { name: string; country?: string | null }>;
  teamColors: ReadonlyMap<string, readonly [string, string]>;
  fictional: boolean;
  /** Extra identifiers per register ID (e.g. ESPNcricinfo keys used to find photos). */
  aliases?: ReadonlyMap<string, readonly { source: string; id: string }[]>;
}

export interface ImportResult {
  dataVersionId: string;
  players: number;
  cards: number;
  withPortrait: number;
  ratings: Map<string, PlayerRatings>;
  playerIds: Map<string, string>;
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'team';

const shortOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(2, 'X');

/** Fixed-point x100 → numeric string (exact), or null when unavailable. */
const x100 = (v: number | null) => (v === null ? null : (v / 100).toFixed(2));

/**
 * Build a new DRAFT data version from aggregated facts: players (deduplicated by
 * external register ID, never by name), franchises, season rows, raw statistics,
 * ratings (engine), and the card catalog. Reviewed role corrections from earlier
 * versions are honoured. Nothing here can touch a published version (triggers).
 */
export async function importDataVersion(
  pool: pg.Pool,
  bundle: ImportBundle,
): Promise<ImportResult> {
  return withTransaction(
    pool,
    async (tx) => {
      const source = one(
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.data_sources (publisher, url, fetched_at, licence_label, attribution,
             verification_status, checksum, scope)
           VALUES ($1, $2, now(), $3, $4, 'reviewed', $5, $6) RETURNING id`,
          [
            bundle.source.publisher,
            bundle.source.url,
            bundle.source.licence,
            bundle.source.attribution,
            bundle.source.checksum ?? null,
            bundle.source.scope.slice(0, 500),
          ],
        ),
      ).id;

      const seasonDates = bundle.aggregate.seasons.length
        ? {
            from: bundle.aggregate.firstDate ?? bundle.cutoffDate,
            to: bundle.aggregate.lastDate ?? bundle.cutoffDate,
          }
        : { from: bundle.cutoffDate, to: bundle.cutoffDate };
      const season = one(
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.seasons (competition, label, starts_on, ends_on, snapshot_cutoff)
           VALUES ($1, $2, $3, $4, $5::date + interval '1 day' - interval '1 second')
           ON CONFLICT (competition, label) DO UPDATE SET ends_on = GREATEST(seasons.ends_on, EXCLUDED.ends_on)
           RETURNING id`,
          [
            bundle.competition,
            String(bundle.latestSeason),
            seasonDates.from,
            seasonDates.to,
            bundle.cutoffDate,
          ],
        ),
      ).id;

      const duplicate = await tx.query(
        'SELECT 1 FROM app_private.data_versions WHERE season_id = $1 AND label = $2',
        [season, bundle.label],
      );
      if (duplicate.rowCount) {
        throw new AppError(
          'STATE_CONFLICT',
          'A data version with this label already exists for the season.',
        );
      }

      // Existing identities and reviewed roles (register ID → player UUID).
      const registryIds = [...new Set(bundle.aggregate.seasons.map((s) => s.playerId))].sort();
      const known = await tx.query<{
        external_id: string;
        player_id: string;
        role: Role;
        reviewed: boolean;
      }>(
        `SELECT e.external_id, e.player_id, p.primary_role AS role, p.role_reviewed AS reviewed
           FROM app_private.player_external_ids e JOIN app_private.players p ON p.id = e.player_id
          WHERE e.source = $1 AND e.external_id = ANY($2::text[])`,
        [bundle.externalSource, registryIds],
      );
      const playerIds = new Map(known.rows.map((r) => [r.external_id, r.player_id]));
      const overrides = new Map<string, Role>(
        known.rows.filter((r) => r.reviewed).map((r) => [r.external_id, r.role]),
      );

      const rated = computeRatings({
        seasons: bundle.aggregate.seasons,
        lines: bundle.aggregate.lines,
        latestSeason: bundle.latestSeason,
        cutoffDate: bundle.cutoffDate,
        careerAppearances: bundle.careerAppearances,
        roleOverrides: overrides,
      });
      if (rated.length === 0) {
        throw new AppError('CONFIG_INVALID', 'No players appeared in the selected seasons.');
      }
      const ratings = new Map(rated.map((r) => [r.playerId, r]));

      // New identities.
      const missing = rated.filter((r) => !playerIds.has(r.playerId));
      if (missing.length) {
        // IDs are drawn once in a materialized CTE, so both inserts see the same values.
        const inserted = await tx.query<{ id: string; ext: string }>(
          `WITH input AS MATERIALIZED (
             SELECT gen_random_uuid() AS id, t.ext, t.name, t.country, t.role
               FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(ext, name, country, role)
           ), created AS (
             INSERT INTO app_private.players (id, canonical_name, country_code, primary_role, is_fictional)
             SELECT id, name, country, role, $5 FROM input
           ), linked AS (
             INSERT INTO app_private.player_external_ids (player_id, source, external_id)
             SELECT id, $6, ext FROM input
           )
           SELECT id, ext FROM input`,
          [
            missing.map((r) => r.playerId),
            missing.map((r) => bundle.people.get(r.playerId)?.name ?? r.playerId),
            missing.map((r) => bundle.people.get(r.playerId)?.country ?? null),
            missing.map((r) => r.role),
            bundle.fictional,
            bundle.externalSource,
          ],
        );
        for (const row of inserted.rows) playerIds.set(row.ext, row.id);
      }
      if (bundle.aliases?.size) {
        const rows = [...bundle.aliases].flatMap(([ext, list]) =>
          playerIds.has(ext)
            ? list.map((a) => [playerIds.get(ext) as string, a.source, a.id] as const)
            : [],
        );
        await tx.query(
          `INSERT INTO app_private.player_external_ids (player_id, source, external_id)
           SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[]) ON CONFLICT DO NOTHING`,
          [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])],
        );
      }
      // Derived (unreviewed) roles follow the newest data.
      await tx.query(
        `UPDATE app_private.players p SET primary_role = t.role, updated_at = now()
           FROM unnest($1::uuid[], $2::text[]) AS t(id, role)
          WHERE p.id = t.id AND NOT p.role_reviewed AND p.primary_role <> t.role`,
        [rated.map((r) => playerIds.get(r.playerId)), rated.map((r) => r.role)],
      );

      // Franchises seen in the window.
      const teamNames = [
        ...new Set(rated.map((r) => r.primaryTeam).filter((t): t is string => !!t)),
      ].sort();
      const franchiseIds = new Map<string, string>();
      for (const name of teamNames) {
        const [primary, secondary] = bundle.teamColors.get(name) ?? ['#24364D', '#9FB3C8'];
        const row = one(
          await tx.query<{ id: string }>(
            `INSERT INTO app_private.franchises (slug, name, short_name, primary_hex, secondary_hex, is_fictional)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [slugOf(name), name.slice(0, 60), shortOf(name), primary, secondary, bundle.fictional],
          ),
        );
        franchiseIds.set(name, row.id);
        await tx.query(
          `INSERT INTO app_private.season_franchises (season_id, franchise_id, display_name)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [season, row.id, name.slice(0, 60)],
        );
      }

      const version = one(
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.data_versions (season_id, label, kind, cutoff_at, source_manifest,
             window_label, ratings_model)
           VALUES ($1, $2, $3, $4::date + interval '1 day' - interval '1 second', $5, $6, $7) RETURNING id`,
          [
            season,
            bundle.label,
            bundle.kind,
            bundle.cutoffDate,
            JSON.stringify([
              {
                sourceId: source,
                publisher: bundle.source.publisher,
                licence: bundle.source.licence,
              },
            ]),
            bundle.windowLabel,
            RATINGS_MODEL_VERSION,
          ],
        ),
      ).id;

      // Season rows (with the current approved portrait, if any).
      let withPortrait = 0;
      const portraitIds: (string | null)[] = [];
      for (const r of rated) {
        const portrait = await approvedPortrait(tx, playerIds.get(r.playerId) as string);
        if (portrait) withPortrait += 1;
        portraitIds.push(portrait);
      }
      await tx.query(
        `INSERT INTO app_private.player_seasons (data_version_id, player_id, franchise_id, capped_status,
           overseas, role, team_name, portrait_asset_id, source_id)
         SELECT $1, t.player, t.franchise, 'unknown', t.overseas, t.role, t.team, t.portrait, $2
           FROM unnest($3::uuid[], $4::uuid[], $5::boolean[], $6::text[], $7::text[], $8::uuid[])
             AS t(player, franchise, overseas, role, team, portrait)`,
        [
          version,
          source,
          rated.map((r) => playerIds.get(r.playerId)),
          rated.map((r) => (r.primaryTeam ? (franchiseIds.get(r.primaryTeam) ?? null) : null)),
          rated.map((r) => {
            const country = bundle.people.get(r.playerId)?.country;
            return country ? country !== 'IN' : null;
          }),
          rated.map((r) => r.role),
          rated.map((r) => r.primaryTeam),
          portraitIds,
        ],
      );

      await insertStatistics(tx, version, source, rated, playerIds);
      await insertRatings(tx, version, rated, playerIds, bundle.kind);
      const cards = await insertCards(tx, version, rated, playerIds, bundle.people);

      const report = await validateVersion(tx, version);
      await tx.query('UPDATE app_private.data_versions SET validation_report = $2 WHERE id = $1', [
        version,
        JSON.stringify(report),
      ]);
      return {
        dataVersionId: version,
        players: rated.length,
        cards,
        withPortrait,
        ratings,
        playerIds,
      };
    },
    { statementTimeoutMs: 60_000, lockTimeoutMs: 5_000 },
  );
}

async function insertStatistics(
  tx: Tx,
  version: string,
  source: string,
  rated: readonly PlayerRatings[],
  playerIds: ReadonlyMap<string, string>,
) {
  const rows: [string, string, string | null, number | null, string][] = [];
  for (const r of rated) {
    const id = playerIds.get(r.playerId) as string;
    const s = r.raw;
    const push = (
      metric: string,
      value: string | number | null,
      exposure: number | null,
      units: string,
    ) => rows.push([id, metric, value === null ? null : String(value), exposure, units]);
    push('matches', s.matches, s.matches, 'count');
    push('innings', s.innings, s.matches, 'count');
    push('runs', s.runs, s.ballsFaced, 'runs');
    push('balls_faced', s.ballsFaced, s.ballsFaced, 'balls');
    push('not_outs', s.notOuts, s.innings, 'count');
    push('fours', s.fours, s.ballsFaced, 'count');
    push('sixes', s.sixes, s.ballsFaced, 'count');
    push('high_score', s.highScore, s.innings, 'runs');
    push('batting_average', x100(s.battingAverageX100), s.innings, 'runs per dismissal');
    push('strike_rate', x100(s.strikeRateX100), s.ballsFaced, 'runs per 100 balls');
    push('balls_bowled', s.ballsBowled, s.ballsBowled, 'balls');
    push('runs_conceded', s.runsConceded, s.ballsBowled, 'runs');
    push('wickets', s.wickets, s.ballsBowled, 'count');
    push('economy', x100(s.economyX100), s.ballsBowled, 'runs per over');
    push('bowling_average', x100(s.bowlingAverageX100), s.ballsBowled, 'runs per wicket');
    push('catches', s.catches, s.matches, 'count');
    push('run_outs', s.runOuts, s.matches, 'count');
    push('stumpings', s.stumpings, s.matches, 'count');
  }
  await tx.query(
    `INSERT INTO app_private.player_statistics (data_version_id, player_id, metric, segment, value, exposure,
       units, source_id, confidence)
     SELECT $1, t.player, t.metric, 'overall', t.value::numeric, t.exposure, t.units, $2, 1
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::numeric[], $7::text[])
         AS t(player, metric, value, exposure, units)`,
    [
      version,
      source,
      rows.map((r) => r[0]),
      rows.map((r) => r[1]),
      rows.map((r) => r[2]),
      rows.map((r) => r[3]),
      rows.map((r) => r[4]),
    ],
  );
}

async function insertRatings(
  tx: Tx,
  version: string,
  rated: readonly PlayerRatings[],
  playerIds: ReadonlyMap<string, string>,
  kind: 'demo' | 'factual',
) {
  const rows: [string, string, number, number, string][] = [];
  for (const r of rated) {
    const id = playerIds.get(r.playerId) as string;
    const completeness = r.completenessPermille / 1000;
    const prov = (metric: string) =>
      kind === 'demo'
        ? 'demo'
        : (r.estimated as string[]).includes(metric)
          ? 'estimated'
          : 'observed';
    for (const [metric, points] of Object.entries(r.ratings)) {
      rows.push([id, metric, points, completeness, prov(metric)]);
    }
    for (const [metric, points] of Object.entries(r.phases)) {
      rows.push([id, metric, points, completeness, prov(metric)]);
    }
    rows.push([
      id,
      'role_strength',
      r.roleStrength,
      completeness,
      kind === 'demo' ? 'demo' : 'observed',
    ]);
  }
  await tx.query(
    `INSERT INTO app_private.player_ratings (data_version_id, player_id, model_version, metric, points,
       completeness, provenance)
     SELECT $1, t.player, $2, t.metric, t.points, t.completeness, t.provenance
       FROM unnest($3::uuid[], $4::text[], $5::int[], $6::numeric[], $7::text[])
         AS t(player, metric, points, completeness, provenance)`,
    [
      version,
      RATINGS_MODEL_VERSION,
      rows.map((r) => r[0]),
      rows.map((r) => r[1]),
      rows.map((r) => r[2]),
      rows.map((r) => r[3]),
      rows.map((r) => r[4]),
    ],
  );
}

async function insertCards(
  tx: Tx,
  version: string,
  rated: readonly PlayerRatings[],
  playerIds: ReadonlyMap<string, string>,
  people: ImportBundle['people'],
): Promise<number> {
  const specs = buildCatalog(rated);
  const byId = new Map(rated.map((r) => [r.playerId, r]));
  const mainMetrics = new Set<string>(RATING_METRICS);
  const ids = await tx.query<{ id: string; card_key: string }>(
    `INSERT INTO app_private.card_definitions (data_version_id, label, rarity, stars, stars_provisional,
       ratings, model_version, card_key, completeness_permille, estimated)
     SELECT $1, t.label, t.rarity, t.stars, t.provisional, t.ratings::jsonb, $2, t.key, t.completeness,
            coalesce(string_to_array(NULLIF(t.estimated_csv, ''), ','), '{}')
       FROM unnest($3::text[], $4::text[], $5::smallint[], $6::boolean[], $7::text[], $8::text[],
                   $9::smallint[], $10::text[])
         AS t(label, rarity, stars, provisional, ratings, key, completeness, estimated_csv)
     RETURNING id, card_key`,
    [
      version,
      RATINGS_MODEL_VERSION,
      specs.map((c) =>
        c.playerIds
          .map((p) => people.get(p)?.name ?? p)
          .join(' & ')
          .slice(0, 120),
      ),
      specs.map((c) => c.rarity),
      specs.map((c) => c.stars),
      specs.map((c) => c.starsProvisional),
      specs.map((c) => JSON.stringify(c.ratings)),
      specs.map((c) => c.key),
      specs.map((c) => Math.min(...c.playerIds.map((p) => byId.get(p)?.completenessPermille ?? 0))),
      specs.map((c) =>
        [
          ...new Set(
            c.playerIds.flatMap((p) =>
              (byId.get(p)?.estimated ?? []).filter((m) => mainMetrics.has(m)),
            ),
          ),
        ].join(','),
      ),
    ],
  );
  const idByKey = new Map(ids.rows.map((r) => [r.card_key, r.id]));
  const cardIds: string[] = [];
  const players: string[] = [];
  const positions: number[] = [];
  specs.forEach((c) => {
    const cardId = idByKey.get(c.key);
    if (!cardId) throw new AppError('INTERNAL', 'Card insert mismatch.');
    c.playerIds.forEach((p, pos) => {
      cardIds.push(cardId);
      players.push(playerIds.get(p) as string);
      positions.push(pos + 1);
    });
  });
  await tx.query(
    `INSERT INTO app_private.card_players (card_id, player_id, position)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::smallint[])`,
    [cardIds, players, positions],
  );
  return specs.length;
}
