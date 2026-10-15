import type { ResultDTO, ResultStatus } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { MemberRow } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import type { PublicResult } from './finalize';

/**
 * Temporary results (DB/realtime §7 step 3): readable by room members until
 * they expire, then 410 — medals stay on profiles. Each viewer sees the
 * public podium and only their own credits.
 */

/** Snapshot pointer: evaluation progress, then the results until they expire. */
export async function resultStatus(tx: Tx, room: RoomRow, now: Date): Promise<ResultStatus | null> {
  if (room.lifecycle === 'FINALIZING') {
    let progress = 0;
    if (room.game_type === 'auction') {
      const row = await tx.query<{ published: number | null }>(
        `SELECT (evaluation_cursor->>'published')::int AS published
           FROM app_private.auction_games WHERE room_id = $1`,
        [room.id],
      );
      progress = row.rows[0]?.published ?? 0;
    }
    return { status: 'finalizing', progressPercent: progress, resultsExpiresAt: null };
  }
  if (room.lifecycle !== 'RESULTS') return null;
  const row = await tx.query<{ expires_at: Date }>(
    'SELECT expires_at FROM app_private.room_results WHERE room_id = $1',
    [room.id],
  );
  const expires = row.rows[0]?.expires_at;
  if (!expires) return null;
  return {
    status: expires.getTime() > now.getTime() ? 'ready' : 'expired',
    progressPercent: 100,
    resultsExpiresAt: expires.toISOString(),
  };
}

export async function readResults(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
  now: Date,
): Promise<ResultDTO> {
  if (room.lifecycle === 'FINALIZING') {
    throw new AppError('STATE_CONFLICT', 'Results are still being prepared.');
  }
  const row = (
    await tx.query<{ public_result: PublicResult; expires_at: Date }>(
      'SELECT public_result, expires_at FROM app_private.room_results WHERE room_id = $1',
      [room.id],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'This room has no results.');
  if (row.expires_at.getTime() <= now.getTime()) {
    throw new AppError('RESULTS_EXPIRED', 'Detailed match results expired.');
  }
  const credits = await tx.query<{
    rank: number;
    medal: 'gold' | 'silver' | 'bronze' | null;
    scope: 'personal' | 'franchise';
    credited_role: string;
    qualifies: boolean;
  }>(
    `SELECT a.rank, a.medal, a.scope, a.credited_role, a.qualifies
       FROM app_private.achievement_receipts a
       JOIN app_private.rooms r ON r.award_batch = a.award_batch
      WHERE r.id = $1 AND a.user_id = $2`,
    [room.id, member.user_id],
  );
  return {
    ...row.public_result,
    ownCredits: credits.rows.map((c) => ({
      rank: c.rank,
      medal: c.medal,
      scope: c.scope,
      creditedRole: c.credited_role,
      qualifies: c.qualifies,
    })),
    ownPrivateReport: null,
    resultsExpiresAt: row.expires_at.toISOString(),
  };
}
