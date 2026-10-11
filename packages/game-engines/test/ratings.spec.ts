import { describe, expect, it } from 'vitest';
import {
  aggregateMatches,
  allocateRarityCounts,
  battingQuality,
  bowlingQuality,
  buildCatalog,
  careerRatings,
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
  LEGEND_RARITIES,
  type CareerCounts,
  type CatalogPlayer,
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

describe('career model (ADR-022): whole IPL career, Batting / Bowling / Runs', () => {
  const players = new Set(ratings.map((r) => r.playerId));
  const career = careerRatings({
    seasons: agg.seasons,
    lines: agg.lines,
    players,
    cutoffDate: '2025-12-31',
  });
  const counts = (over: Partial<CareerCounts>): CareerCounts => ({
    innings: 0,
    runs: 0,
    balls: 0,
    dismissals: 0,
    bowlBalls: 0,
    bowlRuns: 0,
    wickets: 0,
    ...over,
  });

  it('the best career batter and bowler are 100; never batting or bowling is a real 0', () => {
    const list = [...career.values()];
    expect(Math.max(...list.map((c) => c.batting))).toBe(1000);
    expect(Math.max(...list.map((c) => c.bowling))).toBe(1000);
    for (const c of list) {
      if (c.counts.balls === 0) expect(c.batting).toBe(0);
      if (c.counts.bowlBalls === 0) expect(c.bowling).toBe(0);
      expect(c.runs).toBe(
        c.counts.innings ? Math.round((10 * c.counts.runs) / c.counts.innings) : 0,
      );
    }
  });

  it('more runs at a better average and strike rate rate higher', () => {
    const solid = battingQuality(counts({ runs: 4000, balls: 3000, dismissals: 100 }));
    const weak = battingQuality(counts({ runs: 4000, balls: 3600, dismissals: 160 }));
    expect(solid).toBeGreaterThan(weak);
    const tight = bowlingQuality(counts({ bowlBalls: 3000, bowlRuns: 3500, wickets: 150 }));
    const loose = bowlingQuality(counts({ bowlBalls: 3000, bowlRuns: 4600, wickets: 100 }));
    expect(tight).toBeGreaterThan(loose);
  });

  it('is deterministic and independent of input order', () => {
    const again = careerRatings({
      seasons: [...agg.seasons].reverse(),
      lines: agg.lines,
      players,
      cutoffDate: '2025-12-31',
    });
    expect([...again.values()].map((c) => [c.playerId, c.batting, c.bowling, c.runs])).toEqual(
      [...career.values()].map((c) => [c.playerId, c.batting, c.bowling, c.runs]),
    );
  });
});

describe('catalog tiers (ADR-020, ADR-022)', () => {
  const p = (
    playerId: string,
    role: CatalogPlayer['role'],
    batting: number,
    bowling: number,
    runs = 300,
  ): CatalogPlayer => ({ playerId, role, batting, bowling, runs });
  const players = [
    p('kohli', 'batter', 1000, 110, 339),
    p('rohit', 'batter', 830, 260, 266),
    p('sachin', 'batter', 558, 4, 299),
    p('bumrah', 'bowler', 67, 937, 23),
    p('jadeja', 'all_rounder', 630, 841, 169),
    p('rahul', 'batter', 910, 0, 388),
    p('gill', 'batter', 809, 0, 351),
    p('rashid', 'bowler', 279, 925, 86),
    p('tail', 'bowler', 30, 400, 20),
  ];
  const legends = new Set(['kohli', 'rohit', 'sachin', 'bumrah', 'jadeja']);
  const cards = buildCatalog(players, {
    legends,
    duals: [
      ['rohit', 'kohli'],
      ['kohli', 'rohit'], // the same pair again is ignored
      ['kohli', 'not-in-pack'], // a missing player skips the pair
    ],
  });
  const card = (key: string) => cards.find((c) => c.key === key)!;

  it('every non-legend has one Bronze card; a legend has Normal, Silver and Gold', () => {
    for (const x of players) {
      const own = cards.filter((c) => c.playerIds.length === 1 && c.playerIds[0] === x.playerId);
      expect(own.map((c) => c.rarity).sort()).toEqual(
        legends.has(x.playerId) ? ['gold', 'normal', 'silver'] : ['bronze'],
      );
    }
    expect(cards.filter((c) => c.rarity === 'dual_platinum')).toHaveLength(1);
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });

  it('Bronze never shows more than 89; the best Bronze batter and bowler show 89', () => {
    const bronze = cards.filter((c) => c.rarity === 'bronze');
    for (const c of bronze) {
      expect(displayRating(c.ratings.batting)).toBeLessThanOrEqual(89);
      expect(displayRating(c.ratings.bowling)).toBeLessThanOrEqual(89);
    }
    expect(displayRating(card('single:rahul').ratings.batting)).toBe(89);
    expect(displayRating(card('single:rashid').ratings.bowling)).toBe(89);
  });

  it("a legend's Gold main skill is 90–100, above every Bronze card; the best legend is 100", () => {
    expect(displayRating(card('legend:kohli:gold').ratings.batting)).toBe(100);
    expect(displayRating(card('legend:sachin:gold').ratings.batting)).toBe(90);
    expect(displayRating(card('legend:bumrah:gold').ratings.bowling)).toBe(100);
    expect(displayRating(card('legend:jadeja:gold').ratings.bowling)).toBeGreaterThanOrEqual(90);
    // The other skill stays on the Bronze scale (Kohli does not become a bowler).
    expect(displayRating(card('legend:kohli:gold').ratings.bowling)).toBeLessThan(20);
    expect(card('legend:kohli:gold').stars).toBe(5);
  });

  it('Silver is 96 % and Normal 92 % of Gold for Batting and Bowling; Runs is never scaled', () => {
    const shown = (['normal', 'silver', 'gold'] as const).map((r) =>
      displayRating(card(`legend:kohli:${r}`).ratings.batting),
    );
    expect(shown).toEqual([92, 96, 100]);
    for (const r of LEGEND_RARITIES) expect(card(`legend:kohli:${r}`).ratings.runs).toBe(339);
    expect(scaleRatings({ batting: 1000, bowling: 500, runs: 339 }, LEGEND_FACTORS.normal)).toEqual(
      { batting: 920, bowling: 460, runs: 339 },
    );
  });

  it('a Platinum pair takes the better of the two Gold cards for every stat', () => {
    const dual = cards.find((c) => c.rarity === 'dual_platinum')!;
    const k = card('legend:kohli:gold').ratings;
    const r = card('legend:rohit:gold').ratings;
    expect(dual.ratings).toEqual({
      batting: Math.max(k.batting, r.batting),
      bowling: Math.max(k.bowling, r.bowling),
      runs: Math.max(k.runs, r.runs),
    });
    expect(dual.stars).toBe(5);
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
