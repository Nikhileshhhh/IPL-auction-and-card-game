import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTransaction } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import { lockRoom } from '../../rooms/room-tx';
import { VARIANT_WIDTHS, processPortrait } from '../media/pipeline';
import type { MediaStorage } from '../media/storage';
import { UPLOAD_LEASE_MS, roomPrefix } from './index';

/** At most this many images per room (each stored as three variants). */
export const ROOM_ASSET_LIMIT = 20;

const OPEN = new Set(['LOBBY', 'RUNNING']);

/**
 * Room-scoped image upload (DB/realtime §11, ADR-030). The bytes go through
 * the backend (never a long-lived presigned write URL), are decoded and
 * re-encoded, and every object is registered in the room's deletion
 * manifest with a ≤ 60-second upload lease before it is written. Once the
 * room finalizes or starts purging, uploads are refused; an upload already
 * in flight is still removed by the cleaner, which waits out the lease and
 * re-lists the room prefix.
 */
export async function uploadRoomAsset(
  pool: pg.Pool,
  storage: MediaStorage,
  userId: string,
  roomId: string,
  imageBase64: string,
) {
  const image = await processPortrait(Buffer.from(imageBase64, 'base64'));
  const assetId = randomUUID();
  const base = `${roomPrefix(roomId)}/${assetId}`;
  const keys = VARIANT_WIDTHS.map((w) => ({
    key: `${base}/${w}.webp`,
    bytes: image.variants.get(w),
  }));
  const ids = await withTransaction(pool, async (tx) => {
    const room = await lockRoom(tx, roomId);
    const me = await requireMembership(tx, roomId, userId);
    if (!OPEN.has(room.lifecycle)) {
      throw new AppError('STATE_CONFLICT', 'This room no longer accepts uploads.');
    }
    const count = await tx.query<{ n: number }>(
      `SELECT count(DISTINCT split_part(object_key, '/', 3))::int AS n
         FROM app_private.room_assets WHERE room_id = $1 AND status <> 'deleted'`,
      [roomId],
    );
    if ((count.rows[0]?.n ?? 0) >= ROOM_ASSET_LIMIT) {
      throw new AppError('RULE_VIOLATION', 'This room already has the most images it can hold.');
    }
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app_private.room_assets
         (room_id, bucket, object_key, purpose, status, upload_expires_at, size_bytes, checksum, created_by)
       SELECT $1, 'room-media', k, 'room_image', 'uploading',
              now() + make_interval(secs => $3::double precision / 1000), s, $4, $5
         FROM unnest($2::text[], $6::bigint[]) AS t(k, s)
       RETURNING id`,
      [
        roomId,
        keys.map((k) => k.key),
        UPLOAD_LEASE_MS,
        image.sha256,
        me.id,
        keys.map((k) => k.bytes?.length ?? 1),
      ],
    );
    return res.rows.map((r) => r.id);
  });
  for (const { key, bytes } of keys) {
    if (bytes) await storage.put(key, bytes, 'image/webp');
  }
  // Ready only if the room is still open; otherwise the cleaner removes it.
  const ready = await withTransaction(pool, async (tx) => {
    const room = await lockRoom(tx, roomId);
    if (!OPEN.has(room.lifecycle)) return false;
    await tx.query(
      `UPDATE app_private.room_assets SET status = 'ready' WHERE id = ANY($1::uuid[]) AND status = 'uploading'`,
      [ids],
    );
    return true;
  });
  if (!ready)
    throw new AppError('STATE_CONFLICT', 'This room closed while the image was uploading.');
  return { assetId };
}
