import { CARD_METRICS, RARITIES, type CardMetric, type Rarity } from '@stumps/contracts';
import { roundDiv } from './rational';
import type { PlayerSeason } from '../cricket/aggregate';
import type { Role } from './v1';

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

export type CardStatPoints = Record<CardMetric, number>;

export interface CardSpec {
  /** Stable key: `single:<id>`, `legend:<id>:<rarity>` or `dual:<a>+<b>`. */
  key: string;
  rarity: Rarity;
  playerIds: [string] | [string, string];
  /** Batting and bowling 0–1000; runs = career runs per innings × 10. */
  ratings: CardStatPoints;
  stars: 1 | 2 | 3 | 4 | 5;
}

export interface CatalogPlan {
  /** Legends: Normal, Silver and Gold versions. */
  legends: ReadonlySet<string>;
  /** Named dual pairs (Platinum only); a pair with a missing player is skipped. */
  duals: readonly (readonly [string, string])[];
}

/** One rated player (career model, ADR-022). */
export interface CatalogPlayer {
  playerId: string;
  role: Role;
  /** Relative career batting and bowling, 0–1000. */
  batting: number;
  bowling: number;
  /** Career runs per innings × 10. */
  runs: number;
}

export const LEGEND_RARITIES = ['normal', 'silver', 'gold'] as const;

/**
 * Legend versions differ in strength (product owner, ADR-020 amendment): Gold
 * is the legend rating, Silver 96 % of it and Normal 92 %, for Batting and
 * Bowling, rounded half-up. Runs is a real career figure and never scaled.
 */
export const LEGEND_FACTORS: Readonly<Record<(typeof LEGEND_RARITIES)[number], number>> = {
  normal: 92,
  silver: 96,
  gold: 100,
};

/** Tier bands (product owner, ADR-022): Bronze tops out at 89, legends' Gold skill is 90–100. */
export const BRONZE_MAX = 890;
export const LEGEND_MIN = 900;
const STAR_THRESHOLDS = [450, 650, 800, 900] as const;

export function scaleRatings(ratings: Readonly<CardStatPoints>, percent: number): CardStatPoints {
  return {
    batting: Number(roundDiv(BigInt(ratings.batting) * BigInt(percent), 100n)),
    bowling: Number(roundDiv(BigInt(ratings.bowling) * BigInt(percent), 100n)),
    runs: ratings.runs,
  };
}

/** Stars from the card's best skill: 90+ five, 80+ four, 65+ three, 45+ two. */
export function starsOf(r: Readonly<CardStatPoints>): 1 | 2 | 3 | 4 | 5 {
  const best = Math.max(r.batting, r.bowling);
  let stars = 1;
  for (const t of STAR_THRESHOLDS) if (best >= t) stars += 1;
  return stars as 1 | 2 | 3 | 4 | 5;
}

/** A legend's main skill: batters and keepers bat, bowlers bowl, all-rounders their better one. */
export function primarySkill(p: CatalogPlayer): 'batting' | 'bowling' {
  if (p.role === 'bowler') return 'bowling';
  if (p.role === 'all_rounder') return p.bowling > p.batting ? 'bowling' : 'batting';
  return 'batting';
}

/**
 * Card catalog for a data version (ADR-020, ADR-022):
 * - every non-legend has one Bronze card, scaled so the best Bronze batter and
 *   bowler show 89 (never more);
 * - a legend has Normal, Silver and Gold. On Gold, the main skill spreads the
 *   legends over 90–100 by career rating (the best legend is 100); the other
 *   skill uses the Bronze scale. Silver is 96 % and Normal 92 % of Gold;
 * - Platinum is only for the named dual pairs and takes the better of the two
 *   players' Gold cards for each stat.
 */
export function buildCatalog(players: readonly CatalogPlayer[], plan: CatalogPlan): CardSpec[] {
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const order = [...players].sort((a, b) => a.playerId.localeCompare(b.playerId));
  const isLegend = (p: CatalogPlayer) => plan.legends.has(p.playerId);
  const bronze = order.filter((p) => !isLegend(p));
  const maxOf = (list: readonly CatalogPlayer[], s: 'batting' | 'bowling') =>
    Math.max(0, ...list.map((p) => p[s]));
  const bronzeMax = { batting: maxOf(bronze, 'batting'), bowling: maxOf(bronze, 'bowling') };
  const onBronzeScale = (v: number, s: 'batting' | 'bowling') =>
    bronzeMax[s] > 0
      ? Math.min(BRONZE_MAX, Number(roundDiv(BigInt(BRONZE_MAX * v), BigInt(bronzeMax[s]))))
      : 0;

  const legendBand = { batting: [Infinity, -Infinity], bowling: [Infinity, -Infinity] };
  for (const p of order.filter(isLegend)) {
    const s = primarySkill(p);
    legendBand[s] = [Math.min(legendBand[s][0] ?? 0, p[s]), Math.max(legendBand[s][1] ?? 0, p[s])];
  }
  const onLegendScale = (v: number, s: 'batting' | 'bowling') => {
    const [lo = v, hi = v] = legendBand[s];
    if (hi <= lo) return 1000;
    return LEGEND_MIN + Number(roundDiv(BigInt((1000 - LEGEND_MIN) * (v - lo)), BigInt(hi - lo)));
  };

  const goldOf = new Map<string, CardStatPoints>();
  const cards: CardSpec[] = [];
  for (const p of order) {
    if (isLegend(p)) {
      const main = primarySkill(p);
      const gold: CardStatPoints = {
        batting:
          main === 'batting'
            ? onLegendScale(p.batting, 'batting')
            : onBronzeScale(p.batting, 'batting'),
        bowling:
          main === 'bowling'
            ? onLegendScale(p.bowling, 'bowling')
            : onBronzeScale(p.bowling, 'bowling'),
        runs: p.runs,
      };
      goldOf.set(p.playerId, gold);
      for (const rarity of LEGEND_RARITIES) {
        const ratings = scaleRatings(gold, LEGEND_FACTORS[rarity]);
        cards.push({
          key: `legend:${p.playerId}:${rarity}`,
          rarity,
          playerIds: [p.playerId],
          ratings,
          stars: starsOf(ratings),
        });
      }
    } else {
      const ratings: CardStatPoints = {
        batting: onBronzeScale(p.batting, 'batting'),
        bowling: onBronzeScale(p.bowling, 'bowling'),
        runs: p.runs,
      };
      goldOf.set(p.playerId, ratings);
      cards.push({
        key: `single:${p.playerId}`,
        rarity: 'bronze',
        playerIds: [p.playerId],
        ratings,
        stars: starsOf(ratings),
      });
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
    const ga = goldOf.get(first.playerId) as CardStatPoints;
    const gb = goldOf.get(second.playerId) as CardStatPoints;
    const ratings = Object.fromEntries(
      CARD_METRICS.map((m) => [m, Math.max(ga[m], gb[m])] as const),
    ) as CardStatPoints;
    cards.push({
      key: `dual:${first.playerId}+${second.playerId}`,
      rarity: 'dual_platinum',
      playerIds: [first.playerId, second.playerId],
      ratings,
      stars: starsOf(ratings),
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
