import type pg from 'pg';
import { AppError } from '../../http/app-error';
import { one } from '../../db/rows';
import type { Tx } from '../../db/transaction';
import type { MediaStorage } from './storage';
import { VARIANT_WIDTHS, type ProcessedImage, type VariantWidth } from './pipeline';

export type RightsBasis = 'original-generated' | 'licensed' | 'user-upload' | 'free-license';

export interface PortraitRights {
  basis: RightsBasis;
  status: 'pending' | 'approved';
  altText: string;
  attribution?: string | null;
  licenceLabel?: string | null;
  licenceUrl?: string | null;
  author?: string | null;
  sourcePageUrl?: string | null;
  /** data_sources row (required for 'licensed'). */
  sourceId?: string | null;
  reviewedBy?: string | null;
  /** Player is shown in IPL franchise jersey (required for published factual cards). */
  iplKit?: boolean;
}

export const variantKey = (objectKey: string, width: VariantWidth) => `${objectKey}/${width}.webp`;

/**
 * Store variants then register the asset. Storage writes happen before the
 * row commits; an orphaned object (row rolled back) is harmless and has no
 * reference — it is never served because serving requires the row.
 */
export async function registerPortrait(
  tx: Tx,
  storage: MediaStorage,
  playerId: string,
  image: ProcessedImage,
  rights: PortraitRights,
): Promise<{ assetId: string; duplicate: boolean }> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM app_private.media_assets WHERE content_sha256 = $1',
    [image.sha256],
  );
  if (existing.rows[0]) return { assetId: existing.rows[0].id, duplicate: true };
  const objectKey = `portraits/${playerId.replace(/-/g, '')}/${image.sha256.slice(0, 24)}`;
  for (const width of VARIANT_WIDTHS) {
    const bytes = image.variants.get(width);
    if (bytes) await storage.put(variantKey(objectKey, width), bytes, 'image/webp');
  }
  const largest = image.variants.get(960);
  const row = one(
    await tx.query<{ id: string }>(
      `INSERT INTO app_private.media_assets
         (bucket, object_key, purpose, mime, size_bytes, width, height, variant_widths, source_id,
          rights_basis, rights_status, attribution, alt_text, licence_label, licence_url, author,
          source_page_url, content_sha256, player_id, reviewed_by, reviewed_at, ipl_kit)
       VALUES ('catalog-media', $1, 'portrait', 'image/webp', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, CASE WHEN $8 = 'approved' THEN now() END, $18)
       RETURNING id`,
      [
        objectKey,
        largest?.length ?? 1,
        image.width,
        image.height,
        [...VARIANT_WIDTHS],
        rights.sourceId ?? null,
        rights.basis,
        rights.status,
        rights.attribution ?? null,
        rights.altText.slice(0, 200),
        rights.licenceLabel ?? null,
        rights.licenceUrl ?? null,
        rights.author ?? null,
        rights.sourcePageUrl ?? null,
        image.sha256,
        playerId,
        rights.reviewedBy ?? null,
        rights.iplKit ?? false,
      ],
    ),
  );
  if (rights.status === 'approved') await attachToDrafts(tx, playerId, row.id);
  return { assetId: row.id, duplicate: false };
}

/** Point every draft version's season row at the newest approved portrait. */
export async function attachToDrafts(tx: Tx, playerId: string, assetId: string) {
  await tx.query(
    `UPDATE app_private.player_seasons ps SET portrait_asset_id = $2
       FROM app_private.data_versions v
      WHERE v.id = ps.data_version_id AND v.status = 'draft' AND ps.player_id = $1`,
    [playerId, assetId],
  );
}

/** Newest approved portrait for a player (IPL-jersey photos first), if any. */
export async function approvedPortrait(tx: Tx, playerId: string): Promise<string | null> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM app_private.media_assets
      WHERE player_id = $1 AND purpose = 'portrait' AND rights_status = 'approved'
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY ipl_kit DESC, reviewed_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [playerId],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Bytes for a member: only approved, unexpired portraits referenced by a
 * published data version are servable (no enumeration of drafts/pending).
 */
export async function readPortrait(
  pool: pg.Pool,
  storage: MediaStorage,
  assetId: string,
  width: VariantWidth,
  options: { admin?: boolean } = {},
): Promise<Buffer> {
  const res = await pool.query<{ object_key: string }>(
    options.admin
      ? `SELECT object_key FROM app_private.media_assets WHERE id = $1 AND purpose = 'portrait'`
      : `SELECT a.object_key FROM app_private.media_assets a
          WHERE a.id = $1 AND a.rights_status = 'approved'
            AND (a.expires_at IS NULL OR a.expires_at > now())
            AND (
              (a.purpose = 'portrait' AND EXISTS (
                 SELECT 1 FROM app_private.player_seasons ps
                   JOIN app_private.data_versions v ON v.id = ps.data_version_id
                  WHERE ps.portrait_asset_id = a.id AND v.status = 'published'))
              -- A member's current avatar (ADR-028); replaced avatars are no longer served.
              OR (a.purpose = 'avatar' AND EXISTS (
                 SELECT 1 FROM app_private.profiles p WHERE p.avatar_asset_id = a.id))
            )`,
    [assetId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Image not found.');
  const bytes = await storage.get(variantKey(row.object_key, width));
  if (!bytes) throw new AppError('NOT_FOUND', 'Image not found.');
  return bytes;
}

/** Public browser path for a portrait variant (served through the BFF with the session cookie). */
export const portraitPath = (assetId: string, width: VariantWidth = 640) =>
  `/api/media/${assetId}/${width}`;
