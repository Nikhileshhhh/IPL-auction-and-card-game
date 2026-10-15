import {
  VoteCastPayload,
  VoteStartPayload,
  type CommandEnvelope,
  type VoteChoice,
  type VoteDTO,
} from '@stumps/contracts';
import {
  VOTE_COOLDOWN_MS,
  VOTE_MAX_FAILURES,
  VOTE_WINDOW_MS,
  finishMatch,
  tallyVote,
  voteThreshold,
} from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { VOTE_RESOLVE_JOB, type DeadlineRegistry } from '../../jobs/deadlines';
import { requireMembership, type MemberRow } from '../../rooms/projection';
import { requireNotRecovering, runRoomCommand, type RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { finishAuction } from '../auctions/settlement';
import { endCardMatch } from '../cards/tie-service';
import type { CommandDispatcher } from '../commands/dispatcher';
import { PRESENCE } from '../presence/recovery';
import type { RoomDeps } from '../rooms/service';
import { moveGameplayClocks, remainingClocks } from './clocks';

/**
 * Democratic early end (rules §12, §15; ADR-029). The host opens a vote of
 * exactly 15 seconds on the database clock; the electorate is frozen when it
 * opens (card seats still in the game, or one representative per franchise,
 * offline ones included). Every gameplay clock is frozen with the time it had
 * left. At expiry the game ends only with Yes ≥ ⌊N/2⌋+1 of the frozen N;
 * otherwise each clock resumes with exactly its saved remaining time.
 */

const PUBLIC = { kind: 'public' } as const;

interface VoteRow {
  id: string;
  status: 'open' | 'passed' | 'failed';
  starts_at: Date;
  expires_at: Date;
  electorate_count: number;
  threshold: number;
  saved_phase: string;
}

interface Elector {
  voter_key: string;
  kind: 'player' | 'franchise';
  representative_member_id: string;
  choice: VoteChoice | null;
  cast_at: Date | null;
}

function run<T>(
  deps: RoomDeps,
  actorUserId: string,
  env: CommandEnvelope,
  payload: unknown,
  handler: Parameters<typeof runRoomCommand<T>>[2],
) {
  return runRoomCommand<T>(
    deps.pool,
    {
      roomId: env.roomId,
      actorKey: `user:${actorUserId}`,
      commandId: env.commandId,
      body: { type: env.type, payload },
    },
    handler,
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** The frozen electorate (rules §12): who is entitled to vote, online or not. */
async function electorate(
  tx: Tx,
  room: RoomRow,
  now: Date,
): Promise<{ voterKey: string; kind: Elector['kind']; representative: string }[]> {
  if (room.game_type === 'card') {
    const seats = await tx.query<{ member_id: string }>(
      `SELECT member_id FROM app_private.card_seats
        WHERE room_id = $1 AND elimination_order IS NULL ORDER BY seat_order`,
      [room.id],
    );
    return seats.rows.map((s) => ({
      voterKey: s.member_id,
      kind: 'player',
      representative: s.member_id,
    }));
  }
  // One franchise, one vote: the captain, or the designated co-captain when the
  // captain has been away beyond the 30 s grace and the co-captain is here.
  const teams = await tx.query<{
    id: string;
    captain: string;
    captain_live: boolean;
    captain_seen: Date;
    cocaptain: string | null;
    cocaptain_live: boolean | null;
  }>(
    `SELECT f.id, f.captain_member_id AS captain,
            EXISTS (SELECT 1 FROM app_private.room_connections c
                     WHERE c.member_id = f.captain_member_id AND c.expires_at > $2) AS captain_live,
            cm.last_seen_at AS captain_seen,
            co.member_id AS cocaptain,
            EXISTS (SELECT 1 FROM app_private.room_connections c
                     WHERE c.member_id = co.member_id AND c.expires_at > $2) AS cocaptain_live
       FROM app_private.auction_franchises f
       JOIN app_private.room_members cm ON cm.id = f.captain_member_id
       LEFT JOIN app_private.franchise_members co
              ON co.auction_franchise_id = f.id AND co.role = 'cocaptain'
      WHERE f.room_id = $1
      ORDER BY f.id`,
    [room.id, now],
  );
  return teams.rows.map((t) => {
    const captainStale =
      !t.captain_live && now.getTime() - t.captain_seen.getTime() > PRESENCE.graceMs;
    const useCo = captainStale && t.cocaptain !== null && t.cocaptain_live === true;
    return {
      voterKey: t.id,
      kind: 'franchise',
      representative: useCo ? (t.cocaptain as string) : t.captain,
    };
  });
}

/** A short label of what the vote froze, shown on the vote sheet. */
async function phaseLabel(tx: Tx, room: RoomRow): Promise<string> {
  if (room.game_type === 'card') return 'Card match';
  const lot = await tx.query<{ stage: string }>(
    `SELECT stage FROM app_private.auction_nominations WHERE room_id = $1 AND status = 'open'`,
    [room.id],
  );
  const stage = lot.rows[0]?.stage;
  if (!stage) return 'Between lots';
  return stage === 'bidding' ? 'Bidding' : 'Right to match';
}

async function openVote(tx: Tx, roomId: string): Promise<VoteRow | null> {
  const res = await tx.query<VoteRow>(
    `SELECT id, status, starts_at, expires_at, electorate_count, threshold, saved_phase
       FROM app_private.end_votes WHERE room_id = $1 AND status = 'open'`,
    [roomId],
  );
  return res.rows[0] ?? null;
}

export function registerVotingModule(
  registries: { commands: CommandDispatcher; deadlines: DeadlineRegistry },
  secrets: Secrets,
) {
  const { commands, deadlines } = registries;

  commands.register('vote.start', async (deps, actor, env) => {
    const payload = VoteStartPayload.parse(env.payload);
    type Reply = { voteId: string; expiresAt: string; threshold: number };
    return run<Reply>(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      if (room.host_user_id !== actor.userId) {
        throw new AppError('FORBIDDEN', 'Only the host can ask the room to end the game.');
      }
      // Due work was settled first: a game that just finished cannot be voted on.
      if (room.lifecycle !== 'RUNNING') {
        if (['FINALIZING', 'RESULTS', 'PURGING'].includes(room.lifecycle)) {
          throw new AppError('ALREADY_COMPLETED', 'This game has already finished.');
        }
        throw new AppError('STATE_CONFLICT', 'The game is not running.');
      }
      if (room.saved_phase) throw new AppError('VOTE_IN_PROGRESS', 'A vote is already open.');
      requireNotRecovering(room, now);
      const history = (
        await tx.query<{ vote_failures: number; last_vote_resolved_at: Date | null }>(
          'SELECT vote_failures, last_vote_resolved_at FROM app_private.rooms WHERE id = $1',
          [room.id],
        )
      ).rows[0];
      if ((history?.vote_failures ?? 0) >= VOTE_MAX_FAILURES) {
        throw new AppError('VOTE_LIMIT', 'This room has already had three votes that failed.');
      }
      const last = history?.last_vote_resolved_at;
      if (last && now.getTime() - last.getTime() < VOTE_COOLDOWN_MS) {
        throw new AppError('VOTE_COOLDOWN', 'Wait a little before asking again.', {
          until: new Date(last.getTime() + VOTE_COOLDOWN_MS).toISOString(),
        });
      }
      if (room.game_type === 'card') {
        const pending = await tx.query<{ finish_pending: boolean }>(
          'SELECT finish_pending FROM app_private.card_games WHERE room_id = $1',
          [room.id],
        );
        if (pending.rows[0]?.finish_pending) {
          throw new AppError('STATE_CONFLICT', 'The match is already ending.');
        }
      }
      const electors = await electorate(tx, room, now);
      if (electors.length === 0) {
        throw new AppError('STATE_CONFLICT', 'Nobody is left to vote.');
      }
      const threshold = voteThreshold(electors.length);
      const expiresAt = new Date(now.getTime() + VOTE_WINDOW_MS);
      const label = await phaseLabel(tx, room);
      const timers = await remainingClocks(tx, room.id, now);
      await moveGameplayClocks(tx, room.id, VOTE_WINDOW_MS);
      const voteId = (
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.end_votes
             (room_id, started_by, starts_at, expires_at, electorate_count, threshold, saved_phase, saved_timers)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            room.id,
            member.id,
            now,
            expiresAt,
            electors.length,
            threshold,
            label,
            JSON.stringify(timers),
          ],
        )
      ).rows[0]?.id as string;
      await tx.query(
        `INSERT INTO app_private.vote_electorate (room_id, vote_id, voter_key, kind, representative_member_id)
         SELECT $1, $2, t.k, t.kind, t.rep
           FROM unnest($3::uuid[], $4::text[], $5::uuid[]) AS t(k, kind, rep)`,
        [
          room.id,
          voteId,
          electors.map((e) => e.voterKey),
          electors.map((e) => e.kind),
          electors.map((e) => e.representative),
        ],
      );
      await tx.query('UPDATE app_private.rooms SET saved_phase = $2 WHERE id = $1', [
        room.id,
        JSON.stringify({ voteId, phase: label, expiresAt: expiresAt.toISOString() }),
      ]);
      await tx.query(
        `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
         VALUES ($1, '${VOTE_RESOLVE_JOB}', $2, 0, $3)`,
        [room.id, voteId, expiresAt],
      );
      return {
        reply: { voteId, expiresAt: expiresAt.toISOString(), threshold },
        events: [
          {
            audience: PUBLIC,
            type: 'vote.started',
            payload: {
              voteId,
              startsAt: now.toISOString(),
              expiresAt: expiresAt.toISOString(),
              electorateCount: electors.length,
              threshold,
              canVote: null,
            },
          },
        ],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('vote.cast', async (deps, actor, env) => {
    const payload = VoteCastPayload.parse(env.payload);
    type Reply = { receipt: { voteId: string; choice: VoteChoice; castAt: string } };
    return run<Reply>(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const vote = (
        await tx.query<VoteRow>(
          `SELECT id, status, starts_at, expires_at, electorate_count, threshold, saved_phase
             FROM app_private.end_votes WHERE id = $1 AND room_id = $2`,
          [payload.voteId, room.id],
        )
      ).rows[0];
      if (!vote) throw new AppError('NOT_FOUND', 'Vote not found.');
      const ballot = (
        await tx.query<Elector>(
          `SELECT voter_key, kind, representative_member_id, choice, cast_at
             FROM app_private.vote_electorate WHERE vote_id = $1 AND representative_member_id = $2`,
          [vote.id, member.id],
        )
      ).rows[0];
      // An identical retry returns the stored receipt, even after the vote closed.
      if (ballot?.choice && ballot.cast_at) {
        if (ballot.choice !== payload.choice) {
          throw new AppError('VOTE_ALREADY_CAST', 'Your vote is already recorded.');
        }
        return {
          reply: {
            receipt: {
              voteId: vote.id,
              choice: ballot.choice,
              castAt: ballot.cast_at.toISOString(),
            },
          },
        };
      }
      // Resolution of a due vote runs before this command: t − 1 ms counts, t does not.
      if (vote.status !== 'open' || now.getTime() >= vote.expires_at.getTime()) {
        throw new AppError('VOTE_EXPIRED', 'This vote has closed.');
      }
      if (!ballot) {
        throw new AppError('FORBIDDEN', 'You are not voting in this decision.');
      }
      await tx.query(
        `UPDATE app_private.vote_electorate SET choice = $3, cast_at = $4
          WHERE vote_id = $1 AND voter_key = $2`,
        [vote.id, ballot.voter_key, payload.choice, now],
      );
      return {
        reply: { receipt: { voteId: vote.id, choice: payload.choice, castAt: now.toISOString() } },
        events: [
          {
            audience: { kind: 'member', memberId: member.id },
            type: 'vote.recorded',
            payload: {
              voteId: vote.id,
              choice: payload.choice,
              receiptId: `${vote.id}:${ballot.voter_key}`,
            },
          },
        ],
        touch: true,
      };
    });
  });

  /** Resolve once, at the original deadline, even after a restart (E27). */
  deadlines.register(VOTE_RESOLVE_JOB, async (tx, room, job, now) => {
    const vote = await openVote(tx, room.id);
    if (!vote || vote.id !== job.subject_id) return {};
    if (now.getTime() < vote.expires_at.getTime()) {
      await tx.query(
        `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
         VALUES ($1, '${VOTE_RESOLVE_JOB}', $2, 0, $3)
         ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
        [room.id, vote.id, vote.expires_at],
      );
      return {};
    }
    const ballots = await tx.query<{ choice: VoteChoice | null }>(
      'SELECT choice FROM app_private.vote_electorate WHERE vote_id = $1',
      [vote.id],
    );
    const tally = tallyVote(
      vote.electorate_count,
      ballots.rows.map((b) => b.choice),
    );
    await tx.query(
      `UPDATE app_private.end_votes SET status = $2, yes = $3, no = $4, resolved_at = $5 WHERE id = $1`,
      [vote.id, tally.passed ? 'passed' : 'failed', tally.yes, tally.no, now],
    );
    const pausedMs = Math.max(0, now.getTime() - vote.starts_at.getTime());
    await tx.query(
      `UPDATE app_private.rooms SET saved_phase = NULL, paused_ms = paused_ms + $2 WHERE id = $1`,
      [room.id, pausedMs],
    );
    const resolved = (deadline: Date | null): EventDraft => ({
      audience: PUBLIC,
      type: 'vote.resolved',
      payload: {
        voteId: vote.id,
        yes: tally.yes,
        no: tally.no,
        abstain: tally.abstain,
        passed: tally.passed,
        resumedPhase: tally.passed ? null : vote.saved_phase,
        deadline: deadline ? deadline.toISOString() : null,
      },
    });
    const current: RoomRow = { ...room, saved_phase: null };
    if (tally.passed) {
      if (room.lifecycle !== 'RUNNING') return { events: [resolved(null)], bumpState: true };
      const ending =
        room.game_type === 'card'
          ? ((
              await endCardMatch(tx, secrets, current, now, ({ state }) =>
                finishMatch(state, 'vote'),
              )
            ).events ?? [])
          : await finishAuction(tx, current, 'vote', now);
      return { events: [resolved(null), ...ending], bumpState: true };
    }
    // Failed: each clock resumes with exactly the time it had left; inside an
    // outage recovery pause it stays frozen until the countdown ends.
    const recoveryWait = room.recovery_until
      ? Math.max(0, room.recovery_until.getTime() - now.getTime())
      : 0;
    const shift = Math.max(0, now.getTime() - vote.expires_at.getTime()) + recoveryWait;
    await moveGameplayClocks(tx, room.id, shift);
    await tx.query(
      `UPDATE app_private.rooms SET vote_failures = vote_failures + 1, last_vote_resolved_at = $2
        WHERE id = $1`,
      [room.id, now],
    );
    const next = await tx.query<{ due_at: Date }>(
      `SELECT min(due_at) AS due_at FROM app_private.deadline_jobs
        WHERE room_id = $1 AND kind = ANY($2::text[])`,
      [
        room.id,
        [
          'auction.bidding_deadline',
          'auction.rtm_deadline',
          'auction.next_lot',
          'card.selection_timeout',
        ],
      ],
    );
    return { events: [resolved(next.rows[0]?.due_at ?? null)], bumpState: true };
  });
}

/** The open vote as this member sees it (no tally before resolution). */
export async function voteView(tx: Tx, room: RoomRow, member: MemberRow): Promise<VoteDTO | null> {
  if (!room.saved_phase) return null;
  const vote = await openVote(tx, room.id);
  if (!vote) return null;
  const mine = (
    await tx.query<Elector>(
      `SELECT voter_key, kind, representative_member_id, choice, cast_at
         FROM app_private.vote_electorate WHERE vote_id = $1 AND representative_member_id = $2`,
      [vote.id, member.id],
    )
  ).rows[0];
  // A franchise member who is not its representative sees who votes for the team.
  let representative: string | null = mine?.representative_member_id ?? null;
  if (!representative && room.game_type === 'auction') {
    const team = await tx.query<{ representative_member_id: string }>(
      `SELECT e.representative_member_id FROM app_private.vote_electorate e
         JOIN app_private.franchise_members fm ON fm.auction_franchise_id = e.voter_key
        WHERE e.vote_id = $1 AND fm.member_id = $2`,
      [vote.id, member.id],
    );
    representative = team.rows[0]?.representative_member_id ?? null;
  }
  return {
    id: vote.id,
    startsAt: vote.starts_at.toISOString(),
    expiresAt: vote.expires_at.toISOString(),
    electorateCount: vote.electorate_count,
    threshold: vote.threshold,
    status: vote.status,
    canVote: Boolean(mine) && !mine?.choice,
    myRecordedChoice: mine?.choice ?? null,
    representativeMemberId: representative,
    savedPhaseLabel: vote.saved_phase,
  };
}
