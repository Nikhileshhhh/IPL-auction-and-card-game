import type { Tx } from '../../db/transaction';

export interface ValidationReport {
  ok: boolean;
  checkedAt: string;
  totals: { players: number; cards: number; withPortrait: number };
  problems: { code: string; message: string; count: number }[];
}

/**
 * Per card player: what is still missing before the card may be shown
 * (ADR-019). Every published card must have a definite value for every
 * field and an approved photo of the player in IPL jersey (demo packs use
 * original illustrations and are exempt from the jersey rule only).
 */
const PLAYER_GAPS = `
  SELECT cp.card_id, cp.player_id,
         (a.id IS NULL OR a.rights_status <> 'approved'
           OR (a.expires_at IS NOT NULL AND a.expires_at <= now())) AS no_photo,
         (v.kind = 'factual' AND a.id IS NOT NULL AND NOT a.ipl_kit) AS not_kit,
         (p.country_code IS NULL) AS no_country,
         (p.batting_style IS NULL) AS no_batting,
         (coalesce(st.value, 0) > 0 AND p.bowling_style IS NULL) AS no_bowling
    FROM app_private.card_definitions d
    JOIN app_private.data_versions v ON v.id = d.data_version_id
    JOIN app_private.card_players cp ON cp.card_id = d.id
    JOIN app_private.players p ON p.id = cp.player_id
    JOIN app_private.player_seasons ps ON ps.data_version_id = d.data_version_id AND ps.player_id = cp.player_id
    LEFT JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id
    LEFT JOIN app_private.player_statistics st
      ON st.data_version_id = d.data_version_id AND st.player_id = cp.player_id
     AND st.metric = 'balls_bowled' AND st.segment = 'overall'
   WHERE d.data_version_id = $1`;

/** Card IDs in a version that are not yet complete (used by publish-with-prune). */
export const INCOMPLETE_CARDS = `
  SELECT DISTINCT card_id FROM (${PLAYER_GAPS}) g
   WHERE no_photo OR not_kit OR no_country OR no_batting OR no_bowling`;

const MESSAGES: Record<string, string> = {
  no_photo: 'Players without an approved photo',
  not_kit: 'Photos not confirmed as the player in IPL jersey',
  no_country: 'Players without a country',
  no_batting: 'Players without a batting style',
  no_bowling: 'Bowlers without a bowling style',
};

export async function validateVersion(tx: Tx, versionId: string): Promise<ValidationReport> {
  const totals = (
    await tx.query<{ players: number; cards: number; with_portrait: number }>(
      `SELECT (SELECT count(*)::int FROM app_private.player_seasons WHERE data_version_id = $1) AS players,
              (SELECT count(*)::int FROM app_private.card_definitions WHERE data_version_id = $1) AS cards,
              (SELECT count(*)::int FROM app_private.player_seasons ps
                 JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id
                WHERE ps.data_version_id = $1 AND a.rights_status = 'approved'
                  AND (a.expires_at IS NULL OR a.expires_at > now())) AS with_portrait`,
      [versionId],
    )
  ).rows[0] ?? { players: 0, cards: 0, with_portrait: 0 };

  const gaps =
    (
      await tx.query<Record<keyof typeof MESSAGES, number>>(
        `SELECT count(DISTINCT player_id) FILTER (WHERE no_photo)::int AS no_photo,
                count(DISTINCT player_id) FILTER (WHERE not_kit)::int AS not_kit,
                count(DISTINCT player_id) FILTER (WHERE no_country)::int AS no_country,
                count(DISTINCT player_id) FILTER (WHERE no_batting)::int AS no_batting,
                count(DISTINCT player_id) FILTER (WHERE no_bowling)::int AS no_bowling
           FROM (${PLAYER_GAPS}) g`,
        [versionId],
      )
    ).rows[0] ?? {};

  const problems: ValidationReport['problems'] = [];
  for (const [key, message] of Object.entries(MESSAGES)) {
    const count = Number((gaps as Record<string, number>)[key] ?? 0);
    if (count > 0) problems.push({ code: key.toUpperCase(), message, count });
  }
  if (totals.cards === 0)
    problems.push({ code: 'EMPTY', message: 'The version has no cards.', count: 0 });

  return {
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    totals: { players: totals.players, cards: totals.cards, withPortrait: totals.with_portrait },
    problems,
  };
}
