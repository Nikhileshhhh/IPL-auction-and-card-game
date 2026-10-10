import type pg from 'pg';
import type {
  AdminPlayerRow,
  CardDetailDTO,
  CardRatings,
  DataVersionSummary,
  PhotoCredit,
  PlayerRole,
  PublicCardDTO,
  Rarity,
  RawStatsDTO,
} from '@stumps/contracts';
import { displayRating } from '@stumps/game-engines';
import { AppError } from '../../http/app-error';
import { portraitPath } from '../media/service';

const RARITY_ORDER: Rarity[] = ['dual_platinum', 'platinum', 'gold', 'silver', 'bronze', 'normal'];

function toDisplay(points: Record<string, number>): CardRatings {
  return {
    batting: displayRating(points.batting ?? 0),
    bowling: displayRating(points.bowling ?? 0),
    fielding: displayRating(points.fielding ?? 0),
    form: displayRating(points.form ?? 0),
    experience: displayRating(points.experience ?? 0),
    versatility: displayRating(points.versatility ?? 0),
  };
}

interface CardRow {
  id: string;
  card_key: string | null;
  rarity: Rarity;
  stars: number;
  ratings: Record<string, number>;
  model_version: string;
  window_label: string | null;
  label: string;
  kind: 'demo' | 'factual';
  players: {
    id: string;
    name: string;
    role: PlayerRole | null;
    primary_role: PlayerRole;
    team: string | null;
    country: string | null;
    batting_style: 'right_hand' | 'left_hand' | null;
    bowling_style: string | null;
    portrait: string | null;
    basis: string | null;
    author: string | null;
    licence: string | null;
    licence_url: string | null;
    source_url: string | null;
    attribution: string | null;
    alt: string | null;
  }[];
}

const CARD_SELECT = `
  SELECT d.id, d.card_key, d.rarity, d.stars, d.ratings, d.model_version,
         v.window_label, v.label, v.kind,
         (SELECT json_agg(json_build_object(
             'id', p.id, 'name', p.canonical_name, 'role', ps.role, 'primary_role', p.primary_role,
             'team', ps.team_name, 'country', p.country_code, 'batting_style', p.batting_style,
             'bowling_style', p.bowling_style, 'portrait', a.id, 'basis', a.rights_basis, 'author', a.author,
             'licence', a.licence_label, 'licence_url', a.licence_url, 'source_url', a.source_page_url,
             'attribution', a.attribution, 'alt', a.alt_text) ORDER BY cp.position)
            FROM app_private.card_players cp
            JOIN app_private.players p ON p.id = cp.player_id
            JOIN app_private.player_seasons ps ON ps.data_version_id = d.data_version_id AND ps.player_id = p.id
            LEFT JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id AND a.rights_status = 'approved'
           WHERE cp.card_id = d.id) AS players
    FROM app_private.card_definitions d
    JOIN app_private.data_versions v ON v.id = d.data_version_id`;

function creditOf(p: CardRow['players'][number]): PhotoCredit | null {
  if (!p.portrait || p.basis === 'original-generated') return null;
  return {
    author: p.author ?? 'Unknown',
    licence: p.licence ?? 'Licensed',
    licenceUrl: p.licence_url,
    sourceUrl: p.source_url,
    attribution: p.attribution ?? '',
  };
}

export function toCardDTO(row: CardRow): PublicCardDTO {
  return {
    definitionId: row.id,
    rarity: row.rarity,
    stars: row.stars,
    players: row.players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role ?? p.primary_role,
      team: p.team,
      country: p.country,
      battingStyle: p.batting_style,
      bowlingStyle: p.bowling_style,
      // Published cards always have an approved portrait (publish gate); the
      // silhouette path is only a defensive fallback for drafts.
      portraitUrl: p.portrait ? portraitPath(p.portrait) : '/original-assets/silhouette.svg',
      portraitAlt: p.alt ?? `Photo of ${p.name}`,
      photoCredit: creditOf(p),
    })),
    ratings: toDisplay(row.ratings),
    dataLabel: row.window_label ?? row.label,
    dataKind: row.kind,
    modelVersion: row.model_version,
  };
}

/** Newest published version (factual preferred over demo). */
export async function currentVersion(pool: pg.Pool): Promise<{ id: string; label: string } | null> {
  const res = await pool.query<{ id: string; label: string }>(
    `SELECT id, coalesce(window_label, label) AS label FROM app_private.data_versions
      WHERE status = 'published' ORDER BY (kind = 'factual') DESC, published_at DESC LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

export async function listCards(
  pool: pg.Pool,
  options: {
    versionId: string;
    cursor?: string | null;
    limit?: number;
    rarity?: Rarity | null;
    includeDrafts?: boolean;
  },
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
  const res = await pool.query<CardRow>(
    `${CARD_SELECT}
      WHERE d.data_version_id = $1 AND ($2::boolean OR v.status = 'published')
        AND ($3::text IS NULL OR d.card_key > $3) AND ($4::text IS NULL OR d.rarity = $4)
      ORDER BY d.card_key LIMIT $5`,
    [
      options.versionId,
      options.includeDrafts ?? false,
      options.cursor ?? null,
      options.rarity ?? null,
      limit + 1,
    ],
  );
  const rows = res.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toCardDTO),
    nextCursor: res.rows.length > limit && last ? last.card_key : null,
  };
}

/** Showcase: the strongest card of each rarity (S08 preview, dashboard). */
export async function showcase(pool: pg.Pool, versionId: string) {
  const res = await pool.query<CardRow>(
    `${CARD_SELECT}
      WHERE d.data_version_id = $1 AND v.status = 'published' AND d.id IN (
        SELECT DISTINCT ON (rarity) id FROM app_private.card_definitions WHERE data_version_id = $1
         ORDER BY rarity, stars DESC, ((ratings->>'batting')::int + (ratings->>'bowling')::int) DESC, card_key)`,
    [versionId],
  );
  return res.rows
    .map(toCardDTO)
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
}

const STAT_KEYS: Record<string, keyof RawStatsDTO> = {
  matches: 'matches',
  innings: 'innings',
  runs: 'runs',
  balls_faced: 'ballsFaced',
  not_outs: 'notOuts',
  fours: 'fours',
  sixes: 'sixes',
  high_score: 'highScore',
  batting_average: 'battingAverageX100',
  strike_rate: 'strikeRateX100',
  balls_bowled: 'ballsBowled',
  runs_conceded: 'runsConceded',
  wickets: 'wickets',
  economy: 'economyX100',
  bowling_average: 'bowlingAverageX100',
  catches: 'catches',
  run_outs: 'runOuts',
  stumpings: 'stumpings',
};

export async function cardDetail(
  pool: pg.Pool,
  cardId: string,
  options: { includeDrafts?: boolean } = {},
): Promise<CardDetailDTO> {
  const res = await pool.query<CardRow & { data_version_id: string; status: string }>(
    `${CARD_SELECT.replace('v.window_label,', 'v.window_label, v.id AS data_version_id, v.status,')}
      WHERE d.id = $1`,
    [cardId],
  );
  const row = res.rows[0];
  if (!row || (!options.includeDrafts && row.status !== 'published')) {
    throw new AppError('NOT_FOUND', 'Card not found.');
  }
  const card = toCardDTO(row);
  const players = [];
  for (const p of card.players) {
    const stats = await pool.query<{ metric: string; value: string | null }>(
      `SELECT metric, value::text FROM app_private.player_statistics
        WHERE data_version_id = $1 AND player_id = $2 AND segment = 'overall'`,
      [row.data_version_id, p.id],
    );
    const phases = await pool.query<{ metric: string; points: number }>(
      `SELECT metric, points FROM app_private.player_ratings
        WHERE data_version_id = $1 AND player_id = $2 AND metric LIKE '%\\_b%ing' ESCAPE '\\'`,
      [row.data_version_id, p.id],
    );
    const raw: Record<string, unknown> = { scopeLabel: card.dataLabel, bestBowling: null };
    for (const key of Object.values(STAT_KEYS)) raw[key] = null;
    for (const s of stats.rows) {
      const key = STAT_KEYS[s.metric];
      if (!key) continue;
      const scaled = key.endsWith('X100');
      raw[key] =
        s.value === null ? null : scaled ? Math.round(Number(s.value) * 100) : Number(s.value);
    }
    for (const k of [
      'matches',
      'innings',
      'runs',
      'ballsFaced',
      'notOuts',
      'fours',
      'sixes',
      'ballsBowled',
      'runsConceded',
      'wickets',
      'catches',
      'runOuts',
      'stumpings',
    ]) {
      raw[k] ??= 0;
    }
    players.push({
      playerId: p.id,
      raw: stats.rowCount ? (raw as RawStatsDTO) : null,
      phases: Object.fromEntries(phases.rows.map((r) => [r.metric, displayRating(r.points)])),
    });
  }
  const source = await pool.query<{ publisher: string; licence_label: string; url: string }>(
    `SELECT s.publisher, s.licence_label, s.url FROM app_private.player_seasons ps
       JOIN app_private.data_sources s ON s.id = ps.source_id
      WHERE ps.data_version_id = $1 LIMIT 1`,
    [row.data_version_id],
  );
  const src = source.rows[0];
  return {
    card,
    players,
    source: {
      publisher: src?.publisher ?? 'Unknown',
      licence: src?.licence_label ?? 'Unknown',
      url: src?.url ?? '',
    },
  };
}

export async function listVersions(pool: pg.Pool): Promise<DataVersionSummary[]> {
  const res = await pool.query<{
    id: string;
    label: string;
    kind: 'demo' | 'factual';
    status: 'draft' | 'published' | 'archived';
    window_label: string | null;
    published_at: Date | null;
    players: number;
    cards: number;
    with_portrait: number;
    validation_report: {
      ok: boolean;
      problems: { code: string; message: string; count: number }[];
    } | null;
  }>(
    `SELECT v.id, v.label, v.kind, v.status, v.window_label, v.published_at, v.validation_report,
            (SELECT count(*)::int FROM app_private.player_seasons ps WHERE ps.data_version_id = v.id) AS players,
            (SELECT count(*)::int FROM app_private.card_definitions d WHERE d.data_version_id = v.id) AS cards,
            (SELECT count(*)::int FROM app_private.player_seasons ps
               JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id AND a.rights_status = 'approved'
              WHERE ps.data_version_id = v.id) AS with_portrait
       FROM app_private.data_versions v ORDER BY v.created_at DESC LIMIT 50`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    status: r.status,
    windowLabel: r.window_label,
    players: r.players,
    cards: r.cards,
    withPortrait: r.with_portrait,
    publishedAt: r.published_at ? r.published_at.toISOString() : null,
    validation: r.validation_report
      ? { ok: r.validation_report.ok, problems: r.validation_report.problems }
      : null,
  }));
}

export async function listAdminPlayers(
  pool: pg.Pool,
  versionId: string,
  options: { query?: string; incomplete?: boolean; offset?: number },
): Promise<{ items: AdminPlayerRow[]; total: number }> {
  const res = await pool.query<{
    id: string;
    name: string;
    role: PlayerRole;
    role_reviewed: boolean;
    country: string | null;
    batting_style: 'right_hand' | 'left_hand' | null;
    bowling_style: string | null;
    bowls: boolean;
    team: string | null;
    asset_id: string | null;
    ipl_kit: boolean | null;
    kind: 'demo' | 'factual';
    status: 'pending' | 'approved' | 'rejected' | 'expired' | null;
    basis: string | null;
    credit: string | null;
    ratings: Record<string, number> | null;
    total: number;
  }>(
    `WITH rows AS (
       SELECT p.id, p.canonical_name AS name, coalesce(ps.role, p.primary_role) AS role, p.role_reviewed,
              p.country_code AS country, p.batting_style, p.bowling_style, ps.team_name AS team, v.kind,
              coalesce((SELECT st.value > 0 FROM app_private.player_statistics st
                         WHERE st.data_version_id = ps.data_version_id AND st.player_id = p.id
                           AND st.metric = 'balls_bowled' AND st.segment = 'overall'), false) AS bowls,
              m.id AS asset_id, m.rights_status AS status, m.rights_basis AS basis, m.attribution AS credit,
              m.ipl_kit,
              ps.portrait_asset_id AS current_portrait,
              (SELECT jsonb_object_agg(r.metric, r.points) FROM app_private.player_ratings r
                WHERE r.data_version_id = ps.data_version_id AND r.player_id = p.id
                  AND r.metric IN ('batting','bowling','fielding','form','experience','versatility')) AS ratings
         FROM app_private.player_seasons ps
         JOIN app_private.players p ON p.id = ps.player_id
         JOIN app_private.data_versions v ON v.id = ps.data_version_id
         LEFT JOIN LATERAL (
           SELECT a.* FROM app_private.media_assets a
            WHERE a.player_id = p.id AND a.purpose = 'portrait' AND a.rights_status IN ('pending', 'approved')
            ORDER BY (a.id = ps.portrait_asset_id) DESC, a.created_at DESC LIMIT 1) m ON true
        WHERE ps.data_version_id = $1
          AND ($2::text IS NULL OR p.canonical_name ILIKE '%' || $2 || '%')
        )
     SELECT *, count(*) OVER ()::int AS total FROM rows
      WHERE NOT $3::boolean OR current_portrait IS NULL OR status IS DISTINCT FROM 'approved'
         OR (kind = 'factual' AND NOT coalesce(ipl_kit, false))
         OR country IS NULL OR batting_style IS NULL OR (bowls AND bowling_style IS NULL)
      ORDER BY name LIMIT 50 OFFSET $4`,
    [
      versionId,
      options.query?.replace(/[%_\\]/g, '') || null,
      options.incomplete ?? false,
      options.offset ?? 0,
    ],
  );
  return {
    total: res.rows[0]?.total ?? 0,
    items: res.rows.map((r) => {
      const missing: AdminPlayerRow['missing'] = [];
      if (!r.asset_id || r.status !== 'approved') missing.push('photo');
      else if (r.kind === 'factual' && !r.ipl_kit) missing.push('ipl_kit');
      if (!r.country) missing.push('country');
      if (!r.batting_style) missing.push('batting_style');
      if (r.bowls && !r.bowling_style) missing.push('bowling_style');
      return {
        playerId: r.id,
        name: r.name,
        role: r.role,
        roleReviewed: r.role_reviewed,
        country: r.country,
        battingStyle: r.batting_style,
        bowlingStyle: r.bowling_style,
        bowls: r.bowls,
        team: r.team,
        portrait: r.asset_id
          ? {
              assetId: r.asset_id,
              status: r.status ?? 'pending',
              basis: r.basis ?? '',
              credit: r.credit,
              iplKit: r.ipl_kit ?? false,
            }
          : null,
        missing,
        ratings: r.ratings ? toDisplay(r.ratings) : null,
      };
    }),
  };
}
