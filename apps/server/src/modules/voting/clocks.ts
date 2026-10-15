import type { Tx } from '../../db/transaction';
import type { DeadlineJob } from '../../jobs/deadlines';
import type { RoomRow } from '../../rooms/room-tx';

/**
 * Gameplay clocks frozen by an end-game vote (rules §12): bid and RTM clocks,
 * the gap between lots, a host pause, automated bidding and absence checks,
 * the card selection timer, the finish grace and the match soft limit. Hard
 * ceilings and room housekeeping are not frozen; a ceiling that falls due
 * while a vote is open waits for its resolution (`deferWhileVoting`).
 */
export const VOTE_FROZEN_JOBS = [
  'auction.bidding_deadline',
  'auction.rtm_deadline',
  'auction.next_lot',
  'auction.pause_expiry',
  'auction.auto_bid',
  'auction.auto_rtm',
  'auction.team_absence',
  'card.selection_timeout',
  'card.finish_grace',
  'card.match_limit',
];

/** Remaining time of every frozen clock (for the vote's audit record). */
export async function remainingClocks(tx: Tx, roomId: string, now: Date) {
  const res = await tx.query<{ kind: string; remaining_ms: string }>(
    `SELECT kind, GREATEST(0, floor(extract(epoch FROM (due_at - $2::timestamptz)) * 1000))::bigint::text AS remaining_ms
       FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = ANY($3::text[])
      ORDER BY due_at, kind`,
    [roomId, now, VOTE_FROZEN_JOBS],
  );
  return res.rows.map((r) => ({ kind: r.kind, remainingMs: Number(r.remaining_ms) }));
}

/**
 * Move every frozen gameplay clock by `deltaMs`, jobs and the authoritative
 * deadline columns together, so each keeps exactly the time it had left.
 */
export async function moveGameplayClocks(tx: Tx, roomId: string, deltaMs: number) {
  if (deltaMs === 0) return;
  const by = `make_interval(secs => $2::double precision / 1000)`;
  await tx.query(
    `UPDATE app_private.deadline_jobs SET due_at = due_at + ${by}
      WHERE room_id = $1 AND kind = ANY($3::text[])`,
    [roomId, deltaMs, VOTE_FROZEN_JOBS],
  );
  await tx.query(
    `UPDATE app_private.auction_nominations SET deadline = deadline + ${by}
      WHERE room_id = $1 AND status = 'open' AND deadline IS NOT NULL`,
    [roomId, deltaMs],
  );
  await tx.query(
    `UPDATE app_private.auction_games
        SET pacing_deadline = pacing_deadline + ${by}, paused_until = paused_until + ${by}
      WHERE room_id = $1`,
    [roomId, deltaMs],
  );
  await tx.query(
    `UPDATE app_private.card_games SET phase_deadline = phase_deadline + ${by}
      WHERE room_id = $1 AND phase_deadline IS NOT NULL`,
    [roomId, deltaMs],
  );
  await tx.query(
    `UPDATE app_private.rooms SET match_deadline = match_deadline + ${by}
      WHERE id = $1 AND match_deadline IS NOT NULL`,
    [roomId, deltaMs],
  );
}

/**
 * A safety ceiling or host transfer that falls due during a vote waits for
 * the vote's resolution (rules §12): reschedule it just after the expiry.
 */
export async function deferWhileVoting(tx: Tx, room: RoomRow, job: DeadlineJob) {
  if (!room.saved_phase) return false;
  await tx.query(
    `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz + interval '1 millisecond')
     ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
    [room.id, job.kind, job.subject_id, job.generation, room.saved_phase.expiresAt],
  );
  return true;
}
