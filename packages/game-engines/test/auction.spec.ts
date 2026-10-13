import { describe, expect, it } from 'vitest';
import {
  CRORE,
  IPL_MEGA_RULES_2025_27 as RULES,
  LAKH,
  auctionSet,
  checkRetention,
  incrementFor,
  maxBid,
  poolFeasibility,
  poolOrder,
  reserveFor,
  retentionCost,
  rtmCards,
  rulesFromJson,
  rulesHash,
  rulesToJson,
  squadSummary,
  type PoolPlayer,
  type RetentionContext,
} from '../src';

const cr = (n: number) => BigInt(Math.round(n * 100)) * LAKH;
const TEAM = 'csk';
const pool = new Map<string, PoolPlayer>();
const put = (id: string, cappedStatus: PoolPlayer['cappedStatus'], overseas = false, team = TEAM) =>
  pool.set(id, {
    playerId: id,
    basePrice: cr(2),
    cappedStatus,
    overseas,
    previousFranchiseId: team,
  });
['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].forEach((id) => put(id, 'capped'));
['u1', 'u2', 'u3'].forEach((id) => put(id, 'uncapped'));
put('o1', 'capped', true);
put('rival', 'capped', false, 'mi');
put('mystery', 'unknown');
const ctx: RetentionContext = {
  rules: RULES,
  format: 'retention',
  franchiseId: TEAM,
  pool,
  lowestBasePrice: 30n * LAKH,
};
const at = (ids: string[], salaries: number[] = []) =>
  ids.map((playerId, i) => ({ playerId, salary: cr(salaries[i] ?? 0) }));

describe('IPL mega-auction rules (2025–27)', () => {
  it('use the published purse, retention caps and slabs', () => {
    expect(RULES.purse).toBe(1_200_000_000n);
    expect(RULES.retention).toMatchObject({ max: 6, cappedMax: 5, uncappedMax: 2 });
    expect(RULES.retention.cappedSlabs).toEqual([cr(18), cr(14), cr(11), cr(18), cr(14)]);
    expect(RULES.retention.uncappedFloor).toBe(4n * CRORE);
    expect(RULES.provenance.purse).toBe('official');
    expect(RULES.provenance.increments).toBe('reported');
  });

  it('round-trip through stored JSON with a stable hash', () => {
    const json = rulesToJson(RULES);
    expect(json.purse).toBe('1200000000');
    expect(rulesFromJson(json)).toEqual(RULES);
    expect(rulesHash(rulesFromJson(json))).toBe(rulesHash(RULES));
    expect(rulesHash(RULES)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('raise by 5 lakh below 1 cr, 10 lakh to 2 cr, then 20 lakh', () => {
    expect(incrementFor(RULES.increments, cr(0.95))).toBe(5n * LAKH);
    expect(incrementFor(RULES.increments, cr(1))).toBe(10n * LAKH);
    expect(incrementFor(RULES.increments, cr(5))).toBe(20n * LAKH);
  });
});

describe('retention charge', () => {
  it('five capped and one uncapped at the slabs leave ₹41 cr (Mumbai Indians FAQ)', () => {
    const check = checkRetention(ctx, at(['c1', 'c2', 'c3', 'c4', 'c5', 'u1']));
    expect(check.ok).toBe(true);
    expect(check.cost.total).toBe(cr(79));
    expect(check.remainingPurse).toBe(cr(41));
    expect(check.rtm.total).toBe(0);
  });

  it('four capped and one uncapped leave ₹55 cr with one RTM card', () => {
    const check = checkRetention(ctx, at(['c1', 'c2', 'c3', 'c4', 'u1']));
    expect(check.remainingPurse).toBe(cr(55));
    expect(check.rtm).toEqual({ total: 1, capped: 1, uncapped: 1 });
  });

  it('CSK 2025: Gaikwad 18, Jadeja 18, Pathirana 13, Dube 12 and Dhoni uncapped 4 cost ₹65 cr', () => {
    const cost = retentionCost(
      RULES,
      at(['c1', 'c2', 'c3', 'c4', 'u1'], [18, 18, 13, 12, 4]),
      pool,
    );
    expect(cost.cappedFloors).toBe(cr(61));
    expect(cost.cappedNegotiated).toBe(cr(61));
    expect(cost.total).toBe(cr(65));
    expect(cost.lines.map((l) => l.allocated)).toEqual([cr(18), cr(18), cr(13), cr(12), cr(4)]);
  });

  it('SRH 2025: a ₹23 cr star inside the ₹75 cr slab total costs nothing extra', () => {
    const cost = retentionCost(
      RULES,
      at(['c1', 'c2', 'c3', 'c4', 'c5'], [23, 18, 14, 14, 6]),
      pool,
    );
    expect(cost.total).toBe(cr(75));
  });

  it('negotiated pay above the slabs is charged in full', () => {
    const cost = retentionCost(RULES, at(['c1', 'c2'], [21, 17]), pool);
    expect(cost.cappedFloors).toBe(cr(32));
    expect(cost.total).toBe(cr(38));
  });

  it('a top-up to the slabs is spread by slab, summing exactly (largest remainder)', () => {
    const cost = retentionCost(RULES, at(['c3', 'c1', 'c2'], [10, 10, 10]), pool);
    expect(cost.cappedCharge).toBe(cr(43));
    const shares = cost.lines.map((l) => l.allocated - l.salary);
    expect(shares.reduce((s, x) => s + x, 0n)).toBe(cr(13));
    // 13 cr × 18/43, 14/43, 11/43: whole rupees, nothing lost to rounding.
    expect(shares[0]! > shares[1]! && shares[1]! > shares[2]!).toBe(true);
    expect(cost.lines.reduce((s, l) => s + l.allocated, 0n)).toBe(cost.total);
  });

  it('an uncapped player costs at least ₹4 cr', () => {
    const cost = retentionCost(RULES, at(['u1', 'u2'], [1, 6]), pool);
    expect(cost.lines.map((l) => l.allocated)).toEqual([cr(4), cr(6)]);
  });
});

describe('retention checks', () => {
  const codes = (picks: ReturnType<typeof at>, c: RetentionContext = ctx) =>
    checkRetention(c, picks).problems.map((p) => p.code);

  it('enforce 6 in total, 5 capped and 2 uncapped', () => {
    expect(codes(at(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']))).toContain('TOO_MANY_CAPPED');
    expect(codes(at(['u1', 'u2', 'u3']))).toContain('TOO_MANY_UNCAPPED');
    expect(codes(at(['c1', 'c2', 'c3', 'c4', 'c5', 'u1', 'u2']))).toContain('TOO_MANY');
  });

  it('refuse another franchise’s player, an unknown status and duplicates', () => {
    expect(codes(at(['rival']))).toEqual(['FOREIGN_IDENTITY']);
    expect(codes(at(['mystery']))).toEqual(['UNKNOWN_STATUS']);
    expect(codes(at(['c1', 'c1']))).toContain('DUPLICATE');
    expect(codes(at(['nobody']))).toEqual(['NOT_IN_POOL']);
  });

  it('a fresh-reset auction has no retentions and no RTM cards', () => {
    const fresh = { ...ctx, format: 'fresh' as const };
    expect(codes(at(['c1']), fresh)).toEqual(['FRESH_FORMAT']);
    expect(checkRetention(fresh, []).rtm.total).toBe(0);
    expect(rtmCards(RULES, 'fresh', 0, 0).total).toBe(0);
  });

  it('protect the purse needed to fill the minimum squad', () => {
    const rich = at(['c1', 'c2', 'c3', 'c4', 'c5'], [30, 30, 30, 30, 0]);
    const check = checkRetention(ctx, rich);
    expect(check.remainingPurse).toBe(0n);
    expect(check.problems.map((p) => p.code)).toEqual(['PURSE_INVALID']);
    expect(reserveFor(RULES, 5, 30n * LAKH)).toBe(13n * 30n * LAKH);
  });

  it('salaries are whole lakhs', () => {
    expect(codes([{ playerId: 'c1', salary: cr(18) + 1n }])).toContain('SALARY_INVALID');
  });

  it('RTM cards share the 5 capped / 2 uncapped sub-caps with retentions', () => {
    expect(rtmCards(RULES, 'retention', 3, 2)).toEqual({ total: 1, capped: 1, uncapped: 0 });
    expect(rtmCards(RULES, 'retention', 0, 0)).toEqual({ total: 6, capped: 5, uncapped: 2 });
    expect(rtmCards(RULES, 'retention', 2, 0, 3, 0)).toEqual({ total: 1, capped: 0, uncapped: 1 });
  });
});

describe('squad and pool', () => {
  it('a bid equal to the ceiling is allowed; the ceiling keeps the minimum-squad reserve', () => {
    const bmin = 30n * LAKH;
    expect(maxBid(RULES, 10, cr(20), bmin)).toBe(cr(20) - 7n * bmin);
    expect(maxBid(RULES, 25, cr(20), bmin)).toBeNull();
    expect(squadSummary(RULES, [{ overseas: true }, { overseas: false }], bmin)).toMatchObject({
      rosterCount: 2,
      overseasCount: 1,
      needed: 16,
      deficits: ['Need 16 more players'],
    });
  });

  it('pool feasibility names the shortfall exactly', () => {
    expect(poolFeasibility(RULES, [{ retained: 6 }, { retained: 0 }], 30)).toEqual([]);
    expect(poolFeasibility(RULES, [{ retained: 0 }, { retained: 0 }], 30)[0]?.message).toBe(
      'The teams need 36 more players to reach 18 each, but the pool has 30.',
    );
  });

  it('players go under the hammer in sets: capped first, high base price first', () => {
    const order = poolOrder([
      { playerId: 'a', name: 'A', role: 'bowler', cappedStatus: 'capped', basePrice: cr(2) },
      { playerId: 'b', name: 'B', role: 'batter', cappedStatus: 'uncapped', basePrice: cr(0.3) },
      { playerId: 'c', name: 'C', role: 'batter', cappedStatus: 'capped', basePrice: cr(1) },
      { playerId: 'd', name: 'D', role: 'batter', cappedStatus: 'capped', basePrice: cr(2) },
    ]);
    expect(order.map((p) => p.playerId)).toEqual(['d', 'c', 'a', 'b']);
    expect(auctionSet('wicketkeeper', 'uncapped').label).toBe('Uncapped wicketkeepers');
  });
});
