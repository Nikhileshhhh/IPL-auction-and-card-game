import { RARITIES, type Rarity } from '@stumps/contracts';
import { roundDiv } from './rational';
import type { PlayerSeason } from '../cricket/aggregate';
import { RATING_METRICS, type PlayerRatings, type RatingMetric } from './v1';

/**
 * Default deal mix in percent (rules §3.4), rarity enum order. Visual only (R19).
 * A deal from a real catalog follows the catalog's own mix instead (ADR-020).
 */
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

/**
 * Counts per rarity for a deal of `total` cards with the host's enabled rarities.
 * With the pool's `available` counts the deal mirrors the catalog mix (ADR-020:
 * Bronze singles, three legend versions, Platinum duals), else the default mix.
 */
export function allocateRarityCounts(
  total: number,
  enabled: readonly Rarity[] = RARITIES,
  available?: ReadonlyMap<Rarity, number>,
): Map<Rarity, number> {
  return allocate(
    total,
    RARITIES.filter((r) => enabled.includes(r)).map((r) => [
      r,
      available ? (available.get(r) ?? 0) : RARITY_WEIGHTS[r],
    ]),
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
  const counts = allocateRarityCounts(total, enabled, available);
  const shortages = [...counts]
    .filter(([rarity, needed]) => needed > (available.get(rarity) ?? 0))
    .map(([rarity, needed]) => ({ rarity, needed, available: available.get(rarity) ?? 0 }));
  return shortages.length ? { ok: false, shortages } : { ok: true, counts };
}

export interface CardSpec {
  /** Stable key: `single:<id>`, `legend:<id>:<rarity>` or `dual:<a>+<b>`. */
  key: string;
  rarity: Rarity;
  playerIds: [string] | [string, string];
  ratings: Record<RatingMetric, number>;
  stars: 1 | 2 | 3 | 4 | 5;
}

export interface CatalogPlan {
  /** Legends (100+ IPL matches for one franchise): Normal, Silver and Gold versions. */
  legends: ReadonlySet<string>;
  /** Named dual pairs (Platinum only); a pair with a missing player is skipped. */
  duals: readonly (readonly [string, string])[];
}

const STAR_THRESHOLDS = [200, 450, 700, 900] as const;
const DUAL_CAP = 950;
export const LEGEND_RARITIES = ['normal', 'silver', 'gold'] as const;

/**
 * Card catalog for a data version (ADR-020, product-owner rule):
 * - every player has one Bronze card;
 * - a legend instead has three versions, Normal, Silver and Gold;
 * - Platinum exists only as dual cards of the named pairs (mean per comparison,
 *   capped at 950, rules §3.4).
 *
 * Rarity is visual only (R19): every version shows the player's own ratings.
 */
export function buildCatalog(players: readonly PlayerRatings[], plan: CatalogPlan): CardSpec[] {
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const order = [...players].sort((a, b) => a.playerId.localeCompare(b.playerId));
  const cards: CardSpec[] = [];
  for (const p of order) {
    const base = { playerIds: [p.playerId] as [string], ratings: { ...p.ratings }, stars: p.stars };
    if (plan.legends.has(p.playerId)) {
      for (const rarity of LEGEND_RARITIES) {
        cards.push({ key: `legend:${p.playerId}:${rarity}`, rarity, ...base });
      }
    } else {
      cards.push({ key: `single:${p.playerId}`, rarity: 'bronze', ...base });
    }
  }

  const paired = new Set<string>();
  for (const [x, y] of plan.duals) {
    const a = byId.get(x);
    const b = byId.get(y);
    const key = [x, y].sort().join('+');
    if (!a || !b || x === y || paired.has(key)) continue;
    paired.add(key);
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

/** Renamed franchises count as one (2008–2026 IPL history). */
export const FRANCHISE_ALIASES: Readonly<Record<string, string>> = {
  'Delhi Daredevils': 'Delhi Capitals',
  'Kings XI Punjab': 'Punjab Kings',
  'Royal Challengers Bangalore': 'Royal Challengers Bengaluru',
  'Rising Pune Supergiants': 'Rising Pune Supergiant',
};

export interface Legend {
  /** The franchise represented in 100+ matches (the most, if several). */
  team: string;
  matches: number;
  /** The player's latest IPL season (any franchise). */
  lastSeason: number;
}

/**
 * Legends (ADR-020): players with at least `minMatches` IPL appearances for a
 * single franchise across all seasons in `seasons`.
 */
export function findLegends(
  seasons: readonly PlayerSeason[],
  minMatches = 100,
): Map<string, Legend> {
  const apps = new Map<string, Map<string, number>>();
  const last = new Map<string, number>();
  for (const s of seasons) {
    last.set(s.playerId, Math.max(last.get(s.playerId) ?? 0, s.season));
    const byTeam = apps.get(s.playerId) ?? new Map<string, number>();
    for (const [team, n] of Object.entries(s.teams)) {
      const t = FRANCHISE_ALIASES[team] ?? team;
      byTeam.set(t, (byTeam.get(t) ?? 0) + n);
    }
    apps.set(s.playerId, byTeam);
  }
  const out = new Map<string, Legend>();
  for (const [id, byTeam] of [...apps].sort(([a], [b]) => a.localeCompare(b))) {
    const best = [...byTeam].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best && best[1] >= minMatches) {
      out.set(id, { team: best[0], matches: best[1], lastSeason: last.get(id) ?? 0 });
    }
  }
  return out;
}
