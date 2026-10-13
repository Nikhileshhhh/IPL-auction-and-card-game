import { incrementFor } from './rulesets';
import { maxBid } from './roster';
import type { AuctionRules } from './types';
import { xiFeasible, type XiPlayer } from './xi';

/**
 * Bidding (rules §8.2–8.3). One validator serves every actor, human or
 * automated: the amount is always the server's next legal bid, never a client
 * figure, and the purse is only committed (deducted at settlement, once).
 */

/** Seconds added after the latest accepted bid (anti-sniping, rules §8.2). */
export const LATE_BID_SECONDS = 8;

/**
 * The only amount the next bid may have: the base price, then the next step on
 * the increment grid of the current bid's band (₹1.25 cr → ₹1.3 cr, ₹1.95 cr →
 * ₹2.0 cr → ₹2.2 cr), as the auctioneer calls it.
 */
export function nextBidAmount(
  rules: AuctionRules,
  basePrice: bigint,
  current: bigint | null,
): bigint {
  if (current === null) return basePrice;
  const step = incrementFor(rules.increments, current);
  return (current / step + 1n) * step;
}

/** deadline = max(deadline, accepted + 8 s); never shortened, never reset to the opening clock. */
export function extendedDeadline(deadline: Date, acceptedAt: Date): Date {
  const late = acceptedAt.getTime() + LATE_BID_SECONDS * 1000;
  return new Date(Math.max(deadline.getTime(), late));
}

export interface BidTeam {
  teamId: string;
  remainingPurse: bigint;
  squad: readonly XiPlayer[];
}

export type BidRejection =
  | { code: 'ALREADY_LEADING' }
  | { code: 'SQUAD_FULL' }
  | { code: 'OVERSEAS_LIMIT' }
  | { code: 'BUDGET_RESERVE'; allowedCeiling: bigint }
  | { code: 'XI_INFEASIBLE' };

export interface BidCheck {
  rules: AuctionRules;
  team: BidTeam;
  player: XiPlayer;
  amount: bigint;
  leaderTeamId: string | null;
  lowestBasePrice: bigint;
  /** Players still on offer after this lot (for XI feasibility). */
  available: readonly XiPlayer[];
}

/** Can this team buy this player at this amount? Null when it can. */
export function bidRejection(c: BidCheck): BidRejection | null {
  if (c.leaderTeamId === c.team.teamId) return { code: 'ALREADY_LEADING' };
  return purchaseRejection(c);
}

/** The squad, overseas, purse-reserve and XI checks shared by bids, RTM raises and matches. */
export function purchaseRejection(c: Omit<BidCheck, 'leaderTeamId'>): BidRejection | null {
  const { rules, team } = c;
  const count = team.squad.length;
  if (count + 1 > rules.squadMax) return { code: 'SQUAD_FULL' };
  const overseas = team.squad.filter((p) => p.overseas).length;
  if (c.player.overseas && overseas + 1 > rules.overseasMax) return { code: 'OVERSEAS_LIMIT' };
  const ceiling = maxBid(rules, count, team.remainingPurse, c.lowestBasePrice) ?? 0n;
  if (c.amount > ceiling) return { code: 'BUDGET_RESERVE', allowedCeiling: ceiling };
  const slotsLeft = rules.squadMax - (count + 1);
  if (!xiFeasible([...team.squad, c.player], c.available, slotsLeft))
    return { code: 'XI_INFEASIBLE' };
  return null;
}

/** The highest amount this team may commit for its next player (null when its squad is full). */
export function biddingCeiling(rules: AuctionRules, team: BidTeam, lowestBasePrice: bigint) {
  return maxBid(rules, team.squad.length, team.remainingPurse, lowestBasePrice);
}
