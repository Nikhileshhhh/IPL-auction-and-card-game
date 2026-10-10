import type pg from 'pg';
import type { AdminMediaUpload } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { one } from '../../db/rows';
import { withTransaction } from '../../db/transaction';
import { processPortrait } from './pipeline';
import { approvedPortrait, attachToDrafts, registerPortrait } from './service';
import type { MediaStorage } from './storage';

/**
 * Admin photo upload (S34): bytes are sniffed, decoded, attention-cropped and
 * re-encoded (metadata stripped). The admin states the rights basis and
 * evidence; the platform records it but cannot grant rights (ADR-017).
 */
export async function uploadPortrait(
  pool: pg.Pool,
  storage: MediaStorage,
  input: AdminMediaUpload,
  actorId: string,
) {
  const bytes = Buffer.from(input.imageBase64, 'base64');
  const image = await processPortrait(bytes);
  return withTransaction(pool, async (tx) => {
    const player = (
      await tx.query<{ canonical_name: string }>(
        'SELECT canonical_name FROM app_private.players WHERE id = $1',
        [input.playerId],
      )
    ).rows[0];
    if (!player) throw new AppError('NOT_FOUND', 'Player not found.');
    const source = one(
      await tx.query<{ id: string }>(
        `INSERT INTO app_private.data_sources (publisher, url, fetched_at, licence_label, attribution, verification_status, scope)
         VALUES ($1, $2, now(), $3, $4, 'reviewed', 'player portrait') RETURNING id`,
        [
          input.rights.author.slice(0, 120),
          input.rights.sourceUrl,
          input.rights.licence,
          input.rights.attribution,
        ],
      ),
    ).id;
    const result = await registerPortrait(tx, storage, input.playerId, image, {
      basis: input.rights.basis,
      status: 'approved',
      altText: `Photo of ${player.canonical_name}`,
      attribution: input.rights.attribution,
      licenceLabel: input.rights.licence,
      licenceUrl: input.rights.licenceUrl ?? null,
      author: input.rights.author,
      sourcePageUrl: input.rights.sourceUrl,
      sourceId: source,
      reviewedBy: actorId,
    });
    if (input.rights.expiresAt) {
      await tx.query('UPDATE app_private.media_assets SET expires_at = $2 WHERE id = $1', [
        result.assetId,
        input.rights.expiresAt,
      ]);
    }
    if (result.duplicate) await attachToDrafts(tx, input.playerId, result.assetId);
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'catalog.portrait_uploaded', 'media_asset', $2)`,
      [
        actorId,
        JSON.stringify({
          assetId: result.assetId,
          playerId: input.playerId,
          basis: input.rights.basis,
        }),
      ],
    );
    return { assetId: result.assetId, duplicate: result.duplicate };
  });
}

/** Approve or revoke a portrait. Revocation stops serving it immediately, everywhere. */
export async function reviewPortrait(
  pool: pg.Pool,
  assetId: string,
  decision: 'approved' | 'rejected',
  note: string | undefined,
  actorId: string,
) {
  return withTransaction(pool, async (tx) => {
    const row = (
      await tx.query<{ player_id: string | null }>(
        `UPDATE app_private.media_assets SET rights_status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
          WHERE id = $1 AND purpose = 'portrait' RETURNING player_id`,
        [assetId, decision, actorId, note ?? null],
      )
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Image not found.');
    if (row.player_id) {
      const current = await approvedPortrait(tx, row.player_id);
      await tx.query(
        `UPDATE app_private.player_seasons ps SET portrait_asset_id = $2
           FROM app_private.data_versions v
          WHERE v.id = ps.data_version_id AND v.status = 'draft' AND ps.player_id = $1`,
        [row.player_id, current],
      );
    }
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, $2, 'media_asset', $3)`,
      [actorId, `catalog.portrait_${decision}`, JSON.stringify({ assetId })],
    );
    return { assetId, status: decision };
  });
}
