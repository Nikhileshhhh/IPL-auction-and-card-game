import type { RandomStream } from '../card/rng';
import { auctionSet, type OrderablePlayer } from './pool';

/**
 * Lot order and passes (rules §8.1). Players go under the hammer in the real
 * auction's sets (capped batters, all-rounders, wicketkeepers, bowlers, then
 * the uncapped sets); the order inside each set is a seeded shuffle from the
 * room's committed seed, so it is fair and verifiable afterwards.
 */
export function lotOrder<T extends OrderablePlayer>(
  players: readonly T[],
  lots: RandomStream,
): T[] {
  const sets = new Map<number, T[]>();
  for (const p of [...players].sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    const order = auctionSet(p.role, p.cappedStatus).order;
    sets.set(order, [...(sets.get(order) ?? []), p]);
  }
  return [...sets.keys()].sort((a, b) => a - b).flatMap((k) => lots.shuffle(sets.get(k) ?? []));
}

export interface PoolLot {
  playerId: string;
  orderIndex: number;
  status: 'available' | 'retained' | 'sold' | 'unsold' | 'skipped';
  pass: number;
}

export type NextLot =
  | { kind: 'lot'; playerId: string }
  /** Pass 1 is over: unsold players get one second pass at the same base price. */
  | { kind: 'second_pass'; playerIds: string[] }
  | { kind: 'done' };

/** The next player to nominate, the start of the second pass, or the end of the pool. */
export function nextLot(pool: readonly PoolLot[], pass: number): NextLot {
  const open = pool
    .filter((p) => p.status === 'available' && p.pass === pass)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const first = open[0];
  if (first) return { kind: 'lot', playerId: first.playerId };
  if (pass === 1) {
    const unsold = pool
      .filter((p) => p.status === 'unsold')
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((p) => p.playerId);
    if (unsold.length > 0) return { kind: 'second_pass', playerIds: unsold };
  }
  return { kind: 'done' };
}

export interface BuyerState {
  squadCount: number;
  remainingPurse: bigint;
}

/** True when no team can buy anyone more: every squad full or no purse for the cheapest player. */
export function noBuyersLeft(
  teams: readonly BuyerState[],
  squadMax: number,
  lowestBasePrice: bigint,
) {
  return teams.every((t) => t.squadCount >= squadMax || t.remainingPurse < lowestBasePrice);
}
