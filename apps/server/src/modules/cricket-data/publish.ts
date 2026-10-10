import { createHash } from 'node:crypto';
import type pg from 'pg';
import { AppError } from '../../http/app-error';
import { withTransaction } from '../../db/transaction';
import { canonicalJson } from '../../rooms/room-tx';
import { validateVersion, type ValidationReport } from './validate';

/**
 * Publish a draft: optionally drop cards whose players lack an approved photo
 * (the coverage report says how many), re-validate, hash the content and
 * freeze it. Published versions are immutable (DB triggers); corrections
 * publish a new version.
 */
export async function publishVersion(
  pool: pg.Pool,
  versionId: string,
  options: { prune: boolean; actorId: string | null },
): Promise<{ contentHash: string; report: ValidationReport; pruned: number }> {
  return withTransaction(
    pool,
    async (tx) => {
      const version = (
        await tx.query<{ status: string }>(
          'SELECT status FROM app_private.data_versions WHERE id = $1 FOR UPDATE',
          [versionId],
        )
      ).rows[0];
      if (!version) throw new AppError('NOT_FOUND', 'Data version not found.');
      if (version.status !== 'draft') {
        throw new AppError(
          'STATE_CONFLICT',
          'Only drafts can be published. Published data is immutable.',
        );
      }
      let pruned = 0;
      if (options.prune) {
        const res = await tx.query(
          `DELETE FROM app_private.card_definitions d
            WHERE d.data_version_id = $1 AND EXISTS (
              SELECT 1 FROM app_private.card_players cp
                JOIN app_private.player_seasons ps ON ps.data_version_id = d.data_version_id AND ps.player_id = cp.player_id
                LEFT JOIN app_private.media_assets a ON a.id = ps.portrait_asset_id
               WHERE cp.card_id = d.id
                 AND (a.id IS NULL OR a.rights_status <> 'approved' OR (a.expires_at IS NOT NULL AND a.expires_at <= now())))`,
          [versionId],
        );
        pruned = res.rowCount ?? 0;
      }
      const report = await validateVersion(tx, versionId);
      if (!report.ok) {
        await tx.query(
          'UPDATE app_private.data_versions SET validation_report = $2 WHERE id = $1',
          [versionId, JSON.stringify(report)],
        );
        throw new AppError('PUBLISH_BLOCKED', 'This version cannot be published yet.', {
          problems: report.problems,
        });
      }
      const cards = await tx.query<{
        card_key: string | null;
        rarity: string;
        stars: number;
        ratings: unknown;
        players: string[];
        portraits: string[];
      }>(
        `SELECT d.card_key, d.rarity, d.stars, d.ratings,
                array_agg(cp.player_id::text ORDER BY cp.position) AS players,
                array_agg(ps.portrait_asset_id::text ORDER BY cp.position) AS portraits
           FROM app_private.card_definitions d
           JOIN app_private.card_players cp ON cp.card_id = d.id
           JOIN app_private.player_seasons ps ON ps.data_version_id = d.data_version_id AND ps.player_id = cp.player_id
          WHERE d.data_version_id = $1
          GROUP BY d.id ORDER BY d.card_key`,
        [versionId],
      );
      const contentHash = createHash('sha256').update(canonicalJson(cards.rows)).digest('hex');
      await tx.query(
        `UPDATE app_private.data_versions
            SET status = 'published', published_at = now(), content_hash = $2, validation_report = $3
          WHERE id = $1`,
        [versionId, contentHash, JSON.stringify(report)],
      );
      await tx.query(
        `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
         VALUES ($1, 'catalog.published', 'data_version', $2)`,
        [options.actorId, JSON.stringify({ versionId, pruned, cards: report.totals.cards })],
      );
      return { contentHash, report, pruned };
    },
    { statementTimeoutMs: 30_000 },
  );
}

export async function archiveVersion(pool: pg.Pool, versionId: string, actorId: string) {
  return withTransaction(pool, async (tx) => {
    const res = await tx.query(
      `UPDATE app_private.data_versions SET status = 'archived' WHERE id = $1 AND status = 'published'`,
      [versionId],
    );
    if (res.rowCount !== 1)
      throw new AppError('STATE_CONFLICT', 'Only published versions can be archived.');
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'catalog.archived', 'data_version', $2)`,
      [actorId, JSON.stringify({ versionId })],
    );
    return { archived: true };
  });
}

/** Drafts can be discarded entirely (published ones only archived). */
export async function discardDraft(pool: pg.Pool, versionId: string) {
  return withTransaction(pool, async (tx) => {
    const v = (
      await tx.query<{ status: string }>(
        'SELECT status FROM app_private.data_versions WHERE id = $1 FOR UPDATE',
        [versionId],
      )
    ).rows[0];
    if (!v) throw new AppError('NOT_FOUND', 'Data version not found.');
    if (v.status !== 'draft') throw new AppError('STATE_CONFLICT', 'Only drafts can be discarded.');
    for (const table of [
      'card_definitions',
      'player_ratings',
      'player_statistics',
      'player_seasons',
    ]) {
      await tx.query(`DELETE FROM app_private.${table} WHERE data_version_id = $1`, [versionId]);
    }
    await tx.query(
      'UPDATE app_private.catalog_imports SET data_version_id = NULL WHERE data_version_id = $1',
      [versionId],
    );
    await tx.query('DELETE FROM app_private.data_versions WHERE id = $1', [versionId]);
    return { discarded: true };
  });
}
