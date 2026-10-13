import { bidRejection, type BidTeam } from './bids';
import { maxBid } from './roster';
import type { AuctionRules } from './types';
import type { XiPlayer, XiRole } from './xi';

/**
 * Safe automated bidding (rules §9, ADR-027). Opt-in, deterministic and
 * explainable — not "spend the budget on the best player". At each lot
 * version the bot bids the server's next legal amount only when:
 *   - the player is a named target, or fills an unmet role that has a ceiling;
 *   - next ≤ limit = min(player or role ceiling, remaining automated cap,
 *     purse − reserve for the minimum squad, purse − the team's own reserve);
 *   - automated purchases are below their maximum;
 *   - the franchise is not already leading, and the shared bid validator
 *     (squad, overseas, purse reserve, legal XI) accepts the bid.
 * A missing or disabled strategy never bids.
 */

export interface AutoStrategy {
  enabled: boolean;
  /** Named targets with their own ceiling, in priority order. */
  targets: { playerId: string; ceiling: bigint }[];
  /** Ceiling for any player of a role the squad still needs. */
  roleLimits: Partial<Record<XiRole, bigint>>;
  totalAutoCap: bigint;
  maxAutoPurchases: number;
  /** Purse the team always keeps, on top of the minimum-squad reserve. */
  minReserve: bigint;
  allowRtm: boolean;
  rtmCeiling: bigint | null;
}

export interface AutoCounters {
  spentAuto: bigint;
  purchasesAuto: number;
}

/** Squad shape the role ceilings aim for (simulator choice, ADR-027). */
export const ROLE_NEEDS: Record<XiRole, number> = {
  batter: 6,
  bowler: 6,
  all_rounder: 4,
  wicketkeeper: 2,
};

export type AutoReason =
  | 'BID'
  | 'NO_STRATEGY'
  | 'ALREADY_LEADING'
  | 'PURCHASES_REACHED'
  | 'NOT_TARGET'
  | 'ROLE_FILLED'
  | 'CAP_REACHED'
  | 'RESERVE'
  | 'USER_RESERVE'
  | 'OVER_CEILING'
  | 'SQUAD_FULL'
  | 'OVERSEAS_LIMIT'
  | 'XI_INFEASIBLE'
  | 'BUDGET_RESERVE';

export interface AutoDecision {
  bid: boolean;
  reason: AutoReason;
  /** The effective limit for this player, when there is one. */
  ceiling: bigint | null;
  /** Minimum-squad places the purse reserve protects (for "reserve for N players"). */
  reservePlaces: number;
}

export interface AutoInput {
  rules: AuctionRules;
  strategy: AutoStrategy | null;
  counters: AutoCounters;
  team: BidTeam & { roles: readonly XiRole[] };
  player: XiPlayer & { playerId: string };
  /** The server's next legal amount (or the amount to match for RTM). */
  amount: bigint;
  leaderTeamId: string | null;
  lowestBasePrice: bigint;
  available: readonly XiPlayer[];
}

const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

function decide(input: AutoInput, ceilingFor: (s: AutoStrategy) => bigint | null): AutoDecision {
  const { rules, strategy, counters, team, amount } = input;
  const reservePlaces = Math.max(0, rules.squadMin - team.squad.length - 1);
  const no = (reason: AutoReason, ceiling: bigint | null = null): AutoDecision => ({
    bid: false,
    reason,
    ceiling,
    reservePlaces,
  });
  if (!strategy?.enabled) return no('NO_STRATEGY');
  if (input.leaderTeamId === team.teamId) return no('ALREADY_LEADING');
  if (counters.purchasesAuto >= strategy.maxAutoPurchases) return no('PURCHASES_REACHED');
  const own = ceilingFor(strategy);
  if (own === null) {
    const roleLimit = strategy.roleLimits[input.player.role];
    return no(roleLimit !== undefined ? 'ROLE_FILLED' : 'NOT_TARGET');
  }
  const remainingCap = strategy.totalAutoCap - counters.spentAuto;
  const squadCeiling = maxBid(rules, team.squad.length, team.remainingPurse, input.lowestBasePrice);
  if (squadCeiling === null) return no('SQUAD_FULL');
  const userCeiling = team.remainingPurse - strategy.minReserve;
  const limit = min(own, remainingCap, squadCeiling, userCeiling);
  if (amount > remainingCap) return no('CAP_REACHED', limit);
  if (amount > squadCeiling) return no('RESERVE', limit);
  if (amount > userCeiling) return no('USER_RESERVE', limit);
  if (amount > own) return no('OVER_CEILING', limit);
  const rejection = bidRejection({
    rules,
    team,
    player: input.player,
    amount,
    leaderTeamId: input.leaderTeamId,
    lowestBasePrice: input.lowestBasePrice,
    available: input.available,
  });
  if (rejection)
    return no(rejection.code === 'ALREADY_LEADING' ? 'ALREADY_LEADING' : rejection.code, limit);
  return { bid: true, reason: 'BID', ceiling: limit, reservePlaces };
}

/** Should the bot bid `amount` on this player now? */
export function autoDecision(input: AutoInput): AutoDecision {
  return decide(input, (s) => {
    const named = s.targets.find((t) => t.playerId === input.player.playerId);
    if (named) return named.ceiling;
    const roleLimit = s.roleLimits[input.player.role];
    if (roleLimit === undefined) return null;
    const owned = input.team.roles.filter((r) => r === input.player.role).length;
    return owned < ROLE_NEEDS[input.player.role] ? roleLimit : null;
  });
}

/**
 * Should the bot use (or match with) a right-to-match card at `amount`? Only
 * when the strategy allows RTM, within the RTM ceiling and every other limit.
 */
export function autoRtmDecision(input: AutoInput): AutoDecision {
  return decide({ ...input, leaderTeamId: null }, (s) => (s.allowRtm ? s.rtmCeiling : null));
}

/**
 * Deterministic 700–1,300 ms delay from the public lot number and the team's
 * seat, rotating priority every lot so no bot always answers first.
 */
export function autoBidDelayMs(lotNumber: number, seat: number, teams: number): number {
  const n = Math.max(1, teams);
  const rank = (((seat + lotNumber) % n) + n) % n;
  return 700 + (n === 1 ? 0 : Math.round((600 * rank) / (n - 1)));
}
