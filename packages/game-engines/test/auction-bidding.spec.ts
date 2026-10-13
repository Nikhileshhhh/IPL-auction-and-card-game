import { describe, expect, it } from 'vitest';
import {
  CRORE,
  IPL_MEGA_RULES_2025_27 as RULES,
  LAKH,
  RandomStream,
  auctionViolations,
  bidRejection,
  extendedDeadline,
  finalOfferProblem,
  hasRtmCard,
  lotOrder,
  nextBidAmount,
  nextLot,
  noBuyersLeft,
  rtmOpens,
  xiFeasible,
  type XiPlayer,
} from '../src';

const cr = (n: number) => BigInt(Math.round(n * 100)) * LAKH;
const p = (
  role: XiPlayer['role'],
  bowlType: XiPlayer['bowlType'] = null,
  overseas = false,
): XiPlayer => ({
  role,
  bowlType,
  overseas,
});
/** A pool with plenty of every kind of player. */
const deepPool: XiPlayer[] = Array.from({ length: 30 }, () => [
  p('batter'),
  p('wicketkeeper'),
  p('bowler', 'pace'),
  p('bowler', 'spin'),
  p('all_rounder', 'pace'),
  p('all_rounder', 'spin', true),
]).flat();

describe('bids (rules §8.2)', () => {
  it('open at the base price, then step by the reported increments; no jump bids', () => {
    expect(nextBidAmount(RULES, cr(2), null)).toBe(cr(2));
    expect(nextBidAmount(RULES, cr(0.3), cr(0.95))).toBe(cr(1));
    expect(nextBidAmount(RULES, cr(0.3), cr(1.95))).toBe(cr(2)); // band of the current bid
    expect(nextBidAmount(RULES, cr(0.3), cr(2))).toBe(cr(2.2));
    expect(nextBidAmount(RULES, cr(0.3), cr(1.25))).toBe(cr(1.3)); // onto the ₹10 lakh grid
    expect(nextBidAmount(RULES, cr(0.3), cr(0.75))).toBe(cr(0.8));
  });

  it('a late bid moves the deadline to at least acceptance + 8 s, never back', () => {
    const t = Date.parse('2026-10-12T10:00:00Z');
    expect(extendedDeadline(new Date(t + 20_000), new Date(t + 5_000)).getTime()).toBe(t + 20_000);
    expect(extendedDeadline(new Date(t + 20_000), new Date(t + 15_000)).getTime()).toBe(t + 23_000);
  });

  const team = (squad: XiPlayer[], purse = cr(50)) => ({
    teamId: 'a',
    remainingPurse: purse,
    squad,
  });
  const check = (over: Partial<Parameters<typeof bidRejection>[0]> = {}) =>
    bidRejection({
      rules: RULES,
      team: team([]),
      player: p('batter'),
      amount: cr(2),
      leaderTeamId: null,
      lowestBasePrice: cr(0.3),
      available: deepPool,
      ...over,
    });

  it('refuse raising your own lead, a full squad and a ninth overseas player', () => {
    expect(check({ leaderTeamId: 'a' })).toEqual({ code: 'ALREADY_LEADING' });
    expect(check({ team: team(Array.from({ length: 25 }, () => p('batter'))) })).toEqual({
      code: 'SQUAD_FULL',
    });
    const eightOverseas = Array.from({ length: 8 }, () => p('batter', null, true));
    expect(check({ team: team(eightOverseas), player: p('bowler', 'pace', true) })).toEqual({
      code: 'OVERSEAS_LIMIT',
    });
  });

  it('a bid equal to the ceiling passes; one lakh more fails with the allowed ceiling', () => {
    // 10 players, ₹20 cr left: 7 more needed at ₹30 lakh → ceiling ₹17.9 cr.
    const ten = Array.from({ length: 10 }, () => p('batter'));
    const ceiling = cr(20) - 7n * cr(0.3);
    expect(check({ team: team(ten, cr(20)), amount: ceiling })).toBeNull();
    expect(check({ team: team(ten, cr(20)), amount: ceiling + LAKH })).toEqual({
      code: 'BUDGET_RESERVE',
      allowedCeiling: ceiling,
    });
  });

  it('refuse a purchase that leaves no legal XI within the squad places left', () => {
    // 24 batters and no keeper: buying another batter fills the squad without a keeper.
    const batters = Array.from({ length: 24 }, () => p('batter'));
    expect(check({ team: team(batters, cr(50)), player: p('batter') })).toEqual({
      code: 'XI_INFEASIBLE',
    });
  });
});

describe('legal XI feasibility', () => {
  it('needs 1 keeper, 5 bowlers (2 pace, 1 spin), 6 batters and at most 4 overseas', () => {
    const xi = [
      p('wicketkeeper'),
      ...Array.from({ length: 5 }, () => p('batter')),
      p('all_rounder', 'pace'),
      p('bowler', 'pace'),
      p('bowler', 'spin'),
      p('bowler', 'pace'),
      p('bowler', 'pace'),
    ];
    expect(xiFeasible(xi, [], 0)).toBe(true);
    expect(xiFeasible(xi.slice(1), [], 0)).toBe(false); // no keeper
    expect(xiFeasible(xi.slice(1), [p('wicketkeeper')], 1)).toBe(true);
    const overseasXi = xi.map((x) => ({ ...x, overseas: true }));
    expect(xiFeasible(overseasXi, [], 0)).toBe(false);
  });

  it('is fast enough for a full squad and a 200-player pool', () => {
    const squad = Array.from({ length: 24 }, (_, i) =>
      p(i % 4 === 0 ? 'bowler' : 'batter', i % 8 === 0 ? 'spin' : 'pace', i % 6 === 0),
    );
    const started = Date.now();
    xiFeasible(squad, deepPool.slice(0, 180), 1);
    xiFeasible(squad.slice(0, 14), deepPool.slice(0, 180), 10);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('right to match (2025 regulations)', () => {
  const holder = {
    format: 'retention' as const,
    retainedCapped: 4,
    retainedUncapped: 1,
    rtmUsedCapped: 0,
    rtmUsedUncapped: 0,
  };
  const buyer = {
    rules: RULES,
    team: { teamId: 'mi', remainingPurse: cr(30), squad: [] },
    player: p('batter'),
    amount: cr(5),
    lowestBasePrice: cr(0.3),
    available: deepPool,
  };

  it('a card for capped and uncapped players within the 5 / 2 sub-caps', () => {
    expect(hasRtmCard(RULES, holder, 'capped')).toBe(true);
    expect(hasRtmCard(RULES, holder, 'uncapped')).toBe(true);
    expect(hasRtmCard(RULES, { ...holder, retainedCapped: 5 }, 'capped')).toBe(false);
    expect(
      hasRtmCard(RULES, { ...holder, retainedUncapped: 2, retainedCapped: 3 }, 'uncapped'),
    ).toBe(false);
    expect(hasRtmCard(RULES, { ...holder, format: 'fresh' }, 'capped')).toBe(false);
    expect(hasRtmCard(RULES, holder, 'unknown')).toBe(false);
  });

  it('opens only for a different, able previous franchise', () => {
    const base = { rules: RULES, holder, status: 'capped' as const, purchaseAtStanding: buyer };
    expect(rtmOpens({ ...base, holderTeamId: 'mi', leaderTeamId: 'csk' })).toBe(true);
    expect(rtmOpens({ ...base, holderTeamId: 'csk', leaderTeamId: 'csk' })).toBe(false); // leads already
    expect(rtmOpens({ ...base, holderTeamId: null, leaderTeamId: 'csk' })).toBe(false); // not in room
    const broke = { ...buyer, team: { ...buyer.team, remainingPurse: cr(4) } };
    expect(
      rtmOpens({ ...base, holderTeamId: 'mi', leaderTeamId: 'csk', purchaseAtStanding: broke }),
    ).toBe(false); // cannot afford the standing bid
  });

  it('the final raise is whole lakhs, at least the standing bid (equal holds), within the ceiling', () => {
    expect(finalOfferProblem(cr(5), cr(5), cr(10))).toBeNull(); // hold
    expect(finalOfferProblem(cr(7), cr(5), cr(10))).toBeNull(); // any whole-lakh raise
    expect(finalOfferProblem(cr(5.07), cr(5), cr(10))).toBeNull(); // not bound to the step table
    expect(finalOfferProblem(cr(5) + 1n, cr(5), cr(10))).toEqual({ code: 'NOT_WHOLE_LAKH' });
    expect(finalOfferProblem(cr(4.9), cr(5), cr(10))).toEqual({ code: 'BELOW_STANDING' });
    expect(finalOfferProblem(cr(11), cr(5), cr(10))).toEqual({
      code: 'BUDGET_RESERVE',
      allowedCeiling: cr(10),
    });
  });
});

describe('lots and passes', () => {
  const seed = new Uint8Array(32).fill(7);
  const players = [
    {
      playerId: 'b1',
      name: 'B1',
      role: 'bowler' as const,
      cappedStatus: 'capped' as const,
      basePrice: cr(2),
    },
    {
      playerId: 'a1',
      name: 'A1',
      role: 'batter' as const,
      cappedStatus: 'capped' as const,
      basePrice: cr(1),
    },
    {
      playerId: 'a2',
      name: 'A2',
      role: 'batter' as const,
      cappedStatus: 'capped' as const,
      basePrice: cr(2),
    },
    {
      playerId: 'u1',
      name: 'U1',
      role: 'batter' as const,
      cappedStatus: 'uncapped' as const,
      basePrice: cr(0.3),
    },
  ];

  it('keeps the real sets in order and shuffles inside a set from the seed (deterministic)', () => {
    const order = lotOrder(players, new RandomStream(seed, 'lots')).map((x) => x.playerId);
    expect(order.slice(2)).toEqual(['b1', 'u1']); // capped batters, capped bowlers, uncapped
    expect(order.slice(0, 2).sort()).toEqual(['a1', 'a2']);
    expect(lotOrder(players, new RandomStream(seed, 'lots')).map((x) => x.playerId)).toEqual(order);
  });

  it('runs pass 1, then one second pass for the unsold, then ends', () => {
    const pool = [
      { playerId: 'x', orderIndex: 0, status: 'sold' as const, pass: 1 },
      { playerId: 'y', orderIndex: 1, status: 'unsold' as const, pass: 1 },
      { playerId: 'z', orderIndex: 2, status: 'available' as const, pass: 1 },
    ];
    expect(nextLot(pool, 1)).toEqual({ kind: 'lot', playerId: 'z' });
    pool[2]!.status = 'unsold';
    expect(nextLot(pool, 1)).toEqual({ kind: 'second_pass', playerIds: ['y', 'z'] });
    expect(nextLot(pool, 2)).toEqual({ kind: 'done' }); // no third pass
  });

  it('ends early when no team can buy anyone', () => {
    expect(noBuyersLeft([{ squadCount: 25, remainingPurse: cr(10) }], 25, cr(0.3))).toBe(true);
    expect(noBuyersLeft([{ squadCount: 20, remainingPurse: cr(0.2) }], 25, cr(0.3))).toBe(true);
    expect(noBuyersLeft([{ squadCount: 20, remainingPurse: cr(1) }], 25, cr(0.3))).toBe(false);
  });
});

describe('invariants', () => {
  it('catch a double owner, a broken purse and a negative purse', () => {
    const ok = {
      teamId: 'a',
      initialPurse: cr(120),
      remainingPurse: cr(100),
      acquisitions: [{ playerId: 'p', charged: cr(20), overseas: false }],
    };
    expect(auctionViolations(RULES, [ok])).toEqual([]);
    expect(auctionViolations(RULES, [ok, { ...ok, teamId: 'b' }])).toContain('p: owned by a and b');
    expect(auctionViolations(RULES, [{ ...ok, remainingPurse: cr(99) }])).toContain(
      'a: purse not conserved',
    );
    expect(
      auctionViolations(RULES, [{ ...ok, remainingPurse: -1n, initialPurse: cr(20) - 1n }]),
    ).toContain('a: negative purse');
  });
});

it('money stays exact: ₹120 cr is 1,200,000,000 rupees', () => {
  expect(120n * CRORE).toBe(1_200_000_000n);
});
