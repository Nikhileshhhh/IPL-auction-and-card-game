import type { Rarity } from '@stumps/contracts';

export const RARITY_LABELS: Record<Rarity, string> = {
  normal: 'Normal',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  dual_platinum: 'Dual Platinum',
};

/** Player counts (2…max) that receive an even 4–30 card hand from `total` (E40). */
export function evenDealCounts(total: number, maxPlayers: number): number[] {
  const counts: number[] = [];
  for (let n = 2; n <= maxPlayers; n += 1) {
    const per = total / n;
    if (Number.isInteger(per) && per >= 4 && per <= 30) counts.push(n);
  }
  return counts;
}
