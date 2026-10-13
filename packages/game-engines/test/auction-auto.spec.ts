import { describe, expect, it } from 'vitest';
import {
  IPL_MEGA_RULES_2025_27 as RULES,
  LAKH,
  autoBidDelayMs,
  autoDecision,
  autoRtmDecision,
  type AutoInput,
  type AutoStrategy,
  type XiPlayer,
} from '../src';

const cr = (n: number) => BigInt(Math.round(n * 100)) * LAKH;
const p = (role: XiPlayer['role'], bowlType: XiPlayer['bowlType'] = null): XiPlayer => ({
  role,
  bowlType,
  overseas: false,
});
const deepPool: XiPlayer[] = Array.from({ length: 30 }, () => [
  p('batter'),
  p('wicketkeeper'),
  p('bowler', 'pace'),
  p('bowler', 'spin'),
  p('all_rounder', 'pace'),
]).flat();

const strategy = (over: Partial<AutoStrategy> = {}): AutoStrategy => ({
  enabled: true,
  targets: [{ playerId: 'star', ceiling: cr(10) }],
  roleLimits: { bowler: cr(3) },
  totalAutoCap: cr(20),
  maxAutoPurchases: 3,
  minReserve: cr(5),
  allowRtm: false,
  rtmCeiling: null,
  ...over,
});

const input = (over: Partial<AutoInput> = {}): AutoInput => ({
  rules: RULES,
  strategy: strategy(),
  counters: { spentAuto: 0n, purchasesAuto: 0 },
  team: { teamId: 'me', remainingPurse: cr(60), squad: [], roles: [] },
  player: { ...p('batter'), playerId: 'star' },
  amount: cr(2),
  leaderTeamId: null,
  lowestBasePrice: cr(0.3),
  available: deepPool,
  ...over,
});

describe('automated bidding (ADR-027)', () => {
  it('never bids without an enabled strategy', () => {
    expect(autoDecision(input({ strategy: null })).reason).toBe('NO_STRATEGY');
    expect(autoDecision(input({ strategy: strategy({ enabled: false }) })).bid).toBe(false);
  });

  it('bids on a named target up to its ceiling, never above', () => {
    const ok = autoDecision(input({ amount: cr(10) }));
    expect(ok).toMatchObject({ bid: true, reason: 'BID', ceiling: cr(10) });
    expect(autoDecision(input({ amount: cr(10.2) }))).toMatchObject({
      bid: false,
      reason: 'OVER_CEILING',
    });
  });

  it('does not raise its own lead', () => {
    expect(autoDecision(input({ leaderTeamId: 'me' })).reason).toBe('ALREADY_LEADING');
  });

  it('ignores players that are neither targets nor an unmet role with a ceiling', () => {
    const other = { ...p('batter'), playerId: 'x' };
    expect(autoDecision(input({ player: other })).reason).toBe('NOT_TARGET');
    const bowler = { ...p('bowler', 'pace'), playerId: 'b' };
    expect(autoDecision(input({ player: bowler, amount: cr(1) })).bid).toBe(true);
    const sixBowlers = Array.from({ length: 6 }, () => 'bowler' as const);
    expect(
      autoDecision(
        input({
          player: bowler,
          amount: cr(1),
          team: { teamId: 'me', remainingPurse: cr(60), squad: [], roles: sixBowlers },
        }),
      ).reason,
    ).toBe('ROLE_FILLED');
  });

  it('respects the total automated cap and the maximum automated purchases', () => {
    expect(
      autoDecision(input({ amount: cr(6), counters: { spentAuto: cr(15), purchasesAuto: 1 } }))
        .reason,
    ).toBe('CAP_REACHED');
    expect(autoDecision(input({ counters: { spentAuto: 0n, purchasesAuto: 3 } })).reason).toBe(
      'PURCHASES_REACHED',
    );
  });

  it('keeps the minimum-squad reserve and the team’s own reserve', () => {
    // 17 places still to fill at ₹30 lakh = ₹5.1 cr kept back from ₹8 cr.
    const tight = autoDecision(
      input({ amount: cr(3), team: { teamId: 'me', remainingPurse: cr(8), squad: [], roles: [] } }),
    );
    expect(tight).toMatchObject({ bid: false, reason: 'RESERVE', reservePlaces: 17 });
    const own = autoDecision(
      input({
        amount: cr(6),
        team: { teamId: 'me', remainingPurse: cr(15), squad: [], roles: [] },
        strategy: strategy({
          targets: [{ playerId: 'star', ceiling: cr(10) }],
          minReserve: cr(10),
        }),
      }),
    );
    expect(own.reason).toBe('USER_RESERVE');
  });

  it('uses the shared validator (a full squad never bids)', () => {
    const full = Array.from({ length: 25 }, () => p('batter'));
    expect(
      autoDecision(
        input({ team: { teamId: 'me', remainingPurse: cr(60), squad: full, roles: [] } }),
      ).reason,
    ).toBe('SQUAD_FULL');
  });

  it('uses a right-to-match card only when allowed and within its ceiling', () => {
    expect(autoRtmDecision(input()).reason).toBe('NOT_TARGET');
    const allowed = strategy({ allowRtm: true, rtmCeiling: cr(4) });
    expect(autoRtmDecision(input({ strategy: allowed, amount: cr(4) })).bid).toBe(true);
    expect(autoRtmDecision(input({ strategy: allowed, amount: cr(4.2) })).reason).toBe(
      'OVER_CEILING',
    );
  });

  it('waits a deterministic 700–1,300 ms that rotates by lot', () => {
    const delays = [0, 1, 2, 3].map((seat) => autoBidDelayMs(5, seat, 4));
    expect(Math.min(...delays)).toBe(700);
    expect(Math.max(...delays)).toBe(1300);
    expect(autoBidDelayMs(5, 0, 4)).not.toBe(autoBidDelayMs(6, 0, 4));
    expect(autoBidDelayMs(5, 0, 4)).toBe(autoBidDelayMs(5, 0, 4));
  });
});
