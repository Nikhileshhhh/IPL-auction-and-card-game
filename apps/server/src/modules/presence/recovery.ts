import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import { armAbsenceCheck } from '../auctions';

/**
 * Presence bookkeeping for a running game (rules §1 and §11, ADR-027).
 *
 * Participation is the union of a member's connected time, not the sum of
 * their tabs: an interval opens when their first live tab appears and closes
 * when the last one goes, at most one grace period after its last heartbeat
 * (a suspended phone is credited the grace once, never the whole absence).
 * Going offline in a running auction also arms the team's absence check.
 */

export const PRESENCE = { heartbeatMs: 5_000, staleMs: 15_000, graceMs: 30_000 } as const;

const playing = (room: RoomRow) => room.lifecycle === 'RUNNING';

/** First live tab of a member in a running game: open their participation interval. */
export async function memberCameOnline(tx: Tx, room: RoomRow, memberId: string, now: Date) {
  if (!playing(room)) return;
  await tx.query(
    `UPDATE app_private.room_members SET participation_opened_at = $2
      WHERE id = $1 AND participation_opened_at IS NULL`,
    [memberId, now],
  );
}

/** Last live tab gone: close the interval (crediting at most one grace) and arm failover. */
export async function memberWentOffline(
  tx: Tx,
  room: RoomRow,
  memberId: string,
  lastHeartbeat: Date,
  now: Date,
) {
  if (!playing(room)) return;
  const closeAt = new Date(Math.min(now.getTime(), lastHeartbeat.getTime() + PRESENCE.graceMs));
  await tx.query(
    `UPDATE app_private.room_members
        SET participation_ms = participation_ms
              + GREATEST(0, floor(extract(epoch FROM ($2::timestamptz - participation_opened_at)) * 1000))::bigint,
            participation_opened_at = NULL,
            participation_closed_at = $2
      WHERE id = $1 AND participation_opened_at IS NOT NULL`,
    [memberId, closeAt],
  );
  await armAbsenceCheck(tx, room, memberId, now);
}
