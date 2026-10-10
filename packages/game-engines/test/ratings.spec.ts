import { describe, expect, it } from 'vitest';
import {
  aggregateMatches,
  allocateRarityCounts,
  buildCatalog,
  checkPool,
  findLegends,
  LEGEND_FACTORS,
  scaleRatings,
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

  it('a tail-ender with a tiny batting sample rates below every established batter', () => {
    // ADR-019 §1a: two lucky balls are not a batting record.
    const established = ratings.filter((r) => r.raw.ballsFaced >= 300);
    const cameo = ratings.filter((r) => r.raw.ballsFaced > 0 && r.raw.ballsFaced <= 12);
    expect(established.length).toBeGreaterThan(10);
    expect(cameo.length).toBeGreaterThan(0);
    const worstEstablished = Math.min(...established.map((r) => r.ratings.batting));
    for (const r of cameo) expect(r.ratings.batting).toBeLessThan(worstEstablished);
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

describe('catalog: legends, Bronze singles and Platinum duals (ADR-020)', () => {
  const ids = ratings.map((r) => r.playerId).sort();
  const legends = new Set(ids.slice(0, 3));
  const [l1, l2, l3] = [...legends] as [string, string, string];
  const cards = buildCatalog(ratings, {
    legends,
    duals: [
      [l1, l2],
      [l2, l3],
      [l2, l1], // the same pair again is ignored
      [l1, 'not-in-pack'], // a missing player skips the pair
    ],
  });

  it('every player has one Bronze card; a legend has Normal, Silver and Gold instead', () => {
    for (const r of ratings) {
      const own = cards.filter((c) => c.playerIds.length === 1 && c.playerIds[0] === r.playerId);
      expect(own.map((c) => c.rarity).sort()).toEqual(
        legends.has(r.playerId) ? ['gold', 'normal', 'silver'] : ['bronze'],
      );
    }
    expect(cards.some((c) => c.rarity === 'platinum')).toBe(false);
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });

  it('Platinum only for the named dual pairs', () => {
    const duals = cards.filter((c) => c.rarity === 'dual_platinum');
    expect(duals.map((d) => [...d.playerIds].sort().join('+')).sort()).toEqual(
      [[l1, l2].sort().join('+'), [l2, l3].sort().join('+')].sort(),
    );
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

  it('Bronze shows the player ratings; legend versions are 92 % / 96 % / 100 % of them', () => {
    const factor = { normal: 92, silver: 96, gold: 100, bronze: 100 } as Record<string, number>;
    for (const c of cards.filter((x) => x.playerIds.length === 1)) {
      const own = byId.get(c.playerIds[0])!.ratings;
      for (const m of RATING_METRICS) {
        expect(c.ratings[m]).toBe(Math.floor((own[m] * factor[c.rarity]! + 50) / 100));
      }
    }
    // Kohli-style example: a 1000-point batter shows 92 / 96 / 100.
    const scaled = (['normal', 'silver', 'gold'] as const).map((r) =>
      displayRating(
        scaleRatings({ ...ratings[0]!.ratings, batting: 1000 }, LEGEND_FACTORS[r]).batting,
      ),
    );
    expect(scaled).toEqual([92, 96, 100]);
  });

  it('legends are 100+ matches for one franchise; renamed franchises count as one', () => {
    const season = (playerId: string, year: number, teams: Record<string, number>) =>
      ({ ...agg.seasons[0]!, playerId, season: year, teams }) as (typeof agg.seasons)[number];
    const found = findLegends([
      season('kohli', 2015, { 'Royal Challengers Bangalore': 60 }),
      season('kohli', 2026, { 'Royal Challengers Bengaluru': 45 }),
      season('journeyman', 2020, { 'Mumbai Indians': 60, 'Delhi Capitals': 50 }),
    ]);
    expect(found.get('kohli')).toEqual({
      team: 'Royal Challengers Bengaluru',
      matches: 105,
      lastSeason: 2026,
    });
    expect(found.has('journeyman')).toBe(false);
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

  it('a deal mirrors the catalog mix and never duplicates cards', () => {
    const available = new Map([
      ['normal', 25],
      ['bronze', 296],
      ['silver', 25],
      ['gold', 25],
      ['dual_platinum', 10],
    ] as const);
    const enabled = ['normal', 'bronze', 'silver', 'gold', 'platinum', 'dual_platinum'] as const;
    const result = checkPool(48, enabled, available);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.counts.values()].reduce((s, n) => s + n, 0)).toBe(48);
      expect(result.counts.get('platinum')).toBe(0);
      expect(result.counts.get('bronze')).toBeGreaterThan(result.counts.get('gold') ?? 0);
    }
    const small = new Map([
      ['bronze', 3],
      ['gold', 1],
    ] as const);
    // A deal that fits the pool takes each rarity in proportion, never more than exists.
    const fits = checkPool(4, ['bronze', 'gold'], small);
    expect(fits.ok && [...fits.counts]).toEqual([
      ['bronze', 3],
      ['gold', 1],
    ]);
    // A deal larger than the pool is POOL_INSUFFICIENT, never duplication.
    expect(checkPool(10, ['bronze', 'gold'], small).ok).toBe(false);
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
