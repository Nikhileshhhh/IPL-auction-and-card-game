import type { AuctionPlayer, EventType } from '@stumps/contracts';
import { bidRejection, nextLot, noBuyersLeft, rtmOpens, type XiPlayer } from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import {
  JOBS,
  LOT_GAP_SECONDS,
  bidTeam,
  loadLive,
  openLot,
  poolRows,
  rtmHolder,
  stillAvailable,
  type Live,
  type LotRow,
} from './live-store';
import { creditAutoSale, scheduleAutoBids, scheduleAutoRtm } from './auto-bid';
import { poolPlayers } from './setup';

/**
 * Lot lifecycle (rules §8, §11; ADR-025), always under the room lock: open the
 * next lot, close bidding (unsold, sale or RTM), the RTM stages, the sale
 * itself (one acquisition, one purse deduction) and the end of the auction.
 * Deadline handlers and commands share these functions, so the same rules
 * apply whether a human acts or a timer fires.
 */

const draft = (type: EventType, payload: Record<string, unknown>): EventDraft => ({
  audience: { kind: 'public' },
  type,
  payload,
});

const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

export async function scheduleJob(
  tx: Tx,
  roomId: string,
  kind: string,
  subjectId: string | null,
  generation: string | number | bigint,
  dueAt: Date,
) {
  await tx.query(
    `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
    [roomId, kind, subjectId, String(generation), dueAt],
  );
}

export async function publicPurses(tx: Tx, roomId: string) {
  const res = await tx.query<{
    id: string;
    remaining_purse: string;
    roster: number;
    overseas: number;
  }>(
    `SELECT f.id, f.remaining_purse::text,
            (SELECT count(*)::int FROM app_private.auction_acquisitions a WHERE a.auction_franchise_id = f.id) AS roster,
            (SELECT count(*)::int FROM app_private.auction_acquisitions a
               JOIN app_private.auction_pool p ON p.room_id = a.room_id AND p.player_id = a.player_id
              WHERE a.auction_franchise_id = f.id AND p.overseas) AS overseas
       FROM app_private.auction_franchises f WHERE f.room_id = $1 ORDER BY f.id`,
    [roomId],
  );
  return res.rows.map((r) => ({
    franchiseId: r.id,
    remainingPurseRupees: r.remaining_purse,
    rosterCount: r.roster,
    overseasCount: r.overseas,
  }));
}

/** Move to the gap before the next lot (pausable); the next-lot job opens it. */
async function scheduleNextLot(tx: Tx, room: RoomRow, now: Date) {
  const gen = (
    await tx.query<{ lot_generation: string }>(
      `UPDATE app_private.auction_games
          SET active_nomination_id = NULL, lot_generation = lot_generation + 1,
              pacing_deadline = $2
        WHERE room_id = $1 RETURNING lot_generation::text`,
      [room.id, addSeconds(now, LOT_GAP_SECONDS)],
    )
  ).rows[0]?.lot_generation;
  await scheduleJob(tx, room.id, JOBS.nextLot, null, gen ?? '0', addSeconds(now, LOT_GAP_SECONDS));
}

async function settleLot(
  tx: Tx,
  roomId: string,
  lot: LotRow,
  status: 'sold' | 'unsold' | 'skipped' | 'cancelled',
  now: Date,
  sale?: { teamId: string; price: bigint },
) {
  await tx.query(
    `UPDATE app_private.auction_nominations
        SET stage = 'settled', status = $2, settled_at = $3, deadline = NULL,
            sold_to = $4, sold_price = $5, timer_generation = timer_generation + 1
      WHERE id = $1`,
    [lot.id, status, now, sale?.teamId ?? null, sale?.price.toString() ?? null],
  );
  if (status !== 'cancelled') {
    await tx.query(
      `UPDATE app_private.auction_games SET completed_nominations = completed_nominations + 1 WHERE room_id = $1`,
      [roomId],
    );
  }
}

/** One acquisition, one purse deduction (rules §1.4): the only place a purse changes in the auction. */
export async function sell(
  tx: Tx,
  room: RoomRow,
  lot: LotRow,
  teamId: string,
  price: bigint,
  kind: 'auction' | 'rtm',
  now: Date,
): Promise<EventDraft[]> {
  await tx.query(
    `INSERT INTO app_private.auction_acquisitions
       (room_id, player_id, auction_franchise_id, nomination_id, kind, charged_price, allocation_price)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [room.id, lot.player_id, teamId, lot.id, kind, price.toString()],
  );
  await tx.query(
    `UPDATE app_private.auction_franchises SET remaining_purse = remaining_purse - $2 WHERE id = $1`,
    [teamId, price.toString()],
  );
  await creditAutoSale(tx, lot.id, teamId, price);
  await tx.query(
    `UPDATE app_private.auction_pool SET status = 'sold' WHERE room_id = $1 AND player_id = $2`,
    [room.id, lot.player_id],
  );
  await settleLot(tx, room.id, lot, 'sold', now, { teamId, price });
  await scheduleNextLot(tx, room, now);
  return [
    draft('auction.playerSold', {
      nominationId: lot.id,
      playerId: lot.player_id,
      outcome: kind === 'rtm' ? 'rtm' : 'sold',
      franchiseId: teamId,
      price: price.toString(),
      publicPursesAndCounts: await publicPurses(tx, room.id),
    }),
  ];
}

export async function markUnsold(tx: Tx, room: RoomRow, lot: LotRow, now: Date) {
  await tx.query(
    `UPDATE app_private.auction_pool SET status = 'unsold' WHERE room_id = $1 AND player_id = $2`,
    [room.id, lot.player_id],
  );
  await settleLot(tx, room.id, lot, 'unsold', now);
  await scheduleNextLot(tx, room, now);
  return [
    draft('auction.playerUnsold', {
      nominationId: lot.id,
      playerId: lot.player_id,
      outcome: 'unsold',
      publicPursesAndCounts: await publicPurses(tx, room.id),
    }),
  ];
}

/** Host skip before the first bid: the player goes to the end of the current pass, once. */
export async function skipLot(tx: Tx, room: RoomRow, lot: LotRow, now: Date) {
  await tx.query(
    `UPDATE app_private.auction_pool
        SET skipped = true,
            order_index = (SELECT max(order_index) + 1 FROM app_private.auction_pool WHERE room_id = $1)
      WHERE room_id = $1 AND player_id = $2`,
    [room.id, lot.player_id],
  );
  await settleLot(tx, room.id, lot, 'skipped', now);
  await scheduleNextLot(tx, room, now);
  return [
    draft('auction.playerSkipped', {
      nominationId: lot.id,
      playerId: lot.player_id,
      outcome: 'skipped',
    }),
  ];
}

const xiOf = (p: {
  role: XiPlayer['role'];
  bowlType: XiPlayer['bowlType'];
  overseas: boolean;
}) => ({
  role: p.role,
  bowlType: p.bowlType,
  overseas: p.overseas,
});

/** Advance a lot to an RTM stage with a fresh deadline and timer generation. */
export async function enterStage(
  tx: Tx,
  live: Live,
  lot: LotRow,
  stage: 'rtm_intent' | 'rtm_raise' | 'rtm_match',
  actingTeamId: string,
  standing: bigint,
  now: Date,
  extra: { rtmTeamId?: string; finalBid?: bigint } = {},
): Promise<EventDraft[]> {
  const deadline = addSeconds(now, live.settings.rtmStageSeconds);
  const gen = (
    await tx.query<{ timer_generation: string }>(
      `UPDATE app_private.auction_nominations
          SET stage = $2, deadline = $3, timer_generation = timer_generation + 1,
              rtm_franchise_id = coalesce($4, rtm_franchise_id),
              rtm_final_bid = coalesce($5, rtm_final_bid)
        WHERE id = $1 RETURNING timer_generation::text`,
      [lot.id, stage, deadline, extra.rtmTeamId ?? null, extra.finalBid?.toString() ?? null],
    )
  ).rows[0]?.timer_generation;
  await scheduleJob(tx, live.room.id, JOBS.rtm, lot.id, gen ?? '0', deadline);
  await scheduleAutoRtm(tx, live.room, lot, actingTeamId, gen ?? '0', now);
  return [
    draft('auction.rtmStageChanged', {
      nominationId: lot.id,
      stage,
      eligibleFranchiseId: actingTeamId,
      standingBid: standing.toString(),
      deadline: deadline.toISOString(),
    }),
  ];
}

/** Bidding is over: unsold, an RTM decision for the previous franchise, or a sale. */
export async function closeBidding(tx: Tx, room: RoomRow, lot: LotRow, now: Date) {
  if (!lot.high_franchise_id || !lot.high_bid) return markUnsold(tx, room, lot, now);
  const live = await loadLive(tx, room);
  const standing = BigInt(lot.high_bid);
  const pool = await poolRows(tx, room.id);
  const player = pool.find((p) => p.playerId === lot.player_id);
  const holderTeam = player?.previousFranchiseId
    ? live.teams.find((t) => t.franchise_id === player.previousFranchiseId)
    : undefined;
  if (player && holderTeam) {
    const opens = rtmOpens({
      rules: live.rules,
      holder: rtmHolder(live, holderTeam),
      holderTeamId: holderTeam.id,
      leaderTeamId: lot.high_franchise_id,
      status: player.cappedStatus,
      purchaseAtStanding: {
        rules: live.rules,
        team: bidTeam(holderTeam),
        player: xiOf(player),
        amount: standing,
        lowestBasePrice: live.lowestBase,
        available: stillAvailable(pool, player.playerId),
      },
    });
    if (opens) {
      return enterStage(tx, live, lot, 'rtm_intent', holderTeam.id, standing, now, {
        rtmTeamId: holderTeam.id,
      });
    }
  }
  return sell(tx, room, lot, lot.high_franchise_id, standing, 'auction', now);
}

/** A due RTM stage timer: intent declines, raise holds, match declines. */
export async function rtmTimeout(tx: Tx, room: RoomRow, lot: LotRow, now: Date) {
  const standing = BigInt(lot.high_bid ?? '0');
  const high = lot.high_franchise_id;
  if (!high) return markUnsold(tx, room, lot, now);
  if (lot.stage === 'rtm_intent') return sell(tx, room, lot, high, standing, 'auction', now);
  if (lot.stage === 'rtm_raise') {
    const live = await loadLive(tx, room);
    return enterStage(tx, live, lot, 'rtm_match', lot.rtm_franchise_id ?? high, standing, now, {
      finalBid: standing,
    });
  }
  const final = BigInt(lot.rtm_final_bid ?? lot.high_bid ?? '0');
  return sell(tx, room, lot, high, final, 'auction', now);
}

export async function finishAuction(
  tx: Tx,
  room: RoomRow,
  reason: 'pool_complete' | 'no_buyers' | 'time_limit',
  now: Date,
): Promise<EventDraft[]> {
  const open = await openLot(tx, room.id);
  if (open) await settleLot(tx, room.id, open, 'cancelled', now); // an unfinished lot never sells (R12)
  await tx.query(
    `UPDATE app_private.auction_games
        SET finished_reason = $2, active_nomination_id = NULL, paused_until = NULL
      WHERE room_id = $1`,
    [room.id, reason],
  );
  await tx.query(
    `UPDATE app_private.rooms SET lifecycle = 'FINALIZING', phase = 'FINALIZING' WHERE id = $1`,
    [room.id],
  );
  await tx.query(
    `DELETE FROM app_private.deadline_jobs WHERE room_id = $1 AND kind LIKE 'auction.%'`,
    [room.id],
  );
  return [
    draft('game.finalizing', {
      stage: 'evaluation_pending',
      progressPercent: 0,
      reason,
      deadline: null,
    }),
  ];
}

/**
 * Open the next lot (or the second pass, or the end). A lot nobody can bid on
 * at its base price closes unsold at once. Deterministic: the order is the
 * frozen pool order from the committed seed.
 */
export async function openNextLot(tx: Tx, room: RoomRow, now: Date): Promise<EventDraft[]> {
  const events: EventDraft[] = [];
  for (let guard = 0; guard < 1000; guard += 1) {
    const live = await loadLive(tx, room);
    const pool = await poolRows(tx, room.id);
    const teams = live.teams.map((t) => ({
      squadCount: t.squad.length,
      remainingPurse: t.remaining_purse,
    }));
    if (noBuyersLeft(teams, live.rules.squadMax, live.lowestBase)) {
      return [...events, ...(await finishAuction(tx, room, 'no_buyers', now))];
    }
    const next = nextLot(pool, live.game.pool_pass);
    if (next.kind === 'done')
      return [...events, ...(await finishAuction(tx, room, 'pool_complete', now))];
    if (next.kind === 'second_pass') {
      await tx.query(
        `UPDATE app_private.auction_pool SET status = 'available', pass = 2
          WHERE room_id = $1 AND status = 'unsold'`,
        [room.id],
      );
      await tx.query(`UPDATE app_private.auction_games SET pool_pass = 2 WHERE room_id = $1`, [
        room.id,
      ]);
      continue;
    }
    const player = pool.find((p) => p.playerId === next.playerId);
    if (!player) return events;
    const lotNumber = live.game.nomination_index + 1;
    const deadline = addSeconds(now, live.settings.openingClockSeconds);
    const lot = (
      await tx.query<{ id: string }>(
        `INSERT INTO app_private.auction_nominations
           (room_id, player_id, lot_number, pass, base_price, deadline, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          room.id,
          player.playerId,
          lotNumber,
          live.game.pool_pass,
          player.basePrice.toString(),
          deadline,
          now,
        ],
      )
    ).rows[0];
    if (!lot) return events;
    await tx.query(
      `UPDATE app_private.auction_games SET nomination_index = $2, active_nomination_id = $3, pacing_deadline = NULL
        WHERE room_id = $1`,
      [room.id, lotNumber, lot.id],
    );
    const [publicPlayer] = await poolPlayers(tx, room, { playerIds: [player.playerId] });
    const payload = {
      playerPublicDTO: publicPlayer as AuctionPlayer,
      basePrice: player.basePrice.toString(),
      nominationId: lot.id,
      bidVersion: '0',
      deadline: deadline.toISOString(),
      lotNumber,
      pass: live.game.pool_pass,
    };
    events.push(draft('auction.playerNominated', payload), draft('auction.biddingOpened', payload));
    const someoneCanBid = live.teams.some(
      (t) =>
        bidRejection({
          rules: live.rules,
          team: bidTeam(t),
          player: xiOf(player),
          amount: player.basePrice,
          leaderTeamId: null,
          lowestBasePrice: live.lowestBase,
          available: stillAvailable(pool, player.playerId),
        }) === null,
    );
    const row = (await openLot(tx, room.id)) as LotRow;
    if (someoneCanBid) {
      await scheduleJob(tx, room.id, JOBS.bidding, lot.id, '0', deadline);
      await scheduleAutoBids(tx, room, row, now);
      return events;
    }
    // Nobody can buy this player: it goes unsold without a clock, then the next lot.
    events.push(...(await markUnsold(tx, room, row, now)));
    await tx.query(`DELETE FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = $2`, [
      room.id,
      JOBS.nextLot,
    ]);
  }
  return events;
}
