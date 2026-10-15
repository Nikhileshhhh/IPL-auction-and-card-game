import type { CompletionReason } from '@stumps/contracts';
import {
  RNG_VERSION,
  gameQualifies,
  medalPlacements,
  presentEnough,
  type MatchState,
  type Placement,
} from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import { CARD_RULES_VERSION } from '../cards/starter';
import { closeParticipation, completeRoom, type Award, type PublicResult } from './finalize';

/**
 * Card results (rules §6.1, §13): the competitive standings come from the
 * engine; medals go to the first three eligible competitors (ready at the
 * start and present for at least half their time in the match) of a
 * qualifying game (≥ 2 seats, ≥ 5 decided contests).
 */
export async function finalizeCardMatch(
  tx: Tx,
  room: RoomRow,
  state: MatchState,
  seed: string,
  now: Date,
) {
  const result = state.result;
  if (!result) throw new Error('match has no result');
  await closeParticipation(tx, room.id, now);
  const members = await tx.query<{
    id: string;
    user_id: string;
    display_name: string;
    eligible_at_start: boolean;
    participation_ms: string;
    eliminated_at: Date | null;
    participation_at_exit: string | null;
  }>(
    `SELECT m.id, m.user_id, p.display_name, m.eligible_at_start, m.participation_ms::text,
            s.eliminated_at, s.participation_at_exit::text
       FROM app_private.card_seats s
       JOIN app_private.room_members m ON m.id = s.member_id
       JOIN app_private.profiles p ON p.user_id = m.user_id
      WHERE s.room_id = $1`,
    [room.id],
  );
  const extra = (
    await tx.query<{
      paused_ms: string;
      started_at: Date | null;
      data_version: string | null;
      seed_commitment: string | null;
    }>(
      `SELECT r.paused_ms::text, r.started_at, v.label AS data_version, r.seed_commitment
         FROM app_private.rooms r LEFT JOIN app_private.data_versions v ON v.id = r.data_version_id
        WHERE r.id = $1`,
      [room.id],
    )
  ).rows[0];
  const startedAt = extra?.started_at ?? now;
  const pausedMs = Number(extra?.paused_ms ?? 0);
  const byMember = new Map(members.rows.map((m) => [m.id, m]));
  const eligible = new Set<string>();
  for (const m of members.rows) {
    const end = m.eliminated_at ?? now;
    const active = end.getTime() - startedAt.getTime() - pausedMs;
    const present = Number(m.participation_at_exit ?? m.participation_ms);
    if (m.eligible_at_start && presentEnough(present, active)) eligible.add(m.id);
  }
  const qualifies = gameQualifies(state.seats.length, state.completedContests);
  const placements = qualifies
    ? medalPlacements(result.standings, eligible)
    : new Map<string, Placement>();
  const seats = new Map(state.seats.map((s) => [s.memberId, s]));
  const rankings = result.standings.map((memberId, i) => {
    const seat = seats.get(memberId);
    const place = placements.get(memberId);
    const cards = seat?.deck.length ?? 0;
    const won = seat?.contestsWon ?? 0;
    return {
      competitorId: memberId,
      displayName: byMember.get(memberId)?.display_name ?? 'Player',
      rank: i + 1,
      medalPlacement: place?.medalPlace ?? null,
      medal: place?.medal ?? null,
      eligible: eligible.has(memberId),
      summary: `${cards} card${cards === 1 ? '' : 's'} · ${won} contest${won === 1 ? '' : 's'} won`,
      members: null,
    };
  });
  const awards: Award[] = qualifies
    ? rankings
        .filter((r) => eligible.has(r.competitorId))
        .map((r) => {
          const place = placements.get(r.competitorId);
          return {
            userId: byMember.get(r.competitorId)?.user_id as string,
            rank: r.rank,
            medalPlace: place?.medalPlace ?? null,
            medal: place?.medal ?? null,
            scope: 'personal' as const,
            creditedRole: 'player' as const,
            win: r.rank === 1,
          };
        })
    : [];
  const publicResult: PublicResult = {
    gameType: 'card',
    completionReason: result.reason as CompletionReason,
    qualificationStatus: qualifies ? 'qualifying' : 'practice',
    rankings,
    publicScoreReports: null,
    rulesVersion: CARD_RULES_VERSION,
    dataVersion: extra?.data_version ?? '',
    evaluatorVersion: null,
    seedAudit: seed
      ? { seed, commitment: extra?.seed_commitment ?? '', rngVersion: RNG_VERSION }
      : null,
  };
  return completeRoom(
    tx,
    room,
    publicResult,
    awards,
    { ruleset: CARD_RULES_VERSION, evaluator: null },
    { standings: result.standings, reason: result.reason, contests: state.completedContests },
    now,
  );
}

/** Record a seat's elimination time and its presence up to then (card eligibility). */
export async function recordElimination(tx: Tx, roomId: string, memberId: string, now: Date) {
  await tx.query(
    `UPDATE app_private.card_seats s
        SET eliminated_at = $3,
            participation_at_exit = m.participation_ms + CASE WHEN m.participation_opened_at IS NULL THEN 0
              ELSE GREATEST(0, floor(extract(epoch FROM ($3::timestamptz - m.participation_opened_at)) * 1000))::bigint END
       FROM app_private.room_members m
      WHERE s.room_id = $1 AND s.member_id = $2 AND m.id = s.member_id AND s.eliminated_at IS NULL`,
    [roomId, memberId, now],
  );
}
