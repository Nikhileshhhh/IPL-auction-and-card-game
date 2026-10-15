import { describe, expect, it } from 'vitest';
import {
  XI_RULES,
  gameQualifies,
  initialState,
  isqrt,
  maskIds,
  medalPlacements,
  optimize,
  optimizeChunk,
  partsOfMask,
  prepare,
  presentEnough,
  rankSquads,
  rat,
  cmp,
  scoreReport,
  squadDeficits,
  tallyVote,
  totalScore,
  unrank,
  valueScore,
  voteThreshold,
  xiObjective,
  type EvalPlayer,
  type PoolValueReference,
  type Rational,
  type SquadRules,
} from '../src';

/* ------------------------------------------------------------------ oracle */
// An independent, deliberately literal reading of rules §10 in exact BigInt
// fractions, used to check the optimizer's integer arithmetic and its search.

class F {
  constructor(
    readonly n: bigint,
    readonly d: bigint = 1n,
  ) {}
  static of(n: number | bigint, d: number | bigint = 1) {
    return new F(BigInt(n), BigInt(d));
  }
  add(o: F) {
    return new F(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  mul(o: F) {
    return new F(this.n * o.n, this.d * o.d);
  }
  cmp(o: F) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  min(o: F) {
    return this.cmp(o) <= 0 ? this : o;
  }
}
const sum = (xs: F[]) => xs.reduce((a, b) => a.add(b), F.of(0));
/** mean over `slots` slots of the best values; missing slots count zero. */
const meanBest = (values: number[], slots: number) =>
  F.of(
    [...values]
      .sort((a, b) => b - a)
      .slice(0, slots)
      .reduce((a, b) => a + b, 0),
    slots,
  );
const best = (values: number[]) => F.of(values.length ? Math.max(...values) : 0);

function oracle(squad: EvalPlayer[], xi: EvalPlayer[], rules: SquadRules, ref: PoolValueReference) {
  const bench = squad.filter((p) => !xi.includes(p));
  const batCap = (p: EvalPlayer) => p.role !== 'bowler';
  const bowlCap = (p: EvalPlayer) => p.role === 'bowler' || p.role === 'all_rounder';
  const phase = (p: EvalPlayer) => {
    const v = [p.powerplayBatting, p.middleBatting, p.deathBatting];
    return v.indexOf(Math.max(...v));
  };
  const top = xi.filter((p) => batCap(p) && phase(p) === 0);
  const mid = xi.filter((p) => batCap(p) && phase(p) === 1);
  const fin = xi.filter((p) => batCap(p) && phase(p) === 2);
  const pp = xi.filter((p) => bowlCap(p) && p.powerplayBowling >= 400);
  const death = xi.filter((p) => bowlCap(p) && p.deathBowling >= 400);
  const spin = xi.filter((p) => bowlCap(p) && p.bowlType === 'spin');
  const pace = xi.filter((p) => bowlCap(p) && p.bowlType === 'pace');
  const keeperQ = (p: EvalPlayer) => F.of(7 * p.batting + 3 * p.fielding, 10);
  const B = sum([
    F.of(45, 100).mul(
      meanBest(
        xi.map((p) => p.batting),
        7,
      ),
    ),
    F.of(20, 100).mul(
      meanBest(
        top.map((p) => p.powerplayBatting),
        2,
      ),
    ),
    F.of(20, 100).mul(
      meanBest(
        mid.map((p) => p.middleBatting),
        2,
      ),
    ),
    F.of(15, 100).mul(best(fin.map((p) => p.deathBatting))),
  ]);
  const W = sum([
    F.of(40, 100).mul(
      meanBest(
        xi.filter(bowlCap).map((p) => p.bowling),
        5,
      ),
    ),
    F.of(20, 100).mul(
      meanBest(
        pp.map((p) => p.powerplayBowling),
        2,
      ),
    ),
    F.of(20, 100).mul(
      meanBest(
        death.map((p) => p.deathBowling),
        2,
      ),
    ),
    F.of(10, 100).mul(best(spin.map((p) => p.bowling))),
    F.of(10, 100).mul(best(pace.map((p) => p.bowling))),
  ]);
  const keepers = xi.filter((p) => p.role === 'wicketkeeper');
  const bestKeeper = keepers.length
    ? keepers.map(keeperQ).reduce((a, b) => (a.cmp(b) >= 0 ? a : b))
    : F.of(0);
  const A = sum([
    F.of(60, 100).mul(
      meanBest(
        xi.map((p) => isqrt(p.batting * p.bowling)),
        2,
      ),
    ),
    F.of(40, 100).mul(bestKeeper),
  ]);
  const cap = (n: number, d: number) => F.of(n, d).min(F.of(1));
  const C = F.of(1000).mul(
    sum([
      F.of(20, 100).mul(cap(top.length, 2)),
      F.of(20, 100).mul(cap(mid.length, 2)),
      F.of(15, 100).mul(cap(fin.length, 1)),
      F.of(15, 100).mul(cap(pp.length, 2)),
      F.of(15, 100).mul(cap(death.length, 2)),
      F.of(15, 100).mul(cap(spin.length, 2)),
    ]),
  );
  const benchKeepers = bench.filter((p) => p.role === 'wicketkeeper');
  const backupKeeper = benchKeepers.length
    ? benchKeepers.map(keeperQ).reduce((a, b) => (a.cmp(b) >= 0 ? a : b))
    : F.of(0);
  const mult =
    rules.minSquad - 11 <= 0
      ? F.of(bench.length >= 1 ? 1 : 0)
      : F.of(bench.length, rules.minSquad - 11).min(F.of(1));
  const D = sum([
    F.of(4, 10).mul(best(bench.map((p) => p.batting))),
    F.of(4, 10).mul(best(bench.filter(bowlCap).map((p) => p.bowling))),
    F.of(2, 10).mul(backupKeeper),
  ]).mul(mult);
  const v: Rational = valueScore(squad, ref);
  const V = new F(v.n, v.d);
  return sum([
    F.of(30, 100).mul(B),
    F.of(30, 100).mul(W),
    F.of(10, 100).mul(A),
    F.of(15, 100).mul(C),
    F.of(10, 100).mul(D),
    F.of(5, 100).mul(V),
  ]);
}

/* --------------------------------------------------------------- fixtures */
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

function squad(seed: number, size: number): EvalPlayer[] {
  const r = rng(seed);
  const roles: EvalPlayer['role'][] = ['batter', 'wicketkeeper', 'all_rounder', 'bowler'];
  return Array.from({ length: size }, (_, i) => {
    // Guarantee the XI rules can be met, then randomise the rest.
    const role =
      i === 0
        ? 'wicketkeeper'
        : i < 4
          ? 'batter'
          : i < 9
            ? 'bowler'
            : (roles[r(4)] as EvalPlayer['role']);
    const bowls = role === 'bowler' || role === 'all_rounder';
    return {
      id: `p${String(r(1_000_000)).padStart(7, '0')}${i}`,
      role,
      bowlType: bowls ? (i === 4 ? 'spin' : i < 7 ? 'pace' : r(2) ? 'pace' : 'spin') : null,
      overseas: r(3) === 0,
      batting: r(1001),
      bowling: bowls ? r(1001) : r(200),
      fielding: r(1001),
      powerplayBatting: r(1001),
      middleBatting: r(1001),
      deathBatting: r(1001),
      powerplayBowling: bowls ? r(1001) : 0,
      deathBowling: bowls ? r(1001) : 0,
      roleStrength: r(1001),
      completeness: 10,
      cost: BigInt(2_000_000 + r(100) * 1_000_000),
    };
  });
}

const REF: PoolValueReference = { medianBasePrice: rat(7_500_000), medianQuality: rat(1000) };
const RULES: SquadRules = { minSquad: 13, maxSquad: 25, overseasCap: 8 };

function combos<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [h, ...t] = xs as [T, ...T[]];
  return [...combos(t, k - 1).map((c) => [h, ...c]), ...combos(t, k)];
}

function legalXi(xi: EvalPlayer[]) {
  const bowl = xi.filter((p) => p.role === 'bowler' || p.role === 'all_rounder');
  return (
    xi.filter((p) => p.overseas).length <= 4 &&
    xi.some((p) => p.role === 'wicketkeeper') &&
    bowl.length >= 5 &&
    bowl.filter((p) => p.bowlType === 'pace').length >= 2 &&
    bowl.some((p) => p.bowlType === 'spin') &&
    xi.filter((p) => p.role !== 'bowler').length >= 6
  );
}

/* ------------------------------------------------------------------ tests */
describe('squad evaluator v1 (rules §10)', () => {
  it('integer score of every legal XI equals the exact-fraction oracle', () => {
    for (const seed of [1, 2, 3]) {
      const s = squad(seed, 13);
      const prep = prepare(s, RULES);
      const v = valueScore(s, REF);
      for (const c of combos(
        prep.players.map((_, i) => i),
        11,
      )) {
        const mask = c.reduce((m, i) => m | (1 << i), 0);
        const xi = c.map((i) => prep.players[i] as EvalPlayer);
        if (!legalXi(xi)) continue;
        const total = totalScore(xiObjective(partsOfMask(prep, mask), RULES), RULES, v);
        const o = oracle(prep.players, xi, RULES, REF);
        expect(cmp(total, { n: o.n, d: o.d })).toBe(0);
      }
    }
  });

  it('the optimizer finds the oracle maximum with the lexicographic id tie-break', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const s = squad(seed, 12 + (seed % 3));
      const prep = prepare(s, RULES);
      const result = optimize(prep);
      const sortedIds = prep.players.map((p) => p.id);
      let bestF: F | null = null;
      let bestIds: string[] | null = null;
      for (const xi of combos(prep.players, 11)) {
        if (!legalXi(xi)) continue;
        const o = oracle(prep.players, xi, RULES, REF);
        const ids = xi.map((p) => p.id);
        if (!bestF || o.cmp(bestF) > 0) {
          bestF = o;
          bestIds = ids;
        }
      }
      expect(result.cursor).toBe(result.total);
      if (!bestIds) {
        expect(result.bestMask).toBeNull();
        continue;
      }
      expect(maskIds(prep, result.bestMask as number)).toEqual(bestIds);
      expect(sortedIds).toEqual([...sortedIds].sort());
      const report = scoreReport(s, new Set(bestIds), RULES, REF);
      expect(cmp(report.total, { n: bestF!.n, d: bestF!.d })).toBe(0);
    }
  });

  it('chunked, interrupted runs end with the same result as one uninterrupted run', () => {
    const s = squad(21, 16);
    const prep = prepare(s, RULES);
    const whole = optimize(prep);
    let st = initialState(prep);
    while (st.cursor < st.total) {
      // A "restart": only the persisted state crosses the boundary.
      st = optimizeChunk(prepare(s, RULES), JSON.parse(JSON.stringify(st)), 97);
    }
    expect(st).toEqual(whole);
    expect(whole.total).toBe(4368); // C(16, 11)
  });

  it('unrank walks combinations in lexicographic order', () => {
    expect(unrank(5, 3, 0)).toEqual([0, 1, 2]);
    expect(unrank(5, 3, 1)).toEqual([0, 1, 3]);
    expect(unrank(5, 3, 9)).toEqual([2, 3, 4]);
    expect(unrank(25, 11, 4_457_399)).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  });

  it('a squad without a legal XI lists concrete deficits and never scores', () => {
    const s = squad(31, 12).map((p) => ({ ...p, role: 'batter' as const, bowlType: null }));
    const prep = prepare(s, RULES);
    expect(optimize(prep).bestMask).toBeNull();
    expect(squadDeficits(s, RULES, false)).toEqual([
      { code: 'SQUAD_TOO_SMALL', need: 1 },
      { code: 'NO_LEGAL_XI', missing: ['keeper', 'bowlers', 'pace', 'spin'] },
    ]);
    expect(squadDeficits(squad(32, 13), { ...RULES, overseasCap: 0 }, true)[0]?.code).toBe(
      'OVERSEAS_OVER_CAP',
    );
  });

  it('value for money never rewards unspent purse', () => {
    const s = squad(41, 13);
    const cheap = s.map((p) => ({ ...p, cost: 1n }));
    expect(valueScore(cheap, REF)).toEqual(rat(1000));
    const dear = s.map((p) => ({ ...p, cost: p.cost * 1000n }));
    expect(cmp(valueScore(dear, REF), rat(1000))).toBe(-1);
  });

  it('ranks legal squads by score, then balance, C, completeness, draw; illegal last', () => {
    const e = (id: string, total: number, b: number, w: number, c: number, legal = true) => ({
      id,
      legal,
      total: legal ? rat(total) : null,
      b: rat(b),
      w: rat(w),
      c: rat(c),
      completeness: 10,
      draw: id,
      deficits: [],
    });
    const ranked = rankSquads([
      e('x', 500, 400, 600, 800),
      e('y', 500, 500, 500, 700),
      e('z', 700, 0, 0, 0, false),
      e('w', 600, 1, 1, 1),
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ['w', 1],
      ['y', 2], // same total as x, better balanced core
      ['x', 3],
      ['z', 4],
    ]);
  });

  it('a full 25-player squad enumerates exactly C(25,11) combinations', () => {
    const prep = prepare(squad(51, 25), { ...RULES, minSquad: 18 });
    const st = initialState(prep);
    expect(st.total).toBe(4_457_400);
    const once = optimizeChunk(prep, st, 10_000);
    expect(once.cursor).toBe(10_000);
  });
});

describe('end-game vote arithmetic (rules §12)', () => {
  it('needs a strict majority of the frozen electorate', () => {
    expect([1, 2, 3, 4, 5].map(voteThreshold)).toEqual([1, 2, 2, 3, 3]);
    expect(() => voteThreshold(0)).toThrow('ELECTORATE_EMPTY');
  });

  it('abstentions, No and ties fail; votes cast are never the denominator', () => {
    expect(tallyVote(1, ['end']).passed).toBe(true);
    expect(tallyVote(1, [null]).passed).toBe(false);
    expect(tallyVote(2, ['end', null]).passed).toBe(false);
    expect(tallyVote(2, ['end', 'end']).passed).toBe(true);
    expect(tallyVote(4, ['end', 'end', 'continue', null])).toEqual({
      yes: 2,
      no: 1,
      abstain: 1,
      passed: false,
    });
    expect(tallyVote(4, ['end', 'end', 'continue', 'continue']).passed).toBe(false);
    expect(tallyVote(3, [null, null, null]).passed).toBe(false);
    expect(tallyVote(4, ['end', 'end', 'end', null]).passed).toBe(true);
  });
});

describe('qualification and medal placement (rules §13)', () => {
  it('needs two competitors and five decided contests or lots', () => {
    expect(gameQualifies(2, 5)).toBe(true);
    expect(gameQualifies(2, 4)).toBe(false);
    expect(gameQualifies(1, 50)).toBe(false);
  });

  it('presence of at least half the active time', () => {
    expect(presentEnough(50, 100)).toBe(true);
    expect(presentEnough(49, 100)).toBe(false);
    expect(presentEnough(10, 0)).toBe(false);
  });

  it('skips ineligible competitors without changing ranks; no bronze with two', () => {
    const places = medalPlacements(['a', 'b', 'c', 'd'], new Set(['a', 'c', 'd']));
    expect([...places]).toEqual([
      ['a', { medalPlace: 1, medal: 'gold' }],
      ['c', { medalPlace: 2, medal: 'silver' }],
      ['d', { medalPlace: 3, medal: 'bronze' }],
    ]);
    expect(
      [...medalPlacements(['a', 'b'], new Set(['a', 'b'])).values()].map((p) => p.medal),
    ).toEqual(['gold', 'silver']);
    expect(medalPlacements(['a'], new Set()).size).toBe(0);
  });
});

describe('XI rules constant', () => {
  it('is the 11-player rule set used by the optimizer', () => {
    expect(XI_RULES.size).toBe(11);
  });
});
