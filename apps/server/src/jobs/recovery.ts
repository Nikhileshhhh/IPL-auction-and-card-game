import type pg from 'pg';
import { dbNow, withTransaction } from '../db/transaction';
import { lockRoom } from '../rooms/room-tx';

/**
 * Outage recovery pause (DB/realtime §4, ADR-027). When the coordinator lease
 * is taken over after its last healthy heartbeat is more than 5 seconds old,
 * every running room whose gameplay clock fell due during the gap is paused:
 * its clocks keep the time they had left at the last healthy heartbeat, plus
 * a visible 10-second countdown, so a server outage never sells players while
 * nobody could bid. Votes keep their original deadline (phase 14). A user's
 * own disconnect is never an outage.
 */

export const OUTAGE_GAP_MS = 5_000;
export const RECOVERY_COUNTDOWN_MS = 10_000;

/** Gameplay clocks that pause; room housekeeping and hard limits keep their time. */
const GAMEPLAY_JOBS = [
  'auction.bidding_deadline',
  'auction.rtm_deadline',
  'auction.next_lot',
  'auction.pause_expiry',
  'auction.auto_bid',
  'auction.auto_rtm',
  'auction.team_absence',
  'card.selection_timeout',
  'card.finish_grace',
];

export interface RecoveredRoom {
  roomId: string;
  until: Date;
  generation: string;
}

/** shifted = now + countdown + max(0, original − lastHealthy), in SQL. */
const SHIFT = `$2::timestamptz + make_interval(secs => $3::double precision / 1000)
               + GREATEST(interval '0', %s - $4::timestamptz)`;
const shift = (column: string) => SHIFT.replace('%s', column);

export async function recoverAfterOutage(
  pool: pg.Pool,
  lastHealthy: Date,
): Promise<RecoveredRoom[]> {
  const rooms = await pool.query<{ room_id: string }>(
    `SELECT DISTINCT j.room_id FROM app_private.deadline_jobs j
       JOIN app_private.rooms r ON r.id = j.room_id
      WHERE r.lifecycle = 'RUNNING' AND j.kind = ANY($1::text[]) AND j.due_at <= now()`,
    [GAMEPLAY_JOBS],
  );
  const recovered: RecoveredRoom[] = [];
  for (const { room_id } of rooms.rows) {
    const done = await withTransaction(pool, async (tx) => {
      const room = await lockRoom(tx, room_id);
      if (room.lifecycle !== 'RUNNING') return null;
      const now = await dbNow(tx);
      const args = [room.id, now, RECOVERY_COUNTDOWN_MS, lastHealthy];
      await tx.query(
        `UPDATE app_private.deadline_jobs SET due_at = ${shift('due_at')}
          WHERE room_id = $1 AND kind = ANY($5::text[])`,
        [...args, GAMEPLAY_JOBS],
      );
      // The authoritative deadlines move with their jobs.
      await tx.query(
        `UPDATE app_private.auction_nominations SET deadline = ${shift('deadline')}
          WHERE room_id = $1 AND status = 'open' AND deadline IS NOT NULL`,
        args,
      );
      await tx.query(
        `UPDATE app_private.auction_games
            SET pacing_deadline = CASE WHEN pacing_deadline IS NULL THEN NULL ELSE ${shift('pacing_deadline')} END,
                paused_until = CASE WHEN paused_until IS NULL THEN NULL ELSE ${shift('paused_until')} END
          WHERE room_id = $1`,
        args,
      );
      await tx.query(
        `UPDATE app_private.card_games SET phase_deadline = ${shift('phase_deadline')}
          WHERE room_id = $1 AND phase_deadline IS NOT NULL`,
        args,
      );
      const until = new Date(now.getTime() + RECOVERY_COUNTDOWN_MS);
      const row = (
        await tx.query<{ recovery_generation: string }>(
          `UPDATE app_private.rooms
              SET recovery_until = $2, recovery_generation = recovery_generation + 1,
                  state_version = state_version + 1
            WHERE id = $1 RETURNING recovery_generation::text`,
          [room.id, until],
        )
      ).rows[0];
      return { roomId: room.id, until, generation: row?.recovery_generation ?? '0' };
    });
    if (done) recovered.push(done);
  }
  return recovered;
}
