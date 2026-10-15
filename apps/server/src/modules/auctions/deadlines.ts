import { deferWhileVoting } from '../voting/clocks';
import type { DeadlineRegistry } from '../../jobs/deadlines';
import type { RoomRow } from '../../rooms/room-tx';
import { JOBS, loadLive, openLot, type LotRow } from './live-store';
import { closeBidding, finishAuction, openNextLot, rtmTimeout } from './settlement';

/**
 * Auction timers (ADR-007, ADR-025). Jobs are wake-up hints only: each handler
 * re-reads the room, the lot, its stage and timer generation and the DB clock
 * under the room lock, and does nothing when anything moved on. A browser
 * countdown never sells a player.
 */

const running = (room: RoomRow) => room.game_type === 'auction' && room.lifecycle === 'RUNNING';

function due(lot: LotRow | null, jobSubject: string | null, generation: string, now: Date) {
  return (
    lot !== null &&
    lot.id === jobSubject &&
    lot.timer_generation === generation &&
    lot.deadline !== null &&
    now.getTime() >= lot.deadline.getTime()
  );
}

export function registerAuctionDeadlines(deadlines: DeadlineRegistry) {
  deadlines.register(JOBS.bidding, async (tx, room, job, now) => {
    if (!running(room)) return {};
    const lot = await openLot(tx, room.id);
    if (!lot || lot.stage !== 'bidding' || !due(lot, job.subject_id, job.generation, now))
      return {};
    return { events: await closeBidding(tx, room, lot, now), bumpState: true };
  });

  deadlines.register(JOBS.rtm, async (tx, room, job, now) => {
    if (!running(room)) return {};
    const lot = await openLot(tx, room.id);
    if (!lot || lot.stage === 'bidding' || !due(lot, job.subject_id, job.generation, now))
      return {};
    return { events: await rtmTimeout(tx, room, lot, now), bumpState: true };
  });

  deadlines.register(JOBS.nextLot, async (tx, room, job, now) => {
    if (!running(room)) return {};
    const live = await loadLive(tx, room);
    if (live.game.lot_generation !== job.generation) return {};
    if (live.game.paused_until && live.game.paused_until.getTime() > now.getTime()) return {};
    if (await openLot(tx, room.id)) return {};
    return { events: await openNextLot(tx, room, now), bumpState: true };
  });

  deadlines.register(JOBS.pause, async (tx, room, job, now) => {
    if (!running(room)) return {};
    const live = await loadLive(tx, room);
    if (live.game.lot_generation !== job.generation || !live.game.paused_until) return {};
    await tx.query(
      `UPDATE app_private.auction_games SET paused_until = NULL, lot_generation = lot_generation + 1
        WHERE room_id = $1`,
      [room.id],
    );
    const resumed = {
      audience: { kind: 'public' as const },
      type: 'auction.resumed' as const,
      payload: { reason: 'timeout', phase: 'between_lots', generation: job.generation },
    };
    return { events: [resumed, ...(await openNextLot(tx, room, now))], bumpState: true };
  });

  deadlines.register(JOBS.hardLimit, async (tx, room, job, now) => {
    if (!running(room)) return {};
    // The 8-hour ceiling waits for an open end-game vote to resolve (rules §12).
    if (await deferWhileVoting(tx, room, job)) return {};
    return { events: await finishAuction(tx, room, 'time_limit', now), bumpState: true };
  });
}
