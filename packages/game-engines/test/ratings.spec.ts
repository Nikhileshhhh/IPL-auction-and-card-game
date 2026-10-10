import { describe, expect, it } from 'vitest';
import {
  aggregateMatches,
  allocateRarityCounts,
  buildCatalog,
  checkPool,
  computeRatings,
  displayRating,
  isqrtRound,
  midrankPermille,
  rankRescale,
  rat,
  RATING_METRICS,
  type PlayerRatings,
} from '../src';
import { generateDemoLeague } from '../../../tests/fixtures/data/demo-league';

const league = generateDemoLeague();
const agg = aggregateMatches(league.matches);
const input = {
  seasons: agg.seasons,
  lines: agg.lines,
  latestSeason: 2025,
  cutoffDate: '2025-12-31',
};
const ratings = computeRatings(input);
const byId = new Map(ratings.map((r) => [r.playerId, r]));

describe('ratings v1 (ADR-018 Attax-style scale)', () => {
  it('rates every player in the three-season cohort', () => {
    expect(ratings.length).toBeGreaterThanOrEqual(100);
    for (const r of ratings) {
      for (const m of RATING_METRICS) {
        expect(Number.isInteger(r.ratings[m])).toBe(true);
        expect(r.ratings[m]).toBeGreaterThanOrEqual(0);
        expect(r.ratings[m]).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('the best batter shows exactly 100 batting and the best bowler exactly 100 bowling', () => {
    const maxBat = Math.max(...ratings.map((r) => r.ratings.batting));
    const maxBowl = Math.max(...ratings.map((r) => r.ratings.bowling));
    expect(maxBat).toBe(1000);
    expect(maxBowl).toBe(1000);
    expect(displayRating(maxBat)).toBe(100);
    expect(Math.max(...ratings.map((r) => displayRating(r.ratings.bowling)))).toBe(100);
    // Exactly one top batter unless genuinely tied on the composite.
    expect(ratings.filter((r) => r.ratings.batting === 1000).length).toBeGreaterThanOrEqual(1);
  });

  it('a confirmed non-bowler is 0 bowling (real zero, not missing)', () => {
    const nonBowlers = league.players.filter(
      (p) => p.role === 'batter' || p.role === 'wicketkeeper',
    );
    for (const p of nonBowlers) {
      const r = byId.get(p.id);
      if (r) expect(r.ratings.bowling).toBe(0);
    }
    const anyBowler = ratings.find((r) => r.ratings.bowling > 0);
    expect(anyBowler?.ratings.bowling).toBeGreaterThanOrEqual(10);
  });

  it('is deterministic and independent of input order', () => {
    const again = computeRatings({
      ...input,
      seasons: [...agg.seasons].reverse(),
    });
    expect(again).toEqual(ratings);
  });

  it('ratings reflect performance: higher hidden batting skill → higher batting on average', () => {
    const batters = league.players.filter((p) => p.role === 'batter' && byId.has(p.id));
    const sorted = [...batters].sort((a, b) => a.bat - b.bat);
    const half = Math.floor(sorted.length / 2);
    const mean = (xs: typeof sorted) =>
      xs.reduce((s, p) => s + (byId.get(p.id) as PlayerRatings).ratings.batting, 0) / xs.length;
    expect(mean(sorted.slice(half))).toBeGreaterThan(mean(sorted.slice(0, half)));
  });

  it('derives roles and definite 1–5 star ratings (no provisional caps)', () => {
    const roles = new Set(ratings.map((r) => r.role));
    expect(roles).toEqual(new Set(['batter', 'bowler', 'all_rounder', 'wicketkeeper']));
    for (const r of ratings) {
      expect(r.stars).toBeGreaterThanOrEqual(1);
      expect(r.stars).toBeLessThanOrEqual(5);
    }
    expect(ratings.some((r) => r.stars === 5)).toBe(true);
    // Versatility = round(sqrt(batting·bowling)).
    for (const r of ratings) {
      expect(r.ratings.versatility).toBe(
        Number(isqrtRound(BigInt(r.ratings.batting) * BigInt(r.ratings.bowling))),
      );
    }
  });

  it('role overrides from the reviewed editor are respected', () => {
    const someone = ratings[0] as PlayerRatings;
    const overridden = computeRatings({
      ...input,
      roleOverrides: new Map([[someone.playerId, 'all_rounder']]),
    });
    expect(overridden.find((r) => r.playerId === someone.playerId)?.role).toBe('all_rounder');
  });

  it('every player has a definite value for every rating, even with a tiny sample', () => {
    // A cutoff two days into the data: most players have one or two appearances.
    const early = aggregateMatches(league.matches, { toDate: '2023-04-03' });
    const tiny = computeRatings({
      seasons: early.seasons,
      lines: early.lines,
      latestSeason: 2023,
      cutoffDate: '2023-04-03',
    });
    expect(tiny.length).toBeGreaterThan(20);
    for (const r of tiny) {
      for (const m of RATING_METRICS) expect(Number.isInteger(r.ratings[m])).toBe(true);
      for (const v of Object.values(r.phases)) expect(Number.isInteger(v)).toBe(true);
      expect(Object.keys(r.phases)).toHaveLength(6);
    }
    expect(Math.max(...tiny.map((r) => r.ratings.batting))).toBe(1000);
    expect(Math.max(...tiny.map((r) => r.ratings.form))).toBe(1000);
  });
});

describe('percentile and rescale helpers', () => {
  it('midrank percentiles share ties', () => {
    const p = midrankPermille([
      ['a', rat(1)],
      ['b', rat(2)],
      ['c', rat(2)],
      ['d', rat(3)],
    ]);
    expect(p.get('b')).toBe(p.get('c'));
    expect(p.get('a')).toBe(125);
    expect(p.get('d')).toBe(875);
  });

  it('rank rescale maps best → 1000 and worst → 10', () => {
    const r = rankRescale([
      ['a', 5],
      ['b', 50],
      ['c', 900],
    ]);
    expect([r.get('a'), r.get('b'), r.get('c')]).toEqual([10, 505, 1000]);
    expect(rankRescale([['solo', 1]]).get('solo')).toBe(1000);
  });
});

describe('catalog: rarity, duals and pool sufficiency (rules §3.4)', () => {
  const cards = buildCatalog(ratings);

  it('one single card per player plus ~2 % dual cards', () => {
    const singles = cards.filter((c) => c.playerIds.length === 1);
    const duals = cards.filter((c) => c.rarity === 'dual_platinum');
    expect(singles).toHaveLength(ratings.length);
    expect(duals.length).toBeGreaterThanOrEqual(1);
    const ids = duals.flatMap((d) => d.playerIds);
    expect(new Set(ids).size).toBe(ids.length); // no identity in two pairs
  });

  it('dual ratings are the rounded mean of both players, capped at 950 (display ≤ 95)', () => {
    for (const d of cards.filter((c) => c.rarity === 'dual_platinum')) {
      const [a, b] = d.playerIds.map((id) => byId.get(id) as PlayerRatings);
      for (const m of RATING_METRICS) {
        const mean = Math.floor((a!.ratings[m] + b!.ratings[m] + 1) / 2);
        expect(d.ratings[m]).toBe(Math.min(950, mean));
        expect(displayRating(d.ratings[m])).toBeLessThanOrEqual(95);
      }
    }
  });

  it('rarity is visual only: a card shows exactly its player ratings', () => {
    for (const c of cards.filter((x) => x.playerIds.length === 1)) {
      expect(c.ratings).toEqual(byId.get(c.playerIds[0])?.ratings);
    }
  });

  it('allocates deal counts by largest remainder with enum-order ties', () => {
    const counts = allocateRarityCounts(48);
    expect([...counts.values()].reduce((s, n) => s + n, 0)).toBe(48);
    expect(counts.get('normal')).toBe(19);
    const noDual = allocateRarityCounts(10, ['normal', 'gold']);
    expect([...noDual]).toEqual([
      ['normal', 8],
      ['gold', 2],
    ]);
  });

  it('reports rare-pool insufficiency instead of duplicating cards', () => {
    const available = new Map([
      ['normal', 100],
      ['bronze', 100],
      ['silver', 100],
      ['gold', 100],
      ['platinum', 100],
      ['dual_platinum', 1],
    ] as const);
    const result = checkPool(
      240,
      ['normal', 'bronze', 'silver', 'gold', 'platinum', 'dual_platinum'],
      available,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.shortages).toEqual([{ rarity: 'dual_platinum', needed: 5, available: 1 }]);
    expect(checkPool(48, ['normal', 'bronze'], available).ok).toBe(true);
  });
});

describe('missing vs zero in raw statistics (E41)', () => {
  it('zero denominators stay null, never a winning zero', () => {
    const neverBowled = ratings.find((r) => r.raw.ballsBowled === 0);
    expect(neverBowled?.raw.economyX100).toBeNull();
    expect(neverBowled?.raw.bowlingAverageX100).toBeNull();
    for (const r of ratings) {
      if (r.raw.wickets === 0) expect(r.raw.bowlingAverageX100).toBeNull();
    }
  });
});
