import type { MatchLine, PlayerSeason } from '../cricket/aggregate';
import { isqrtRound } from './rational';
import { rawStats, type RawStats } from './v1';

/**
 * Career model for Attax-style cards (ADR-022, product owner 11 October 2026).
 *
 * Card stats come from a player's whole IPL career up to the cutoff (every
 * season from 2008), not from a recent window:
 * - **Batting** blends volume (career runs) with quality (batting average and
 *   strike rate). A batter with many runs at a good average rates highest.
 * - **Bowling** blends volume (career wickets) with quality (economy and
 *   bowling average).
 * - **Runs** is the player's career runs per innings, a real figure.
 *
 * Indexes are permille (0–1000) and use only + − × ÷, an integer square root
 * and rounding, so results are identical on every platform. The catalog maps
 * indexes onto tier bands (Bronze ≤ 89, legends' Gold 90–100).
 */
export const CAREER_MODEL_VERSION = 'ratings-career-v2';

export interface CareerCounts {
  innings: number;
  runs: number;
  balls: number;
  dismissals: number;
  bowlBalls: number;
  bowlRuns: number;
  wickets: number;
}

export interface CareerRating {
  playerId: string;
  /** Relative to the best batter in the pool, 0–1000 (0 = never batted). */
  batting: number;
  /** Relative to the best bowler in the pool, 0–1000 (0 = never bowled). */
  bowling: number;
  /** Career runs per batting innings × 10 (display = whole runs). */
  runs: number;
  /** Absolute indexes (permille), before relative scaling. */
  batIndex: number;
  bowlIndex: number;
  counts: CareerCounts;
  /** Career totals for the card detail drawer. */
  raw: RawStats;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** sqrt(n / max) in permille, via an exact integer square root. */
function volume(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Number(isqrtRound((BigInt(n) * 1_000_000n) / BigInt(max)));
}

/**
 * Batting quality: average (shrunk toward 20 with the weight of 5 dismissals)
 * on a 10–45 scale, and strike rate (shrunk toward 120 over 100 balls) on a
 * 100–165 scale, weighted 60/40.
 */
export function battingQuality(c: CareerCounts): number {
  const avg = (c.runs + 100) / (c.dismissals + 5);
  const sr = (100 * (c.runs + 120)) / (c.balls + 100);
  return Math.round(1000 * (0.6 * clamp01((avg - 10) / 35) + 0.4 * clamp01((sr - 100) / 65)));
}

/**
 * Bowling quality: economy (shrunk toward 9.0 over 60 balls) on a 10–6.5
 * scale and bowling average (shrunk toward 35 over 3 wickets) on a 40–17
 * scale, weighted equally.
 */
export function bowlingQuality(c: CareerCounts): number {
  const econ = (6 * (c.bowlRuns + 90)) / (c.bowlBalls + 60);
  const avg = (c.bowlRuns + 105) / (c.wickets + 3);
  return Math.round(1000 * (0.5 * clamp01((10 - econ) / 3.5) + 0.5 * clamp01((40 - avg) / 23)));
}

/**
 * Volume 55 %, quality 45 %. Quality counts in proportion to exposure
 * (balls / (balls + k)), so a part-timer's few overs never look elite.
 */
const blend = (vol: number, quality: number, balls: number, k: number) =>
  Math.round(0.55 * vol + (0.45 * quality * balls) / (balls + k));

/** Exposure at which quality counts half: 300 balls faced, 600 balls bowled. */
const K_BAT = 300;
const K_BOWL = 600;

/**
 * Career ratings for `players` from every season up to `cutoffDate`.
 * Scaling is relative to the best index among `players` (the published pool).
 */
export function careerRatings(input: {
  seasons: readonly PlayerSeason[];
  lines: ReadonlyMap<string, readonly MatchLine[]>;
  players: ReadonlySet<string>;
  cutoffDate: string;
}): Map<string, CareerRating> {
  const cutoffSeason = Number(input.cutoffDate.slice(0, 4));
  const bySeason = new Map<string, PlayerSeason[]>();
  for (const s of input.seasons) {
    if (!input.players.has(s.playerId) || s.season > cutoffSeason) continue;
    const list = bySeason.get(s.playerId) ?? [];
    list.push(s);
    bySeason.set(s.playerId, list);
  }
  const counts = new Map<string, CareerCounts>();
  for (const [id, list] of bySeason) {
    counts.set(
      id,
      list.reduce<CareerCounts>(
        (a, s) => ({
          innings: a.innings + s.bat.innings,
          runs: a.runs + s.bat.runs,
          balls: a.balls + s.bat.balls,
          dismissals: a.dismissals + s.bat.dismissals,
          bowlBalls: a.bowlBalls + s.bowl.balls,
          bowlRuns: a.bowlRuns + s.bowl.runs,
          wickets: a.wickets + s.bowl.wickets,
        }),
        { innings: 0, runs: 0, balls: 0, dismissals: 0, bowlBalls: 0, bowlRuns: 0, wickets: 0 },
      ),
    );
  }
  const maxRuns = Math.max(0, ...[...counts.values()].map((c) => c.runs));
  const maxWickets = Math.max(0, ...[...counts.values()].map((c) => c.wickets));
  const indexes = new Map<string, { bat: number; bowl: number }>();
  for (const [id, c] of counts) {
    indexes.set(id, {
      bat: c.balls > 0 ? blend(volume(c.runs, maxRuns), battingQuality(c), c.balls, K_BAT) : 0,
      bowl:
        c.bowlBalls > 0
          ? blend(volume(c.wickets, maxWickets), bowlingQuality(c), c.bowlBalls, K_BOWL)
          : 0,
    });
  }
  const bestBat = Math.max(1, ...[...indexes.values()].map((i) => i.bat));
  const bestBowl = Math.max(1, ...[...indexes.values()].map((i) => i.bowl));

  const out = new Map<string, CareerRating>();
  for (const id of [...counts.keys()].sort()) {
    const c = counts.get(id) as CareerCounts;
    const i = indexes.get(id) as { bat: number; bowl: number };
    const lines = (input.lines.get(id) ?? []).filter((l) => l.date <= input.cutoffDate);
    out.set(id, {
      playerId: id,
      batting: Math.round((1000 * i.bat) / bestBat),
      bowling: Math.round((1000 * i.bowl) / bestBowl),
      runs: c.innings > 0 ? Math.min(1000, Math.round((10 * c.runs) / c.innings)) : 0,
      batIndex: i.bat,
      bowlIndex: i.bowl,
      counts: c,
      raw: rawStats(bySeason.get(id) ?? [], lines),
    });
  }
  return out;
}
