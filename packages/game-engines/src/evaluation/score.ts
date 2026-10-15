import { XI_RULES } from '../auction/xi';
import { rat, type Rational } from '../ratings/rational';
import { featuresOf, type EvalPlayer, type Features, type SquadRules } from './model';

/**
 * Exact squad score (rules §10). Components are on the 0–1000 points scale:
 *
 *   B = .45·mean(top7 batting) + .20·mean(best2 top-order) + .20·mean(best2 middle) + .15·best finisher
 *   W = .40·mean(top5 bowling) + .20·mean(best2 powerplay) + .20·mean(best2 death) + .10·best spin + .10·best pace
 *   A = .60·mean(best2 all-round) + .40·best keeper quality
 *   C = 1000·(.20·min(top/2,1) + .20·min(mid/2,1) + .15·min(fin,1) + .15·min(pp/2,1) + .15·min(death/2,1) + .15·min(spin/2,1))
 *   D = (.4·bench batting + .4·bench bowling + .2·bench keeper) · min(bench/(minSquad−11), 1)
 *   V = 1000·min(1, expected price / actual cost)
 *   Score = .30B + .30W + .10A + .15C + .10D + .05V
 *
 * Missing role slots score zero. Each component is held as an integer
 * numerator over a fixed denominator, so the optimizer compares exact
 * integers and the final ranking compares exact rationals.
 */

export const B_DEN = 1400;
export const W_DEN = 1000;
export const A_DEN = 1000;

export interface XiParts {
  /** B = bNum / 1400 */
  bNum: number;
  /** W = wNum / 1000 */
  wNum: number;
  /** A = aNum / 1000 */
  aNum: number;
  /** C (already an integer on the points scale) */
  c: number;
  /** D = dNum / (1000·k) with k = max(1, minSquad − 11) */
  dNum: number;
  counts: {
    topOrder: number;
    middle: number;
    finisher: number;
    powerplay: number;
    death: number;
    spin: number;
  };
}

export const benchK = (rules: SquadRules) => Math.max(1, rules.minSquad - XI_RULES.size);

/** Sum of the best `n` values (missing slots are zero). */
function bestSum(values: number[], n: number) {
  values.sort((a, b) => b - a);
  let s = 0;
  for (let i = 0; i < n && i < values.length; i += 1) s += values[i] ?? 0;
  return s;
}

/** Score parts of one XI (`inXi[i]` marks squad member i) — the readable reference path. */
export function xiParts(
  players: readonly EvalPlayer[],
  features: readonly Features[],
  inXi: readonly boolean[],
  rules: SquadRules,
): XiParts {
  const xi = players.map((p, i) => ({ p, f: features[i] as Features })).filter((_, i) => inXi[i]);
  const bench = players
    .map((p, i) => ({ p, f: features[i] as Features }))
    .filter((_, i) => !inXi[i]);
  const sum7 = bestSum(
    xi.map((x) => x.p.batting),
    7,
  );
  const top2 = bestSum(
    xi.filter((x) => x.f.topOrder).map((x) => x.p.powerplayBatting),
    2,
  );
  const mid2 = bestSum(
    xi.filter((x) => x.f.middle).map((x) => x.p.middleBatting),
    2,
  );
  const fin = bestSum(
    xi.filter((x) => x.f.finisher).map((x) => x.p.deathBatting),
    1,
  );
  const sum5 = bestSum(
    xi.filter((x) => x.f.bowlCap).map((x) => x.p.bowling),
    5,
  );
  const pp2 = bestSum(
    xi.filter((x) => x.f.powerplayOption).map((x) => x.p.powerplayBowling),
    2,
  );
  const death2 = bestSum(
    xi.filter((x) => x.f.deathOption).map((x) => x.p.deathBowling),
    2,
  );
  const spin = bestSum(
    xi.filter((x) => x.f.spin).map((x) => x.p.bowling),
    1,
  );
  const pace = bestSum(
    xi.filter((x) => x.f.pace).map((x) => x.p.bowling),
    1,
  );
  const ar2 = bestSum(
    xi.map((x) => x.f.allRound),
    2,
  );
  const keeper = bestSum(
    xi.filter((x) => x.f.keeper).map((x) => x.f.keeperQ10),
    1,
  );
  const counts = {
    topOrder: xi.filter((x) => x.f.topOrder).length,
    middle: xi.filter((x) => x.f.middle).length,
    finisher: xi.filter((x) => x.f.finisher).length,
    powerplay: xi.filter((x) => x.f.powerplayOption).length,
    death: xi.filter((x) => x.f.deathOption).length,
    spin: xi.filter((x) => x.f.spin).length,
  };
  const benchBat = bestSum(
    bench.map((x) => x.p.batting),
    1,
  );
  const benchBowl = bestSum(
    bench.filter((x) => x.f.bowlCap).map((x) => x.p.bowling),
    1,
  );
  const benchKeeper = bestSum(
    bench.filter((x) => x.f.keeper).map((x) => x.f.keeperQ10),
    1,
  );
  const k = benchK(rules);
  return {
    bNum: 90 * sum7 + 140 * top2 + 140 * mid2 + 210 * fin,
    wNum: 80 * sum5 + 100 * pp2 + 100 * death2 + 100 * spin + 100 * pace,
    aNum: 300 * ar2 + 40 * keeper,
    c: cValue(counts),
    dNum: (400 * benchBat + 400 * benchBowl + 20 * benchKeeper) * Math.min(bench.length, k),
    counts,
  };
}

export function cValue(c: XiParts['counts']) {
  const m2 = (n: number) => Math.min(n, 2);
  return (
    5 *
    (20 * m2(c.topOrder) +
      20 * m2(c.middle) +
      30 * Math.min(c.finisher, 1) +
      15 * m2(c.powerplay) +
      15 * m2(c.death) +
      15 * m2(c.spin))
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Common denominator of the XI-dependent part. */
export function xiDenominator(rules: SquadRules) {
  const a = 7000; // lcm(1400, 1000)
  const b = 1000 * benchK(rules);
  return (a / gcd(a, b)) * b;
}

/** 100·L·(.30B+.30W+.10A+.15C+.10D) as one exact integer (L = xiDenominator). */
export function xiObjective(parts: XiParts, rules: SquadRules) {
  const L = xiDenominator(rules);
  const k = benchK(rules);
  return (
    30 * parts.bNum * (L / B_DEN) +
    30 * parts.wNum * (L / W_DEN) +
    10 * parts.aNum * (L / A_DEN) +
    15 * parts.c * L +
    10 * parts.dNum * (L / (1000 * k))
  );
}

/** Median of positive rationals' inputs: (a+b)/2 for an even count. */
export function median(values: readonly bigint[]): Rational {
  if (values.length === 0) return rat(0);
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2
    ? rat(s[mid] as bigint)
    : rat((s[mid - 1] as bigint) + (s[mid] as bigint), 2n);
}

export interface PoolValueReference {
  /** Median base price (rupees) of the eligible pool. */
  medianBasePrice: Rational;
  /** Median of (500 + role strength) over the same pool. */
  medianQuality: Rational;
}

/**
 * V = 1000·min(1, Σexpected / max(1, Σcost)). Expected price is
 * purse/minSquad·(.5 + quality/1000) rescaled so the pool median equals the
 * median base price, which reduces to medianBase·(500+q)/median(500+q).
 * Money left unspent earns nothing.
 */
export function valueScore(squad: readonly EvalPlayer[], ref: PoolValueReference): Rational {
  const q = squad.reduce((s, p) => s + BigInt(500 + p.roleStrength), 0n);
  let cost = squad.reduce((s, p) => s + p.cost, 0n);
  if (cost < 1n) cost = 1n;
  if (ref.medianQuality.n === 0n) return rat(0);
  // ratio = medianBase · q / (medianQuality · cost)
  const num = ref.medianBasePrice.n * q * ref.medianQuality.d;
  const den = ref.medianBasePrice.d * ref.medianQuality.n * cost;
  return num >= den ? rat(1000) : rat(1000n * num, den);
}

/** Total on the points scale (0–1000) as an exact rational. */
export function totalScore(objective: number, rules: SquadRules, v: Rational): Rational {
  const L = BigInt(xiDenominator(rules));
  // (objective/L + 5V) / 100
  return rat(BigInt(objective) * v.d + 5n * v.n * L, 100n * L * v.d);
}

export interface ScoreReport {
  b: Rational;
  w: Rational;
  a: Rational;
  c: Rational;
  d: Rational;
  v: Rational;
  total: Rational;
  counts: XiParts['counts'];
}

/** Readable component breakdown of one XI for the result explanation. */
export function scoreReport(
  players: readonly EvalPlayer[],
  xiIds: ReadonlySet<string>,
  rules: SquadRules,
  ref: PoolValueReference,
): ScoreReport {
  const features = players.map(featuresOf);
  const parts = xiParts(
    players,
    features,
    players.map((p) => xiIds.has(p.id)),
    rules,
  );
  const v = valueScore(players, ref);
  return {
    b: rat(parts.bNum, B_DEN),
    w: rat(parts.wNum, W_DEN),
    a: rat(parts.aNum, A_DEN),
    c: rat(parts.c),
    d: rat(parts.dNum, 1000 * benchK(rules)),
    v,
    total: totalScore(xiObjective(parts, rules), rules, v),
    counts: parts.counts,
  };
}
