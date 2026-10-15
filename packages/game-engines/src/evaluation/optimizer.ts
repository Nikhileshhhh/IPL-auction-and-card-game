import { XI_RULES } from '../auction/xi';
import { featuresOf, type EvalPlayer, type Features, type SquadRules } from './model';
import { benchK, cValue, xiDenominator, xiObjective, type XiParts } from './score';

/**
 * Exact XI optimizer (rules §10): every 11-player combination of the squad is
 * visited in lexicographic order of player id (at most C(25,11) = 4,457,400),
 * illegal ones are skipped, and the best exact integer objective is kept; the
 * first maximum found is the lexicographically smallest, which is the tie
 * break. Work is done in resumable chunks: the state is just the next
 * combination rank and the best so far, so a restart continues exactly where
 * the last checkpoint stopped. There is no heuristic path.
 */

export const OPTIMIZER_CHUNK = 10_000;

export interface OptimizerState {
  /** Rank of the next combination to visit. */
  cursor: number;
  /** Total combinations C(n, 11). */
  total: number;
  /** Best objective so far (null until a legal XI is seen). */
  bestObjective: number | null;
  /** Bit mask over the squad (sorted by id) of the best XI. */
  bestMask: number | null;
}

export interface Prepared {
  players: EvalPlayer[];
  features: Features[];
  rules: SquadRules;
  n: number;
  L: number;
  k: number;
  masks: {
    overseas: number;
    keeper: number;
    bowl: number;
    pace: number;
    spin: number;
    bat: number;
    top: number;
    middle: number;
    finisher: number;
    powerplay: number;
    death: number;
  };
  /** Squad indexes ordered best-first for each metric (ties by index), with their values. */
  order: {
    batting: Ordered;
    topOrder: Ordered;
    middle: Ordered;
    finisher: Ordered;
    bowling: Ordered;
    powerplay: Ordered;
    death: Ordered;
    spin: Ordered;
    pace: Ordered;
    allRound: Ordered;
    keeper: Ordered;
  };
}

export interface Ordered {
  idx: Int32Array;
  val: Int32Array;
}

const byId = (a: EvalPlayer, b: EvalPlayer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Squads are evaluated with members sorted by player id (the tie-break order). */
export function prepare(players: readonly EvalPlayer[], rules: SquadRules): Prepared {
  if (players.length > 25) throw new Error('SQUAD_TOO_LARGE_FOR_OPTIMIZER');
  const sorted = [...players].sort(byId);
  const features = sorted.map(featuresOf);
  const maskOf = (pred: (f: Features) => boolean) =>
    features.reduce((m, f, i) => (pred(f) ? m | (1 << i) : m), 0);
  const orderBy = (pred: (i: number) => boolean, value: (i: number) => number): Ordered => {
    const idx = sorted
      .map((_, i) => i)
      .filter(pred)
      .sort((a, b) => value(b) - value(a) || a - b);
    return { idx: Int32Array.from(idx), val: Int32Array.from(idx.map(value)) };
  };
  const f = (i: number) => features[i] as Features;
  const p = (i: number) => sorted[i] as EvalPlayer;
  return {
    players: sorted,
    features,
    rules,
    n: sorted.length,
    L: xiDenominator(rules),
    k: benchK(rules),
    masks: {
      overseas: maskOf((x) => x.overseas),
      keeper: maskOf((x) => x.keeper),
      bowl: maskOf((x) => x.bowlCap),
      pace: maskOf((x) => x.pace),
      spin: maskOf((x) => x.spin),
      bat: maskOf((x) => x.batCap),
      top: maskOf((x) => x.topOrder),
      middle: maskOf((x) => x.middle),
      finisher: maskOf((x) => x.finisher),
      powerplay: maskOf((x) => x.powerplayOption),
      death: maskOf((x) => x.deathOption),
    },
    order: {
      batting: orderBy(
        () => true,
        (i) => p(i).batting,
      ),
      topOrder: orderBy(
        (i) => f(i).topOrder,
        (i) => p(i).powerplayBatting,
      ),
      middle: orderBy(
        (i) => f(i).middle,
        (i) => p(i).middleBatting,
      ),
      finisher: orderBy(
        (i) => f(i).finisher,
        (i) => p(i).deathBatting,
      ),
      bowling: orderBy(
        (i) => f(i).bowlCap,
        (i) => p(i).bowling,
      ),
      powerplay: orderBy(
        (i) => f(i).powerplayOption,
        (i) => p(i).powerplayBowling,
      ),
      death: orderBy(
        (i) => f(i).deathOption,
        (i) => p(i).deathBowling,
      ),
      spin: orderBy(
        (i) => f(i).spin,
        (i) => p(i).bowling,
      ),
      pace: orderBy(
        (i) => f(i).pace,
        (i) => p(i).bowling,
      ),
      allRound: orderBy(
        () => true,
        (i) => f(i).allRound,
      ),
      keeper: orderBy(
        (i) => f(i).keeper,
        (i) => f(i).keeperQ10,
      ),
    },
  };
}

export function initialState(prep: Prepared): OptimizerState {
  return { cursor: 0, total: binomial(prep.n, XI_RULES.size), bestObjective: null, bestMask: null };
}

function popcount(v: number) {
  let x = v - ((v >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function isLegalMask(prep: Prepared, mask: number) {
  const m = prep.masks;
  return (
    popcount(mask & m.overseas) <= XI_RULES.overseas &&
    popcount(mask & m.keeper) >= XI_RULES.keepers &&
    popcount(mask & m.bowl) >= XI_RULES.bowlers &&
    popcount(mask & m.pace) >= XI_RULES.pace &&
    popcount(mask & m.spin) >= XI_RULES.spin &&
    popcount(mask & m.bat) >= XI_RULES.batters
  );
}

/** Sum of the first `count` values whose squad index is inside (or outside) the mask. */
function take(o: Ordered, mask: number, count: number, inside = true) {
  const { idx, val } = o;
  let s = 0;
  let got = 0;
  const want = inside ? 1 : 0;
  for (let j = 0; j < idx.length && got < count; j += 1) {
    if (((mask >>> (idx[j] as number)) & 1) === want) {
      s += val[j] as number;
      got += 1;
    }
  }
  return s;
}

/** Fast integer score parts for a legal XI mask (same arithmetic as `xiParts`). */
export function partsOfMask(prep: Prepared, mask: number): XiParts {
  const o = prep.order;
  const m = prep.masks;
  const counts = {
    topOrder: popcount(mask & m.top),
    middle: popcount(mask & m.middle),
    finisher: popcount(mask & m.finisher),
    powerplay: popcount(mask & m.powerplay),
    death: popcount(mask & m.death),
    spin: popcount(mask & m.spin),
  };
  const bench = prep.n - XI_RULES.size;
  return {
    bNum:
      90 * take(o.batting, mask, 7) +
      140 * take(o.topOrder, mask, 2) +
      140 * take(o.middle, mask, 2) +
      210 * take(o.finisher, mask, 1),
    wNum:
      80 * take(o.bowling, mask, 5) +
      100 * take(o.powerplay, mask, 2) +
      100 * take(o.death, mask, 2) +
      100 * take(o.spin, mask, 1) +
      100 * take(o.pace, mask, 1),
    aNum: 300 * take(o.allRound, mask, 2) + 40 * take(o.keeper, mask, 1),
    c: cValue(counts),
    dNum:
      (400 * take(o.batting, mask, 1, false) +
        400 * take(o.bowling, mask, 1, false) +
        20 * take(o.keeper, mask, 1, false)) *
      Math.min(bench, prep.k),
    counts,
  };
}

/** The combination with lexicographic rank `rank` (indexes ascending). */
export function unrank(n: number, k: number, rank: number): number[] {
  const out: number[] = [];
  let x = 0;
  let r = rank;
  for (let slot = 0; slot < k; slot += 1) {
    for (;;) {
      const c = binomial(n - x - 1, k - slot - 1);
      if (r < c) break;
      r -= c;
      x += 1;
    }
    out.push(x);
    x += 1;
  }
  return out;
}

/** Advance to the next combination in place; false after the last one. */
function next(c: number[], n: number): boolean {
  const k = c.length;
  let i = k - 1;
  while (i >= 0 && (c[i] as number) === n - k + i) i -= 1;
  if (i < 0) return false;
  c[i] = (c[i] as number) + 1;
  for (let j = i + 1; j < k; j += 1) c[j] = (c[j - 1] as number) + 1;
  return true;
}

/** Visit up to `maxCombos` combinations from the state's cursor. */
export function optimizeChunk(
  prep: Prepared,
  state: OptimizerState,
  maxCombos = OPTIMIZER_CHUNK,
): OptimizerState {
  const k = XI_RULES.size;
  if (state.cursor >= state.total) return state;
  const comb = unrank(prep.n, k, state.cursor);
  let { bestObjective, bestMask } = state;
  let visited = 0;
  let more = true;
  while (more && visited < maxCombos) {
    let mask = 0;
    for (let j = 0; j < k; j += 1) mask |= 1 << (comb[j] as number);
    if (isLegalMask(prep, mask)) {
      const obj = xiObjective(partsOfMask(prep, mask), prep.rules);
      if (bestObjective === null || obj > bestObjective) {
        bestObjective = obj;
        bestMask = mask;
      }
    }
    visited += 1;
    more = next(comb, prep.n);
  }
  return { cursor: state.cursor + visited, total: state.total, bestObjective, bestMask };
}

/** Run to completion (tests and small squads). */
export function optimize(prep: Prepared): OptimizerState {
  let s = initialState(prep);
  while (s.cursor < s.total) s = optimizeChunk(prep, s, 1_000_000);
  return s;
}

export function maskIds(prep: Prepared, mask: number): string[] {
  return prep.players.filter((_, i) => ((mask >>> i) & 1) === 1).map((p) => p.id);
}
