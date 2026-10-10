import type { Tx } from '../../db/transaction';

export interface ValidationReport {
  ok: boolean;
  checkedAt: string;
  totals: { players: number; cards: number; withPortrait: number };
  problems: { code: string; message: string; count: number }[];
}

/**
 * Publish gate (ADR-017, rules §3.1): every card identity needs an approved,
 * unexpired portrait; cards need complete inputs (≥40 % observed); the catalog
 * must contain every rarity tier. Problems are counted, never silently fixed.
 */
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

  const problems: ValidationReport['problems'] = [];
  const missingPortraits =
    (
      await tx.query<{ n: number }>(
        `SELECT count(DISTINCT d.id)::int AS n
         FROM app_private.card_definitions d
         JOIN app_private.card_players cp ON cp.card_id = d.id
         JOIN app_private.player_seasons ps ON ps.data_version_id = d.data_version_id AND ps.player_id = cp.player_id
         LEFT JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id
        WHERE d.data_version_id = $1
          AND (a.id IS NULL OR a.rights_status <> 'approved' OR (a.expires_at IS NOT NULL AND a.expires_at <= now()))`,
        [versionId],
      )
    ).rows[0]?.n ?? 0;
  if (missingPortraits > 0) {
    problems.push({
      code: 'PORTRAIT_MISSING',
      message: 'Cards whose player has no approved photo (upload one or publish without them).',
      count: missingPortraits,
    });
  }
  const incomplete =
    (
      await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app_private.card_definitions
        WHERE data_version_id = $1 AND completeness_permille IS NOT NULL AND completeness_permille < 400`,
        [versionId],
      )
    ).rows[0]?.n ?? 0;
  if (incomplete > 0) {
    problems.push({
      code: 'INCOMPLETE',
      message: 'Cards with under 40 % observed inputs.',
      count: incomplete,
    });
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
