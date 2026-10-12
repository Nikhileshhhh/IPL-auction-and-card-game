import type { AuctionRules } from './types';

/**
 * Squad limits and purse reserve (rules §8.3). A team must always be able to
 * fill its minimum squad at the lowest base price in the frozen pool.
 */

/** Rupees that must stay free while the squad holds `squadCount` players. */
export function reserveFor(
  rules: AuctionRules,
  squadCount: number,
  lowestBasePrice: bigint,
): bigint {
  return BigInt(Math.max(0, rules.squadMin - squadCount)) * lowestBasePrice;
}

/**
 * The most a team may pay for its next player: p ≤ P − max(0, m − s − 1)·bmin,
 * or null when the squad is full.
 */
export function maxBid(
  rules: AuctionRules,
  squadCount: number,
  remainingPurse: bigint,
  lowestBasePrice: bigint,
): bigint | null {
  if (squadCount + 1 > rules.squadMax) return null;
  const ceiling =
    remainingPurse - BigInt(Math.max(0, rules.squadMin - squadCount - 1)) * lowestBasePrice;
  return ceiling < 0n ? 0n : ceiling;
}

export interface SquadSummary {
  rosterCount: number;
  overseasCount: number;
  /** Players still needed to reach the minimum squad. */
  needed: number;
  /** Squad places left before the maximum. */
  openSlots: number;
  overseasSlots: number;
  reserve: bigint;
  /** Plain-language gaps, e.g. "Need 5 more players". */
  deficits: string[];
}

export function squadSummary(
  rules: AuctionRules,
  players: readonly { overseas: boolean }[],
  lowestBasePrice: bigint,
): SquadSummary {
  const rosterCount = players.length;
  const overseasCount = players.filter((p) => p.overseas).length;
  const needed = Math.max(0, rules.squadMin - rosterCount);
  const deficits: string[] = [];
  if (needed > 0) deficits.push(`Need ${needed} more player${needed === 1 ? '' : 's'}`);
  if (overseasCount > rules.overseasMax) deficits.push('Too many overseas players');
  return {
    rosterCount,
    overseasCount,
    needed,
    openSlots: Math.max(0, rules.squadMax - rosterCount),
    overseasSlots: Math.max(0, rules.overseasMax - overseasCount),
    reserve: reserveFor(rules, rosterCount, lowestBasePrice),
    deficits,
  };
}
