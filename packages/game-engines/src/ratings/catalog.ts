import { RARITIES, type Rarity } from '@stumps/contracts';
import { roundDiv } from './rational';
import { RATING_METRICS, type PlayerRatings, type RatingMetric } from './v1';

/** Target pool mix in percent (rules §3.4), rarity enum order. Visual only (R19). */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  normal: 40,
  bronze: 25,
  silver: 15,
  gold: 10,
  platinum: 8,
  dual_platinum: 2,
};

/** Largest-remainder apportionment; ties broken by rarity enum order. */
export function allocate(total: number, weights: readonly [Rarity, number][]): Map<Rarity, number> {
  const sum = weights.reduce((s, [, w]) => s + w, 0);
  const out = new Map<Rarity, number>();
  if (sum === 0 || total <= 0) {
    for (const [r] of weights) out.set(r, 0);
    return out;
  }
  const rows = weights.map(([rarity, w], order) => ({
    rarity,
    order,
    floor: Math.floor((total * w) / sum),
    remainder: (total * w) % sum,
  }));
  let left = total - rows.reduce((s, r) => s + r.floor, 0);
  const byRemainder = [...rows].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const row of byRemainder) {
    if (left === 0) break;
    row.floor += 1;
    left -= 1;
  }
  for (const row of rows) out.set(row.rarity, row.floor);
  return out;
}

/** Counts per rarity for a deal of `total` cards with the host's enabled rarities. */
export function allocateRarityCounts(
  total: number,
  enabled: readonly Rarity[] = RARITIES,
): Map<Rarity, number> {
  return allocate(
    total,
    RARITIES.filter((r) => enabled.includes(r)).map((r) => [r, RARITY_WEIGHTS[r]]),
  );
}

export type PoolCheck =
  | { ok: true; counts: Map<Rarity, number> }
  | { ok: false; shortages: { rarity: Rarity; needed: number; available: number }[] };

/**
 * Pre-start pool validation: scarce eligible cards are an explicit error
 * (POOL_INSUFFICIENT), never silent duplication (rules §3.4).
 */
export function checkPool(
  total: number,
  enabled: readonly Rarity[],
  available: ReadonlyMap<Rarity, number>,
): PoolCheck {
  const counts = allocateRarityCounts(total, enabled);
  const shortages = [...counts]
    .filter(([rarity, needed]) => needed > (available.get(rarity) ?? 0))
    .map(([rarity, needed]) => ({ rarity, needed, available: available.get(rarity) ?? 0 }));
  return shortages.length ? { ok: false, shortages } : { ok: true, counts };
}

export interface CardSpec {
  /** Stable key: `single:<playerId>` or `dual:<a>+<b>`. */
  key: string;
  rarity: Rarity;
  playerIds: [string] | [string, string];
  ratings: Record<RatingMetric, number>;
  stars: 1 | 2 | 3 | 4 | 5;
}

const STAR_THRESHOLDS = [200, 450, 700, 900] as const;
const DUAL_CAP = 950;

/** Rank by role strength (desc), then within-role percentile, then ID — fully deterministic. */
function ranked(players: readonly PlayerRatings[]): PlayerRatings[] {
  return [...players].sort(
    (a, b) =>
      b.roleStrength - a.roleStrength ||
      b.roleStrengthPermille - a.roleStrengthPermille ||
      a.playerId.localeCompare(b.playerId),
  );
}

/**
 * Card catalog for a data version: one single card per player with a visual
 * rarity tier by role-strength rank (40/25/15/10/8, renormalized), plus dual
 * cards pairing the strongest players outside-in (rules §3.4: mean per
 * comparison, capped at 950; no identity in more than one pair).
 */
export function buildCatalog(players: readonly PlayerRatings[]): CardSpec[] {
  const order = ranked(players);
  const tiers = allocate(
    order.length,
    (['platinum', 'gold', 'silver', 'bronze', 'normal'] as const).map((r) => [
      r,
      RARITY_WEIGHTS[r],
    ]),
  );
  const cards: CardSpec[] = [];
  let index = 0;
  for (const rarity of ['platinum', 'gold', 'silver', 'bronze', 'normal'] as const) {
    for (let n = 0; n < (tiers.get(rarity) ?? 0); n += 1) {
      const p = order[index];
      index += 1;
      if (!p) break;
      cards.push({
        key: `single:${p.playerId}`,
        rarity,
        playerIds: [p.playerId],
        ratings: { ...p.ratings },
        stars: p.stars,
      });
    }
  }

  // Duals: 2 % of the final catalog → D ≈ N·2/98, pairing the top 2D outside-in.
  const dualCount = Math.min(
    Math.floor(order.length / 2),
    Number(roundDiv(BigInt(order.length) * 2n, 98n)),
  );
  const top = order.slice(0, dualCount * 2);
  for (let i = 0; i < dualCount; i += 1) {
    const a = top[i];
    const b = top[top.length - 1 - i];
    if (!a || !b || a.playerId === b.playerId) continue;
    const [first, second] = a.playerId < b.playerId ? [a, b] : [b, a];
    const ratings = {} as Record<RatingMetric, number>;
    for (const m of RATING_METRICS) {
      ratings[m] = Math.min(
        DUAL_CAP,
        Number(roundDiv(BigInt(first.ratings[m] + second.ratings[m]), 2n)),
      );
    }
    const pct = Number(
      roundDiv(BigInt(first.roleStrengthPermille + second.roleStrengthPermille), 2n),
    );
    let stars = 1;
    for (const t of STAR_THRESHOLDS) if (pct >= t) stars += 1;
    cards.push({
      key: `dual:${first.playerId}+${second.playerId}`,
      rarity: 'dual_platinum',
      playerIds: [first.playerId, second.playerId],
      ratings,
      stars: stars as 1 | 2 | 3 | 4 | 5,
    });
  }
  return cards;
}
