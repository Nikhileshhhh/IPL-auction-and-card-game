import type { EventType } from '@stumps/contracts';
import { extendedDeadline } from '@stumps/game-engines';
import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { JOBS, type LotRow } from './live-store';
import { scheduleJob } from './settlement';

/**
 * The single place an accepted bid is written (rules §8.2, ADR-025/027).
 * Human and automated bids both arrive here only after the same validator
 * accepted them, under the room lock: record the offer at the next version,
 * extend the clock (8 s anti-sniping), move the timer job, emit events.
 */

export type BidActor = { type: 'human'; memberId: string } | { type: 'auto'; memberId: null };

const draft = (type: EventType, payload: Record<string, unknown>): EventDraft => ({
  audience: { kind: 'public' },
  type,
  payload,
});

export async function recordBid(
  tx: Tx,
  room: RoomRow,
  lot: LotRow,
  teamId: string,
  actor: BidActor,
  amount: bigint,
  kind: 'normal' | 'rtm_raise' | 'rtm_match',
  commandId: string,
  now: Date,
) {
  const version = (BigInt(lot.bid_version) + 1n).toString();
  await tx.query(
    `INSERT INTO app_private.auction_bids
       (room_id, nomination_id, auction_franchise_id, actor_member_id, actor_type, kind, amount,
        bid_version, command_id, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      room.id,
      lot.id,
      teamId,
      actor.memberId,
      actor.type,
      kind,
      amount.toString(),
      version,
      commandId,
      now,
    ],
  );
  return version;
}

export async function placeBid(
  tx: Tx,
  room: RoomRow,
  lot: LotRow,
  teamId: string,
  actor: BidActor,
  amount: bigint,
  commandId: string,
  now: Date,
) {
  const version = await recordBid(tx, room, lot, teamId, actor, amount, 'normal', commandId, now);
  const deadline = extendedDeadline(lot.deadline as Date, now);
  const moved = deadline.getTime() !== (lot.deadline as Date).getTime();
  const generation = moved ? (BigInt(lot.timer_generation) + 1n).toString() : lot.timer_generation;
  await tx.query(
    `UPDATE app_private.auction_nominations
        SET high_franchise_id = $2, high_bid = $3, bid_version = $4, deadline = $5, timer_generation = $6
      WHERE id = $1`,
    [lot.id, teamId, amount.toString(), version, deadline, generation],
  );
  if (moved) await scheduleJob(tx, room.id, JOBS.bidding, lot.id, generation, deadline);
  const events: EventDraft[] = [
    draft('auction.bidAccepted', {
      nominationId: lot.id,
      franchiseId: teamId,
      amountRupees: amount.toString(),
      nominationVersion: version,
      deadline: deadline.toISOString(),
      actorType: actor.type,
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
  const updated: LotRow = {
    ...lot,
    high_franchise_id: teamId,
    high_bid: amount.toString(),
    bid_version: version,
    deadline,
    timer_generation: generation,
  };
  return { version, deadline, events, lot: updated };
}
