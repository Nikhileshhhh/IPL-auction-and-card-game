import {
  BidPayload,
  PausePayload,
  ResumePayload,
  RtmFinalOfferPayload,
  RtmIntentPayload,
  RtmMatchPayload,
  SkipPayload,
  type EventType,
} from '@stumps/contracts';
import {
  biddingCeiling,
  bidRejection,
  extendedDeadline,
  finalOfferProblem,
  hasRtmCard,
  nextBidAmount,
  purchaseRejection,
  type BidRejection,
} from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { requireMembership, type MemberRow } from '../../rooms/projection';
import { runRoomCommand, type RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import type { CommandDispatcher } from '../commands/dispatcher';
import { requireCurrentControl } from '../teams/shared';
import type { RoomDeps } from '../rooms/service';
import {
  JOBS,
  MAX_PAUSES,
  PAUSE_SECONDS,
  bidTeam,
  loadLive,
  lotById,
  openLot,
  poolRows,
  rtmHolder,
  stillAvailable,
  type Live,
  type LotRow,
} from './live-store';
import { teamMembership } from './setup';
import { enterStage, openNextLot, scheduleJob, sell, skipLot } from './settlement';

/**
 * Live auction commands (DB/realtime §8.2, rules §8; ADR-025). Every write runs
 * under the room lock with the DB clock read after the lock; the amount is the
 * server's next legal bid (never trusted from the client); one validator serves
 * every actor. Validation order: membership → running auction → lot and version
 * → deadline → team right → rules.
 */

const draft = (type: EventType, payload: Record<string, unknown>): EventDraft => ({
  audience: { kind: 'public' },
  type,
  payload,
});

function requireRunning(room: RoomRow) {
  if (room.game_type !== 'auction') {
    throw new AppError('GAME_MISMATCH', 'This command belongs to the auction.');
  }
  if (room.lifecycle !== 'RUNNING') {
    throw new AppError('STATE_CONFLICT', 'The auction is not running.', {
      lifecycle: room.lifecycle,
    });
  }
}

/** The lot a command targets: the open one, or a clear reason why not. */
async function targetLot(tx: Tx, room: RoomRow, nominationId: string): Promise<LotRow> {
  const lot = await openLot(tx, room.id);
  if (lot && lot.id === nominationId) return lot;
  const old = await lotById(tx, room.id, nominationId);
  if (old) {
    throw new AppError('LATE_BID', 'This lot has closed.', { status: old.status });
  }
  throw new AppError('STALE_BID', 'That is not the lot under the hammer.');
}

function requireDeadline(lot: LotRow, now: Date) {
  // Exactly at the deadline is late (rules §8.2): DB time read after the room lock.
  if (!lot.deadline || now.getTime() >= lot.deadline.getTime()) {
    throw new AppError('LATE_BID', 'Time ran out for this decision.');
  }
}

async function teamRight(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
  right: 'bid' | 'rtm',
): Promise<string> {
  const mine = await teamMembership(tx, room.id, member.id);
  if (!mine) throw new AppError('FORBIDDEN', 'You are not in a team in this auction.');
  const allowed = mine.role === 'captain' || (right === 'bid' ? mine.can_bid : mine.can_rtm);
  if (!allowed) {
    throw new AppError(
      'FORBIDDEN',
      right === 'bid'
        ? 'Your captain has not given you the right to bid.'
        : 'Only the captain or an RTM delegate can decide.',
    );
  }
  return mine.auction_franchise_id;
}

function rejectionError(r: BidRejection): AppError {
  switch (r.code) {
    case 'ALREADY_LEADING':
      return new AppError('ALREADY_LEADING', 'Your team already holds the highest bid.');
    case 'SQUAD_FULL':
      return new AppError('SQUAD_FULL', 'Your squad is full.');
    case 'OVERSEAS_LIMIT':
      return new AppError(
        'OVERSEAS_LIMIT',
        'Your squad already has the most overseas players allowed.',
      );
    case 'XI_INFEASIBLE':
      return new AppError(
        'XI_INFEASIBLE',
        'Buying this player would leave no legal XI within your squad places.',
      );
    case 'BUDGET_RESERVE':
      return new AppError(
        'BUDGET_RESERVE',
        'That would leave too little to fill your minimum squad.',
        {
          allowedCeiling: r.allowedCeiling.toString(),
        },
      );
  }
}

async function purchaseCheck(tx: Tx, live: Live, lot: LotRow, teamId: string, amount: bigint) {
  const team = live.teams.find((t) => t.id === teamId);
  const pool = await poolRows(tx, live.room.id);
  const player = pool.find((p) => p.playerId === lot.player_id);
  if (!team || !player) throw new AppError('INTERNAL', 'Team or player not found.');
  return {
    team,
    player,
    check: {
      rules: live.rules,
      team: bidTeam(team),
      player: { role: player.role, bowlType: player.bowlType, overseas: player.overseas },
      amount,
      lowestBasePrice: live.lowestBase,
      available: stillAvailable(pool, player.playerId),
    },
  };
}

function run<T>(
  deps: RoomDeps,
  actorUserId: string,
  env: {
    roomId: string;
    commandId: string;
    type: string;
    expectedVersion: string;
    controlEpoch: string;
  },
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

async function recordBid(
  tx: Tx,
  room: RoomRow,
  lot: LotRow,
  teamId: string,
  memberId: string,
  amount: bigint,
  kind: 'normal' | 'rtm_raise' | 'rtm_match',
  commandId: string,
  now: Date,
) {
  const version = (BigInt(lot.bid_version) + 1n).toString();
  await tx.query(
    `INSERT INTO app_private.auction_bids
       (room_id, nomination_id, auction_franchise_id, actor_member_id, kind, amount, bid_version, command_id, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [room.id, lot.id, teamId, memberId, kind, amount.toString(), version, commandId, now],
  );
  return version;
}

export function registerLiveAuctionCommands(commands: CommandDispatcher) {
  commands.register('auction.bid', async (deps, actor, env) => {
    const payload = BidPayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      const lot = await targetLot(tx, room, payload.nominationId);
      if (lot.stage !== 'bidding')
        throw new AppError('LATE_BID', 'Bidding on this lot has closed.');
      const live = await loadLive(tx, room);
      const next = nextBidAmount(
        live.rules,
        BigInt(lot.base_price),
        lot.high_bid ? BigInt(lot.high_bid) : null,
      );
      if (payload.nominationVersion !== lot.bid_version || BigInt(payload.amountRupees) !== next) {
        // Never auto-raised: the client sees the new legal amount and decides again.
        throw new AppError('STALE_BID', 'The price moved; check the new amount.', {
          nominationVersion: lot.bid_version,
          nextAmountRupees: next.toString(),
        });
      }
      requireDeadline(lot, now);
      const teamId = await teamRight(tx, room, member, 'bid');
      const { check } = await purchaseCheck(tx, live, lot, teamId, next);
      const rejection = bidRejection({ ...check, leaderTeamId: lot.high_franchise_id });
      if (rejection) throw rejectionError(rejection);

      const version = await recordBid(
        tx,
        room,
        lot,
        teamId,
        member.id,
        next,
        'normal',
        env.commandId,
        now,
      );
      const deadline = extendedDeadline(lot.deadline as Date, now);
      const moved = deadline.getTime() !== (lot.deadline as Date).getTime();
      const generation = moved
        ? (BigInt(lot.timer_generation) + 1n).toString()
        : lot.timer_generation;
      await tx.query(
        `UPDATE app_private.auction_nominations
            SET high_franchise_id = $2, high_bid = $3, bid_version = $4, deadline = $5, timer_generation = $6
          WHERE id = $1`,
        [lot.id, teamId, next.toString(), version, deadline, generation],
      );
      if (moved) await scheduleJob(tx, room.id, JOBS.bidding, lot.id, generation, deadline);
      const events = [
        draft('auction.bidAccepted', {
          nominationId: lot.id,
          franchiseId: teamId,
          amountRupees: next.toString(),
          nominationVersion: version,
          deadline: deadline.toISOString(),
          actorType: 'human',
        }),
      ];
      if (moved) {
        events.push(
          draft('auction.timerChanged', {
            nominationId: lot.id,
            deadline: deadline.toISOString(),
            generation,
          }),
        );
      }
      return {
        reply: {
          commandId: env.commandId,
          nominationVersion: version,
          acceptedAmountRupees: next.toString(),
          deadline: deadline.toISOString(),
          stateVersion: (BigInt(room.state_version) + 1n).toString(),
        },
        events,
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('auction.rtm.intent', async (deps, actor, env) => {
    const payload = RtmIntentPayload.parse(env.payload);
    type Reply = { stage: 'settled' | 'rtm_raise' };
    return run<Reply>(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      const lot = await targetLot(tx, room, payload.nominationId);
      if (lot.stage !== 'rtm_intent')
        throw new AppError('RTM_UNAVAILABLE', 'No right-to-match decision is open.');
      requireDeadline(lot, now);
      const teamId = await teamRight(tx, room, member, 'rtm');
      if (teamId !== lot.rtm_franchise_id)
        throw new AppError('FORBIDDEN', 'Only the previous franchise can use RTM here.');
      const live = await loadLive(tx, room);
      const standing = BigInt(lot.high_bid ?? '0');
      if (!payload.invoke) {
        const events = await sell(
          tx,
          room,
          lot,
          lot.high_franchise_id as string,
          standing,
          'auction',
          now,
        );
        return { reply: { stage: 'settled' }, events, bumpState: true, touch: true };
      }
      // The high bidder now gets its one final raise (2025 regulations).
      const events = await enterStage(
        tx,
        live,
        lot,
        'rtm_raise',
        lot.high_franchise_id as string,
        standing,
        now,
      );
      return { reply: { stage: 'rtm_raise' }, events, bumpState: true, touch: true };
    });
  });

  commands.register('auction.rtm.finalOffer', async (deps, actor, env) => {
    const payload = RtmFinalOfferPayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      const lot = await targetLot(tx, room, payload.nominationId);
      if (lot.stage !== 'rtm_raise')
        throw new AppError('RTM_UNAVAILABLE', 'There is no final offer to make.');
      requireDeadline(lot, now);
      const teamId = await teamRight(tx, room, member, 'bid');
      if (teamId !== lot.high_franchise_id)
        throw new AppError('FORBIDDEN', 'Only the highest bidder makes the final offer.');
      const live = await loadLive(tx, room);
      const standing = BigInt(lot.high_bid ?? '0');
      const amount = BigInt(payload.amountRupees);
      const team = live.teams.find((t) => t.id === teamId);
      const ceiling = team
        ? (biddingCeiling(live.rules, bidTeam(team), live.lowestBase) ?? 0n)
        : 0n;
      const problem = finalOfferProblem(amount, standing, ceiling);
      if (problem?.code === 'BUDGET_RESERVE') {
        throw new AppError('BUDGET_RESERVE', 'That is more than your squad budget allows.', {
          allowedCeiling: problem.allowedCeiling.toString(),
        });
      }
      if (problem) {
        throw new AppError(
          'VALIDATION_FAILED',
          problem.code === 'NOT_WHOLE_LAKH'
            ? 'The final offer must be in whole lakhs.'
            : 'The final offer cannot be below the standing bid.',
        );
      }
      if (amount > standing) {
        const version = await recordBid(
          tx,
          room,
          lot,
          teamId,
          member.id,
          amount,
          'rtm_raise',
          env.commandId,
          now,
        );
        await tx.query(
          'UPDATE app_private.auction_nominations SET bid_version = $2 WHERE id = $1',
          [lot.id, version],
        );
      }
      const events = await enterStage(
        tx,
        live,
        lot,
        'rtm_match',
        lot.rtm_franchise_id as string,
        amount,
        now,
        {
          finalBid: amount,
        },
      );
      return { reply: { stage: 'rtm_match' as const }, events, bumpState: true, touch: true };
    });
  });

  commands.register('auction.rtm.match', async (deps, actor, env) => {
    const payload = RtmMatchPayload.parse(env.payload);
    type Reply = { acquisition: 'rtm' | 'auction'; status: 'sold' };
    return run<Reply>(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      const lot = await targetLot(tx, room, payload.nominationId);
      if (lot.stage !== 'rtm_match')
        throw new AppError('RTM_UNAVAILABLE', 'There is no offer to match.');
      requireDeadline(lot, now);
      const teamId = await teamRight(tx, room, member, 'rtm');
      if (teamId !== lot.rtm_franchise_id)
        throw new AppError('FORBIDDEN', 'Only the previous franchise can match.');
      const final = BigInt(lot.rtm_final_bid ?? lot.high_bid ?? '0');
      if (!payload.match) {
        const events = await sell(
          tx,
          room,
          lot,
          lot.high_franchise_id as string,
          final,
          'auction',
          now,
        );
        return {
          reply: { acquisition: 'auction', status: 'sold' },
          events,
          bumpState: true,
          touch: true,
        };
      }
      const live = await loadLive(tx, room);
      const { team, player, check } = await purchaseCheck(tx, live, lot, teamId, final);
      if (!hasRtmCard(live.rules, rtmHolder(live, team), player.cappedStatus)) {
        throw new AppError('RTM_UNAVAILABLE', 'No right-to-match card is left for this player.');
      }
      const rejection = purchaseRejection(check);
      if (rejection) throw rejectionError(rejection);
      const version = await recordBid(
        tx,
        room,
        lot,
        teamId,
        member.id,
        final,
        'rtm_match',
        env.commandId,
        now,
      );
      await tx.query('UPDATE app_private.auction_nominations SET bid_version = $2 WHERE id = $1', [
        lot.id,
        version,
      ]);
      const events = await sell(tx, room, lot, teamId, final, 'rtm', now);
      return {
        reply: { acquisition: 'rtm', status: 'sold' },
        events,
        bumpState: true,
        touch: true,
      };
    });
  });

  const requireHost = (room: RoomRow, userId: string) => {
    if (room.host_user_id !== userId) throw new AppError('FORBIDDEN', 'Only the host can do this.');
  };

  commands.register('auction.pause', async (deps, actor, env) => {
    const payload = PausePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      requireHost(room, actor.userId);
      const live = await loadLive(tx, room);
      if (await openLot(tx, room.id)) {
        throw new AppError(
          'PAUSE_NOT_ALLOWED',
          'You can pause only between players, never during a lot.',
        );
      }
      if (live.game.paused_until)
        throw new AppError('PAUSE_NOT_ALLOWED', 'The auction is already paused.');
      if (live.game.pause_count >= MAX_PAUSES) {
        throw new AppError(
          'PAUSE_NOT_ALLOWED',
          `Only ${MAX_PAUSES} pauses are allowed per auction.`,
        );
      }
      const until = new Date(now.getTime() + PAUSE_SECONDS * 1000);
      const gen =
        (
          await tx.query<{ lot_generation: string }>(
            `UPDATE app_private.auction_games
              SET paused_until = $2, pause_count = pause_count + 1, lot_generation = lot_generation + 1
            WHERE room_id = $1 RETURNING lot_generation::text`,
            [room.id, until],
          )
        ).rows[0]?.lot_generation ?? '0';
      await scheduleJob(tx, room.id, JOBS.pause, null, gen, until);
      return {
        reply: { boundaryPause: true },
        events: [
          draft('auction.paused', {
            reason: 'host',
            phase: 'between_lots',
            deadline: until.toISOString(),
            generation: gen,
          }),
        ],
        bumpState: true,
        touch: true,
      };
    });
  });

  commands.register('auction.resume', async (deps, actor, env) => {
    const payload = ResumePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      requireHost(room, actor.userId);
      const live = await loadLive(tx, room);
      if (!live.game.paused_until)
        throw new AppError('STATE_CONFLICT', 'The auction is not paused.');
      const gen =
        (
          await tx.query<{ lot_generation: string }>(
            `UPDATE app_private.auction_games SET paused_until = NULL, lot_generation = lot_generation + 1
            WHERE room_id = $1 RETURNING lot_generation::text`,
            [room.id],
          )
        ).rows[0]?.lot_generation ?? '0';
      const events = [
        draft('auction.resumed', { reason: 'host', phase: 'between_lots', generation: gen }),
        ...(await openNextLot(tx, room, now)),
      ];
      return { reply: { nextState: 'lot_open' }, events, bumpState: true, touch: true };
    });
  });

  commands.register('auction.skip', async (deps, actor, env) => {
    const payload = SkipPayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      requireRunning(room);
      requireCurrentControl(member, env);
      requireHost(room, actor.userId);
      const lot = await targetLot(tx, room, payload.nominationId);
      // Never secretly skip an active high bid (rules §8.1).
      if (lot.stage !== 'bidding' || lot.high_bid) {
        throw new AppError('STATE_CONFLICT', 'A lot can be skipped only before its first bid.');
      }
      const pool = await poolRows(tx, room.id);
      if (pool.find((p) => p.playerId === lot.player_id)?.skipped) {
        throw new AppError('STATE_CONFLICT', 'This player has already been skipped once.');
      }
      const events = await skipLot(tx, room, lot, now);
      return { reply: { skipped: true }, events, bumpState: true, touch: true };
    });
  });
}
