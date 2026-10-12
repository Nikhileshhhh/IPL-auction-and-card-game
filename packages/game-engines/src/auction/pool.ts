import type { AuctionRules, CappedStatus } from './types';

/**
 * Pool sets and feasibility (rules §8.1). Players go under the hammer in sets
 * like the real auction: capped players by speciality first, then uncapped,
 * highest base price first within a set, then by name.
 */

export type PoolRole = 'batter' | 'wicketkeeper' | 'all_rounder' | 'bowler';

const ROLE_ORDER: Record<PoolRole, number> = {
  batter: 0,
  all_rounder: 1,
  wicketkeeper: 2,
  bowler: 3,
};
const ROLE_LABEL: Record<PoolRole, string> = {
  batter: 'batters',
  all_rounder: 'all-rounders',
  wicketkeeper: 'wicketkeepers',
  bowler: 'bowlers',
};

export function auctionSet(role: PoolRole, status: CappedStatus): { order: number; label: string } {
  const uncapped = status === 'uncapped';
  return {
    order: (uncapped ? 4 : 0) + ROLE_ORDER[role],
    label: `${uncapped ? 'Uncapped' : 'Capped'} ${ROLE_LABEL[role]}`,
  };
}

export interface OrderablePlayer {
  playerId: string;
  name: string;
  role: PoolRole;
  cappedStatus: CappedStatus;
  basePrice: bigint;
}

/** Stable pool order: set, then base price (high first), then name, then ID. */
export function poolOrder<T extends OrderablePlayer>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => {
    const sa = auctionSet(a.role, a.cappedStatus).order;
    const sb = auctionSet(b.role, b.cappedStatus).order;
    if (sa !== sb) return sa - sb;
    if (a.basePrice !== b.basePrice) return a.basePrice > b.basePrice ? -1 : 1;
    return a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId);
  });
}

export interface PoolProblem {
  code: 'POOL_INSUFFICIENT' | 'OVERSEAS_INSUFFICIENT';
  message: string;
}

/**
 * Can every team still reach its minimum squad from the players left in the
 * pool? `teams` gives each team's retained count.
 */
export function poolFeasibility(
  rules: AuctionRules,
  teams: readonly { retained: number }[],
  available: number,
): PoolProblem[] {
  const needed = teams.reduce((s, t) => s + Math.max(0, rules.squadMin - t.retained), 0);
  return needed > available
    ? [
        {
          code: 'POOL_INSUFFICIENT',
          message: `The teams need ${needed} more players to reach ${rules.squadMin} each, but the pool has ${available}.`,
        },
      ]
    : [];
}
