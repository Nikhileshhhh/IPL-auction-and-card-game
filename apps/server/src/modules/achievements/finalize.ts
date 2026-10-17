import { createHash } from 'node:crypto';
import type { ResultDTO } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { enqueueCleanup } from '../cleanup';

/**
 * Finalization (DB/realtime §7, rules §13, ADR-029). Runs under the room lock
 * in one transaction: participation intervals are closed, compact receipts
 * are inserted with ON CONFLICT DO NOTHING RETURNING, summary counters move
 * only for receipts that were actually inserted, the temporary results are
 * stored and the room enters RESULTS. A failure anywhere rolls all of it
 * back, so a retried finalizer mints each medal exactly once. Receipts never
 * hold room names, codes, opponents, bids, squads or chat.
 */

export interface Award {
  userId: string;
  rank: number;
  medalPlace: 1 | 2 | 3 | null;
  medal: 'gold' | 'silver' | 'bronze' | null;
  scope: 'personal' | 'franchise';
  creditedRole: 'player' | 'captain' | 'cocaptain' | 'bidder' | 'advisor';
  /** A competitive victory (rank 1 of a qualifying game). */
  win: boolean;
}

export type PublicResult = Omit<ResultDTO, 'ownCredits' | 'ownPrivateReport' | 'resultsExpiresAt'>;

/** Close every open participation interval at the end of play. */
export async function closeParticipation(tx: Tx, roomId: string, now: Date) {
  await tx.query(
    `UPDATE app_private.room_members
        SET participation_ms = participation_ms
              + GREATEST(0, floor(extract(epoch FROM ($2::timestamptz - participation_opened_at)) * 1000))::bigint,
            participation_opened_at = NULL,
            participation_closed_at = $2
      WHERE room_id = $1 AND participation_opened_at IS NOT NULL`,
    [roomId, now],
  );
}

/** Insert receipts once and move the derived counters for the new ones only. */
async function commitAwards(
  tx: Tx,
  room: RoomRow,
  gameType: 'card' | 'auction',
  awards: readonly Award[],
  versions: { ruleset: string; evaluator: string | null },
  now: Date,
) {
  const batch = (
    await tx.query<{ award_batch: string }>(
      'SELECT award_batch FROM app_private.rooms WHERE id = $1',
      [room.id],
    )
  ).rows[0]?.award_batch as string;
  let minted = 0;
  // Lock order: achievements in user-id order (DB/realtime §3).
  for (const a of [...awards].sort((x, y) => (x.userId < y.userId ? -1 : 1))) {
    const inserted = await tx.query(
      `INSERT INTO app_private.achievement_receipts
         (award_batch, user_id, game_type, rank, medal_place, medal, scope, credited_role,
          completion_day, ruleset_version, evaluator_version, qualifies)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ($9::timestamptz AT TIME ZONE 'UTC')::date, $10, $11, true)
       ON CONFLICT (award_batch, user_id) DO NOTHING
       RETURNING id`,
      [
        batch,
        a.userId,
        gameType,
        a.rank,
        a.medalPlace,
        a.medal,
        a.scope,
        a.creditedRole,
        now,
        versions.ruleset,
        versions.evaluator,
      ],
    );
    if (!inserted.rowCount) continue;
    minted += a.medal ? 1 : 0;
    await tx.query(
      `INSERT INTO app_private.achievement_summaries (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [a.userId],
    );
    await tx.query(
      `UPDATE app_private.achievement_summaries
          SET games = games + 1,
              gold = gold + ($2::text = 'gold')::int,
              silver = silver + ($2::text = 'silver')::int,
              bronze = bronze + ($2::text = 'bronze')::int,
              card_wins = card_wins + ($3::boolean AND $4::text = 'card')::int,
              auction_wins = auction_wins + ($3::boolean AND $4::text = 'auction')::int,
              updated_at = $5
        WHERE user_id = $1`,
      [a.userId, a.medal ?? '', a.win, gameType, now],
    );
  }
  return minted;
}

/**
 * Store the temporary results and enter RESULTS. Returns the public status
 * for `game.completed`.
 */
export async function completeRoom(
  tx: Tx,
  room: RoomRow,
  result: PublicResult,
  awards: readonly Award[],
  versions: { ruleset: string; evaluator: string | null },
  sourceState: unknown,
  now: Date,
) {
  const already = await tx.query(`SELECT 1 FROM app_private.room_results WHERE room_id = $1`, [
    room.id,
  ]);
  const expiresAt = new Date(now.getTime() + room.results_ttl_seconds * 1000);
  if (already.rowCount) {
    // A retried finalizer after a committed one: nothing to do (E32).
    return {
      medalStatus: 'none' as const,
      resultsExpiresAt: expiresAt.toISOString(),
      expiring: null,
    };
  }
  const minted = await commitAwards(tx, room, result.gameType, awards, versions, now);
  const hash = createHash('sha256').update(JSON.stringify(sourceState)).digest('hex');
  await tx.query(
    `INSERT INTO app_private.room_results (room_id, public_result, created_at, expires_at, source_state_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [room.id, JSON.stringify(result), now, expiresAt, hash],
  );
  await tx.query(
    `UPDATE app_private.rooms
        SET lifecycle = 'RESULTS', phase = 'RESULTS', finalized_at = $2, result_expires_at = $3,
            match_deadline = NULL, saved_phase = NULL
      WHERE id = $1`,
    [room.id, now, expiresAt],
  );
  // Deletion is queued with the results (ADR-030): it runs once they expire.
  await enqueueCleanup(tx, room.id, 'results', expiresAt);
  return {
    medalStatus: minted > 0 ? ('awarded' as const) : ('none' as const),
    resultsExpiresAt: expiresAt.toISOString(),
    expiring: {
      audience: { kind: 'public' },
      type: 'room.expiring',
      payload: { expiresAt: expiresAt.toISOString(), reason: 'results', profileUrl: '/play' },
    } satisfies EventDraft as EventDraft,
  };
}
