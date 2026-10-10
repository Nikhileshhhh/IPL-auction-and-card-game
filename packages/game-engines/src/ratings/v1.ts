import type { MatchLine, Phase, PlayerSeason } from '../cricket/aggregate';
import { PHASES } from '../cricket/aggregate';
import { cmp, div, isqrtRound, neg, rat, roundDiv, shrinkTo, type Rational } from './rational';

/**
 * Ratings model v1 (rules §3.2–3.3) with the ADR-018 Attax-style display scale.
 *
 * Every rating is an integer 0–1000 (display: whole number 0–100). Component
 * metrics are exact rationals, shrunk toward cohort priors, converted to midrank
 * percentiles, combined with the fixed integer weights, then rank-rescaled across
 * the published cohort so the best batter is exactly 1000 (100) batting and the
 * best bowler exactly 1000 (100) bowling. A confirmed non-batter / non-bowler is 0;
 * among players with exposure the scale starts at 10 (display 1).
 */
export const RATINGS_MODEL_VERSION = 'ratings-v1-adr018';

export const RATING_METRICS = [
  'batting',
  'bowling',
  'fielding',
  'form',
  'experience',
  'versatility',
] as const;
export type RatingMetric = (typeof RATING_METRICS)[number];

export const PHASE_METRICS = [
  'powerplay_batting',
  'middle_batting',
  'death_batting',
  'powerplay_bowling',
  'middle_bowling',
  'death_bowling',
] as const;
export type PhaseMetric = (typeof PHASE_METRICS)[number];

export type Role = 'batter' | 'bowler' | 'all_rounder' | 'wicketkeeper';

/** Season weights oldest → latest (rules §3.2), renormalized over available seasons. */
const SEASON_WEIGHTS = [2n, 3n, 5n] as const;
const K_BALLS = 120n;
const K_APPEARANCES = 20n;
const RECENT_APPEARANCES = 10;
const STAR_THRESHOLDS = [200, 450, 700, 900] as const;

export interface RatingsInput {
  seasons: readonly PlayerSeason[];
  lines: ReadonlyMap<string, readonly MatchLine[]>;
  /** The three-season window ends at this season (inclusive). */
  latestSeason: number;
  /** Recent form uses the last 10 appearances on or before this date (YYYY-MM-DD). */
  cutoffDate: string;
  /** Total IPL appearances up to the cutoff (experience); defaults to window appearances. */
  careerAppearances?: ReadonlyMap<string, number>;
  /** Reviewed role corrections from the admin editor. */
  roleOverrides?: ReadonlyMap<string, Role>;
}

export interface RawStats {
  seasons: number[];
  matches: number;
  innings: number;
  runs: number;
  ballsFaced: number;
  notOuts: number;
  fours: number;
  sixes: number;
  highScore: number | null;
  /** null when the player was never dismissed (zero denominator stays null). */
  battingAverageX100: number | null;
  strikeRateX100: number | null;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  economyX100: number | null;
  bowlingAverageX100: number | null;
  bestBowling: { wickets: number; runs: number } | null;
  catches: number;
  runOuts: number;
  stumpings: number;
}

export interface PlayerRatings {
  playerId: string;
  role: Role;
  ratings: Record<RatingMetric, number>;
  phases: Record<PhaseMetric, number>;
  roleStrength: number;
  /** Within-role midrank percentile of role strength, permille. */
  roleStrengthPermille: number;
  stars: 1 | 2 | 3 | 4 | 5;
  primaryTeam: string | null;
  raw: RawStats;
}

// ------------------------------------------------------------------ helpers

interface Weighted {
  /** Σ weight·count, and Σ weight over seasons the player appeared in. */
  w: bigint;
  appearances: bigint;
  batBalls: bigint;
  batRuns: bigint;
  boundaries: bigint;
  dismissals: bigint;
  innings: bigint;
  contribution: bigint;
  bowlBalls: bigint;
  bowlRuns: bigint;
  wickets: bigint;
  dots: bigint;
  catches: bigint;
  runOuts: bigint;
  stumpings: bigint;
  phase: Record<
    Phase,
    {
      batBalls: bigint;
      batRuns: bigint;
      boundaries: bigint;
      dismissals: bigint;
      bowlBalls: bigint;
      bowlRuns: bigint;
      wickets: bigint;
      dots: bigint;
    }
  >;
}

const zeroPhase = () => ({
  batBalls: 0n,
  batRuns: 0n,
  boundaries: 0n,
  dismissals: 0n,
  bowlBalls: 0n,
  bowlRuns: 0n,
  wickets: 0n,
  dots: 0n,
});

/** [start, end) index ranges of equal neighbours in a sorted list. */
function tieGroups<T>(sorted: readonly T[], same: (a: T, b: T) => boolean): [number, number][] {
  const groups: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (i === sorted.length || prev === undefined || next === undefined || !same(prev, next)) {
      groups.push([start, i]);
      start = i;
    }
  }
  return sorted.length === 0 ? [] : groups;
}

/** Midrank percentiles (permille) for keyed rational values, higher is better. */
export function midrankPermille<K>(entries: readonly [K, Rational][]): Map<K, number> {
  const sorted = [...entries].sort((a, b) => cmp(a[1], b[1]));
  const out = new Map<K, number>();
  const m = BigInt(sorted.length);
  for (const [start, end] of tieGroups(sorted, (a, b) => cmp(a[1], b[1]) === 0)) {
    const q = Number(roundDiv(1000n * (2n * BigInt(start) + BigInt(end - start)), 2n * m));
    for (const [key] of sorted.slice(start, end)) out.set(key, q);
  }
  return out;
}

/**
 * ADR-018 rescale: rank among players with exposure, best → 1000, worst → 10
 * (display 1), ties share their midrank. A single player maps to 1000.
 */
export function rankRescale<K>(entries: readonly [K, number][]): Map<K, number> {
  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  const out = new Map<K, number>();
  const m = BigInt(sorted.length);
  for (const [start, end] of tieGroups(sorted, (a, b) => a[1] === b[1])) {
    const less = BigInt(start);
    const equal = BigInt(end - start);
    const q =
      m === 1n ? 1000 : 10 + Number(roundDiv(990n * (2n * less + equal - 1n), 2n * (m - 1n)));
    for (const [key] of sorted.slice(start, end)) out.set(key, q);
  }
  return out;
}

/** Fixed integer weights (sum 100 unless noted) → rounded integer. */
function combine(parts: readonly [number, number][], total = 100): number {
  let sum = 0n;
  for (const [weight, value] of parts) sum += BigInt(weight) * BigInt(value);
  return Number(roundDiv(sum, BigInt(total)));
}

function weightFor(season: number, latest: number): bigint | null {
  const offset = latest - season; // 0 latest, 2 oldest
  if (offset < 0 || offset > 2) return null;
  return SEASON_WEIGHTS[2 - offset] ?? null;
}

function deriveRole(w: Weighted): Role {
  if (w.stumpings > 0n) return 'wicketkeeper';
  // Per-appearance exposure, compared exactly: x/apps >= t  <=>  x >= t·apps.
  const bowl12 = w.bowlBalls >= 12n * w.appearances;
  const bat8 = w.batBalls >= 8n * w.appearances;
  if (bowl12 && bat8) return 'all_rounder';
  if (w.bowlBalls >= 9n * w.appearances) return 'bowler';
  return 'batter';
}

function starsFor(permille: number): 1 | 2 | 3 | 4 | 5 {
  let stars = 1;
  for (const t of STAR_THRESHOLDS) if (permille >= t) stars += 1;
  return stars as 1 | 2 | 3 | 4 | 5;
}

// --------------------------------------------------------- discipline indexes

interface BatCounts {
  balls: bigint;
  runs: bigint;
  boundaries: bigint;
  dismissals: bigint;
  innings: bigint;
  contribution: bigint;
}
interface BowlCounts {
  balls: bigint;
  runs: bigint;
  wickets: bigint;
  dots: bigint;
}
interface BatPriors {
  sr: Rational;
  rpd: Rational;
  bb: Rational;
  ic: Rational;
}
interface BowlPriors {
  wr: Rational;
  rpb: Rational;
  dot: Rational;
}

/** Exposure `scale` divides weighted counts back to effective (renormalized) units. */
function batComponents(c: BatCounts, scale: bigint, p: BatPriors, withContribution: boolean) {
  const n = rat(c.balls, scale);
  const sr = shrinkTo(rat(c.runs, c.balls), n, p.sr, K_BALLS);
  // Runs per dismissal handles no-dismissal samples with +5 pseudo-dismissals.
  const rpdRaw = div(
    rat(c.runs * p.rpd.d + 5n * scale * p.rpd.n, p.rpd.d),
    rat(c.dismissals + 5n * scale),
  );
  const rpd = shrinkTo(rpdRaw, n, p.rpd, K_BALLS);
  const bb = shrinkTo(rat(c.boundaries, c.balls), n, p.bb, K_BALLS);
  const ic =
    withContribution && c.innings > 0n
      ? shrinkTo(rat(c.contribution, c.innings), n, p.ic, K_BALLS)
      : null;
  return { sr, rpd, bb, ic };
}

function bowlComponents(c: BowlCounts, scale: bigint, p: BowlPriors) {
  const n = rat(c.balls, scale);
  return {
    wr: shrinkTo(rat(c.wickets, c.balls), n, p.wr, K_BALLS),
    // Economy is costly: lower runs per ball ranks higher.
    econ: neg(shrinkTo(rat(c.runs, c.balls), n, p.rpb, K_BALLS)),
    dot: shrinkTo(rat(c.dots, c.balls), n, p.dot, K_BALLS),
  };
}

/**
 * Proven ability (ADR-019 §1a): a discipline index is weighted by the credibility of
 * its sample, n/(n+K_BALLS), so a two-ball cameo cannot outrank a real record. The
 * scaled value keeps six extra digits so ranks stay exact; rankRescale maps it back
 * to 0–1000 (best = 1000).
 */
function credible(index: number, balls: bigint, scale: bigint): number {
  // n/(n+k) with n = balls/scale  ==  balls/(balls + k·scale)
  return Number(roundDiv(BigInt(index) * 1_000_000n * balls, balls + K_BALLS * scale));
}

function batIndexes(
  entries: readonly [string, BatCounts, bigint][],
  p: BatPriors,
  withContribution: boolean,
): Map<string, number> {
  const comps = entries.map(
    ([id, c, s]) => [id, batComponents(c, s, p, withContribution)] as const,
  );
  const sr = midrankPermille(comps.map(([id, x]) => [id, x.sr]));
  const rpd = midrankPermille(comps.map(([id, x]) => [id, x.rpd]));
  const bb = midrankPermille(comps.map(([id, x]) => [id, x.bb]));
  const ic = midrankPermille(
    comps.filter(([, x]) => x.ic !== null).map(([id, x]) => [id, x.ic as Rational]),
  );
  const counts = new Map(entries.map(([id, c, scale]) => [id, [c.balls, scale] as const]));
  const out = new Map<string, number>();
  for (const [id] of comps) {
    const [balls, scale] = counts.get(id) as readonly [bigint, bigint];
    const parts: [number, number][] = [
      [35, sr.get(id) ?? 0],
      [25, rpd.get(id) ?? 0],
      [20, bb.get(id) ?? 0],
    ];
    if (withContribution) parts.push([20, ic.get(id) ?? 0]);
    out.set(id, credible(combine(parts, withContribution ? 100 : 80), balls, scale));
  }
  return out;
}

function bowlIndexes(entries: readonly [string, BowlCounts, bigint][], p: BowlPriors) {
  const comps = entries.map(([id, c, s]) => [id, bowlComponents(c, s, p)] as const);
  const wr = midrankPermille(comps.map(([id, x]) => [id, x.wr]));
  const econ = midrankPermille(comps.map(([id, x]) => [id, x.econ]));
  const dot = midrankPermille(comps.map(([id, x]) => [id, x.dot]));
  const counts = new Map(entries.map(([id, c, scale]) => [id, [c.balls, scale] as const]));
  const out = new Map<string, number>();
  for (const [id] of comps) {
    const [balls, scale] = counts.get(id) as readonly [bigint, bigint];
    const index = combine([
      [40, wr.get(id) ?? 0],
      [35, econ.get(id) ?? 0],
      [25, dot.get(id) ?? 0],
    ]);
    out.set(id, credible(index, balls, scale));
  }
  return out;
}

function sumBat(list: readonly BatCounts[]) {
  return list.reduce(
    (a, c) => ({
      balls: a.balls + c.balls,
      runs: a.runs + c.runs,
      boundaries: a.boundaries + c.boundaries,
      dismissals: a.dismissals + c.dismissals,
      innings: a.innings + c.innings,
      contribution: a.contribution + c.contribution,
    }),
    { balls: 0n, runs: 0n, boundaries: 0n, dismissals: 0n, innings: 0n, contribution: 0n },
  );
}

function batPriors(list: readonly BatCounts[]): BatPriors {
  const t = sumBat(list);
  const safe = (n: bigint, d: bigint) => rat(n, d > 0n ? d : 1n);
  return {
    sr: safe(t.runs, t.balls),
    rpd: safe(t.runs, t.dismissals),
    bb: safe(t.boundaries, t.balls),
    ic: safe(t.contribution, t.innings),
  };
}

/**
 * Shrinkage priors (ADR-019 §1a). Low exposure is itself evidence in T20: a player
 * who faces few balls bats in the tail. Small samples therefore shrink toward the
 * pooled rates of the cohort's low-exposure players (under K_BALLS effective balls),
 * not toward the cohort mean, which top-order batters dominate. Falls back to the
 * whole cohort when no low-exposure player exists.
 */
function lowExposure<C extends { balls: bigint }>(entries: readonly (readonly [C, bigint])[]) {
  const low = entries.filter(([c, scale]) => c.balls < K_BALLS * scale).map(([c]) => c);
  return low.some((c) => c.balls > 0n) ? low : entries.map(([c]) => c);
}

function bowlPriors(list: readonly BowlCounts[]): BowlPriors {
  const t = list.reduce(
    (a, c) => ({
      balls: a.balls + c.balls,
      runs: a.runs + c.runs,
      wickets: a.wickets + c.wickets,
      dots: a.dots + c.dots,
    }),
    { balls: 0n, runs: 0n, wickets: 0n, dots: 0n },
  );
  const d = t.balls > 0n ? t.balls : 1n;
  return { wr: rat(t.wickets, d), rpb: rat(t.runs, d), dot: rat(t.dots, d) };
}

// ------------------------------------------------------------------- model

export function computeRatings(input: RatingsInput): PlayerRatings[] {
  const weighted = new Map<string, Weighted>();
  const teamApps = new Map<string, Map<string, number>>();
  const windowSeasons = new Map<string, Set<number>>();
  const plain = new Map<string, PlayerSeason[]>();

  for (const s of input.seasons) {
    const w = weightFor(s.season, input.latestSeason);
    if (w === null || s.appearances === 0) continue;
    let acc = weighted.get(s.playerId);
    if (!acc) {
      acc = {
        w: 0n,
        appearances: 0n,
        batBalls: 0n,
        batRuns: 0n,
        boundaries: 0n,
        dismissals: 0n,
        innings: 0n,
        contribution: 0n,
        bowlBalls: 0n,
        bowlRuns: 0n,
        wickets: 0n,
        dots: 0n,
        catches: 0n,
        runOuts: 0n,
        stumpings: 0n,
        phase: { powerplay: zeroPhase(), middle: zeroPhase(), death: zeroPhase() },
      };
      weighted.set(s.playerId, acc);
    }
    const W = (x: number) => w * BigInt(x);
    acc.w += w;
    acc.appearances += W(s.appearances);
    acc.batBalls += W(s.bat.balls);
    acc.batRuns += W(s.bat.runs);
    acc.boundaries += W(s.bat.fours + s.bat.sixes);
    acc.dismissals += W(s.bat.dismissals);
    acc.innings += W(s.bat.innings);
    acc.contribution += W(s.bat.contributionMicro);
    acc.bowlBalls += W(s.bowl.balls);
    acc.bowlRuns += W(s.bowl.runs);
    acc.wickets += W(s.bowl.wickets);
    acc.dots += W(s.bowl.dots);
    acc.catches += W(s.field.catches);
    acc.runOuts += W(s.field.runOuts);
    acc.stumpings += W(s.field.stumpings);
    for (const ph of PHASES) {
      const src = s.phases[ph];
      const dst = acc.phase[ph];
      dst.batBalls += W(src.bat.balls);
      dst.batRuns += W(src.bat.runs);
      dst.boundaries += W(src.bat.fours + src.bat.sixes);
      dst.dismissals += W(src.bat.dismissals);
      dst.bowlBalls += W(src.bowl.balls);
      dst.bowlRuns += W(src.bowl.runs);
      dst.wickets += W(src.bowl.wickets);
      dst.dots += W(src.bowl.dots);
    }
    const teams = teamApps.get(s.playerId) ?? new Map<string, number>();
    // Latest season dominates the displayed franchise.
    for (const [team, n] of Object.entries(s.teams)) {
      teams.set(team, (teams.get(team) ?? 0) + n * Number(w) * 100 + s.season);
    }
    teamApps.set(s.playerId, teams);
    const seen = windowSeasons.get(s.playerId) ?? new Set<number>();
    seen.add(s.season);
    windowSeasons.set(s.playerId, seen);
    const own = plain.get(s.playerId) ?? [];
    own.push(s);
    plain.set(s.playerId, own);
  }

  const ids = [...weighted.keys()].sort();
  const batOf = (a: Weighted): BatCounts => ({
    balls: a.batBalls,
    runs: a.batRuns,
    boundaries: a.boundaries,
    dismissals: a.dismissals,
    innings: a.innings,
    contribution: a.contribution,
  });
  const bowlOf = (a: Weighted): BowlCounts => ({
    balls: a.bowlBalls,
    runs: a.bowlRuns,
    wickets: a.wickets,
    dots: a.dots,
  });
  const all = ids.map((id) => [id, weighted.get(id) as Weighted] as const);

  // Batting and bowling (priors over the whole cohort; percentiles among players with exposure).
  const bP = batPriors(lowExposure(all.map(([, a]) => [batOf(a), a.w] as const)));
  const wP = bowlPriors(
    lowExposure(all.filter(([, a]) => a.bowlBalls > 0n).map(([, a]) => [bowlOf(a), a.w] as const)),
  );
  const battingIdx = batIndexes(
    all.filter(([, a]) => a.batBalls > 0n).map(([id, a]) => [id, batOf(a), a.w]),
    bP,
    true,
  );
  const bowlingIdx = bowlIndexes(
    all.filter(([, a]) => a.bowlBalls > 0n).map(([id, a]) => [id, bowlOf(a), a.w]),
    wP,
  );
  const batting = rankRescale([...battingIdx]);
  const bowling = rankRescale([...bowlingIdx]);

  // Roles (reviewed overrides win).
  const roles = new Map<string, Role>();
  for (const [id, a] of all) roles.set(id, input.roleOverrides?.get(id) ?? deriveRole(a));

  // Fielding: keeper and outfielder percentiles computed separately (rules §3.2.1).
  const fieldingIdx = new Map<string, number>();
  for (const keeper of [true, false]) {
    const group = all.filter(([id]) => (roles.get(id) === 'wicketkeeper') === keeper);
    if (group.length === 0) continue;
    const apps = group.reduce((s, [, a]) => s + a.appearances, 0n) || 1n;
    const muC = rat(
      group.reduce((s, [, a]) => s + a.catches, 0n),
      apps,
    );
    const muR = rat(
      group.reduce((s, [, a]) => s + a.runOuts, 0n),
      apps,
    );
    const muS = rat(
      group.reduce((s, [, a]) => s + a.stumpings, 0n),
      apps,
    );
    const comp = group.map(([id, a]) => {
      const n = rat(a.appearances, a.w);
      return [
        id,
        {
          c: shrinkTo(rat(a.catches, a.appearances), n, muC, K_APPEARANCES),
          r: shrinkTo(rat(a.runOuts, a.appearances), n, muR, K_APPEARANCES),
          s: shrinkTo(rat(a.stumpings, a.appearances), n, muS, K_APPEARANCES),
        },
      ] as const;
    });
    const c = midrankPermille(comp.map(([id, x]) => [id, x.c]));
    const r = midrankPermille(comp.map(([id, x]) => [id, x.r]));
    const s = midrankPermille(comp.map(([id, x]) => [id, x.s]));
    for (const [id] of comp) {
      fieldingIdx.set(
        id,
        combine([
          [60, c.get(id) ?? 0],
          [25, r.get(id) ?? 0],
          // A non-keeper's genuine zero stumpings is zero, not missing.
          [15, keeper ? (s.get(id) ?? 0) : 0],
        ]),
      );
    }
  }
  const fielding = rankRescale([...fieldingIdx]);

  // Form: last 10 appearances before the cutoff, same formulas, cohort priors.
  const recent = new Map<string, MatchLine[]>();
  for (const id of ids) {
    const lines = (input.lines.get(id) ?? []).filter((l) => l.date <= input.cutoffDate);
    recent.set(id, lines.slice(-RECENT_APPEARANCES));
  }
  const recentBat = (lines: readonly MatchLine[]): BatCounts => ({
    balls: BigInt(lines.reduce((s, l) => s + l.bat.balls, 0)),
    runs: BigInt(lines.reduce((s, l) => s + l.bat.runs, 0)),
    boundaries: BigInt(lines.reduce((s, l) => s + l.bat.fours + l.bat.sixes, 0)),
    dismissals: BigInt(lines.reduce((s, l) => s + l.bat.dismissals, 0)),
    innings: BigInt(lines.filter((l) => l.batted).length),
    contribution: BigInt(lines.reduce((s, l) => s + l.bat.contributionMicro, 0)),
  });
  const recentBowl = (lines: readonly MatchLine[]): BowlCounts => ({
    balls: BigInt(lines.reduce((s, l) => s + l.bowl.balls, 0)),
    runs: BigInt(lines.reduce((s, l) => s + l.bowl.runs, 0)),
    wickets: BigInt(lines.reduce((s, l) => s + l.bowl.wickets, 0)),
    dots: BigInt(lines.reduce((s, l) => s + l.bowl.dots, 0)),
  });
  const recentBatIdx = batIndexes(
    ids
      .map((id) => [id, recentBat(recent.get(id) ?? []), 1n] as [string, BatCounts, bigint])
      .filter(([, c]) => c.balls > 0n),
    bP,
    true,
  );
  const recentBowlIdx = bowlIndexes(
    ids
      .map((id) => [id, recentBowl(recent.get(id) ?? []), 1n] as [string, BowlCounts, bigint])
      .filter(([, c]) => c.balls > 0n),
    wP,
  );
  // Form always comes from the player's own latest appearances (up to 10, at least one
  // exists for everyone in the cohort); exposure shrinkage handles short samples.
  const formIdx = new Map<string, number>();
  for (const id of ids) {
    const role = roles.get(id) as Role;
    const bat = recentBatIdx.get(id) ?? 0;
    const bowl = recentBowlIdx.get(id) ?? 0;
    formIdx.set(
      id,
      role === 'all_rounder'
        ? combine([
            [50, bat],
            [50, bowl],
          ])
        : role === 'bowler'
          ? bowl
          : bat,
    );
  }
  const form = rankRescale([...formIdx]);

  // Experience: percentile of career appearances (log is monotonic, so ranks suffice).
  const experience = rankRescale(
    ids.map((id) => [
      id,
      input.careerAppearances?.get(id) ??
        Number((weighted.get(id) as Weighted).appearances / (weighted.get(id) as Weighted).w),
    ]),
  );

  // Phase indexes from each player's own phase deliveries; none in a phase is a real 0.
  const phaseRatings = new Map<string, Record<PhaseMetric, number>>();
  for (const id of ids) phaseRatings.set(id, {} as Record<PhaseMetric, number>);
  for (const ph of PHASES) {
    const covBat = all.filter(([, a]) => a.phase[ph].batBalls > 0n);
    const covBowl = all.filter(([, a]) => a.phase[ph].bowlBalls > 0n);
    const pb = batIndexes(
      covBat.map(([id, a]) => [
        id,
        {
          balls: a.phase[ph].batBalls,
          runs: a.phase[ph].batRuns,
          boundaries: a.phase[ph].boundaries,
          dismissals: a.phase[ph].dismissals,
          innings: 0n,
          contribution: 0n,
        },
        a.w,
      ]),
      bP,
      false,
    );
    const pw = bowlIndexes(
      covBowl.map(([id, a]) => [
        id,
        {
          balls: a.phase[ph].bowlBalls,
          runs: a.phase[ph].bowlRuns,
          wickets: a.phase[ph].wickets,
          dots: a.phase[ph].dots,
        },
        a.w,
      ]),
      wP,
    );
    const rb = rankRescale([...pb]);
    const rw = rankRescale([...pw]);
    for (const id of ids) {
      const batKey = `${ph}_batting` as PhaseMetric;
      const bowlKey = `${ph}_bowling` as PhaseMetric;
      const target = phaseRatings.get(id) as Record<PhaseMetric, number>;
      target[batKey] = rb.get(id) ?? 0;
      target[bowlKey] = rw.get(id) ?? 0;
    }
  }

  // Assemble, then role strength → within-role percentile → stars.
  const result: PlayerRatings[] = ids.map((id) => {
    const role = roles.get(id) as Role;
    const ratings: Record<RatingMetric, number> = {
      batting: batting.get(id) ?? 0,
      bowling: bowling.get(id) ?? 0,
      fielding: fielding.get(id) ?? 0,
      form: form.get(id) ?? 0,
      experience: experience.get(id) ?? 0,
      versatility: 0,
    };
    ratings.versatility = Number(isqrtRound(BigInt(ratings.batting) * BigInt(ratings.bowling)));
    const roleStrength =
      role === 'all_rounder'
        ? combine([
            [40, ratings.batting],
            [40, ratings.bowling],
            [10, ratings.form],
            [10, ratings.fielding],
          ])
        : combine([
            [70, role === 'bowler' ? ratings.bowling : ratings.batting],
            [20, ratings.form],
            [10, ratings.fielding],
          ]);
    const teams = [...(teamApps.get(id) ?? new Map<string, number>())].sort(
      (x, y) => y[1] - x[1] || x[0].localeCompare(y[0]),
    );
    return {
      playerId: id,
      role,
      ratings,
      phases: phaseRatings.get(id) as Record<PhaseMetric, number>,
      roleStrength,
      roleStrengthPermille: 0,
      stars: 1,
      primaryTeam: teams[0]?.[0] ?? null,
      raw: rawStats(plain.get(id) ?? [], recentWindowLines(input, id, windowSeasons.get(id))),
    };
  });

  for (const role of ['batter', 'bowler', 'all_rounder', 'wicketkeeper'] as const) {
    const group = result.filter((r) => r.role === role);
    const pct = midrankPermille(group.map((r) => [r.playerId, rat(r.roleStrength)]));
    for (const r of group) {
      r.roleStrengthPermille = pct.get(r.playerId) ?? 0;
      r.stars = starsFor(r.roleStrengthPermille);
    }
  }
  return result;
}

function recentWindowLines(
  input: RatingsInput,
  id: string,
  seasons: ReadonlySet<number> | undefined,
): readonly MatchLine[] {
  const set = seasons ?? new Set<number>();
  return (input.lines.get(id) ?? []).filter(
    (l) => set.has(Number(l.date.slice(0, 4))) && l.date <= input.cutoffDate,
  );
}

/** Unweighted window totals for the card detail drawer (sourced raw statistics). */
function rawStats(list: readonly PlayerSeason[], lines: readonly MatchLine[]): RawStats {
  const t = list.reduce(
    (a, s) => ({
      matches: a.matches + s.appearances,
      innings: a.innings + s.bat.innings,
      runs: a.runs + s.bat.runs,
      balls: a.balls + s.bat.balls,
      notOuts: a.notOuts + s.bat.notOuts,
      dismissals: a.dismissals + s.bat.dismissals,
      fours: a.fours + s.bat.fours,
      sixes: a.sixes + s.bat.sixes,
      bowlBalls: a.bowlBalls + s.bowl.balls,
      bowlRuns: a.bowlRuns + s.bowl.runs,
      wickets: a.wickets + s.bowl.wickets,
      catches: a.catches + s.field.catches,
      runOuts: a.runOuts + s.field.runOuts,
      stumpings: a.stumpings + s.field.stumpings,
    }),
    {
      matches: 0,
      innings: 0,
      runs: 0,
      balls: 0,
      notOuts: 0,
      dismissals: 0,
      fours: 0,
      sixes: 0,
      bowlBalls: 0,
      bowlRuns: 0,
      wickets: 0,
      catches: 0,
      runOuts: 0,
      stumpings: 0,
    },
  );
  const x100 = (n: number, d: number) => (d > 0 ? Math.floor((200 * n + d) / (2 * d)) : null);
  const batted = lines.filter((l) => l.batted);
  const bowled = lines.filter((l) => l.bowl.balls > 0);
  const best = bowled.reduce<{ wickets: number; runs: number } | null>((b, l) => {
    if (!b || l.bowl.wickets > b.wickets || (l.bowl.wickets === b.wickets && l.bowl.runs < b.runs))
      return { wickets: l.bowl.wickets, runs: l.bowl.runs };
    return b;
  }, null);
  return {
    seasons: [...new Set(list.map((s) => s.season))].sort(),
    matches: t.matches,
    innings: t.innings,
    runs: t.runs,
    ballsFaced: t.balls,
    notOuts: t.notOuts,
    fours: t.fours,
    sixes: t.sixes,
    highScore: batted.length ? Math.max(...batted.map((l) => l.bat.runs)) : null,
    battingAverageX100: x100(t.runs, t.dismissals),
    strikeRateX100: x100(100 * t.runs, t.balls),
    ballsBowled: t.bowlBalls,
    runsConceded: t.bowlRuns,
    wickets: t.wickets,
    economyX100: x100(6 * t.bowlRuns, t.bowlBalls),
    bowlingAverageX100: x100(t.bowlRuns, t.wickets),
    bestBowling: best,
    catches: t.catches,
    runOuts: t.runOuts,
    stumpings: t.stumpings,
  };
}

/** Display a 0–1000 rating as an Attax-style whole number 0–100 (half up). */
export function displayRating(points: number): number {
  return Math.floor((points + 5) / 10);
}
