import { describe, expect, it } from 'vitest';
import { CARD_METRICS, type CardMetric, type Rarity } from '@stumps/contracts';
import {
  CardEngineError,
  dealMatch,
  fallbackWinner,
  finishMatch,
  hmacSha256,
  RandomStream,
  seedCommitment,
  selectCategory,
  sha256,
  startMatch,
  streams,
  timeoutMetric,
  timeoutSelection,
  toHex,
  utf8,
  type CardInstance,
  type DealDefinition,
  type MatchState,
} from '../src';

const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
let counter = 0;
const newId = () => `id-${(counter += 1)}`;

const pts = (batting: number, rest = 500): Record<CardMetric, number> => ({
  batting,
  bowling: rest,
  fielding: rest,
  form: rest,
  experience: rest,
  versatility: rest,
});
const card = (id: string, batting: number, rest = 500): CardInstance => ({
  id,
  definitionId: `def-${id}`,
  ratings: pts(batting, rest),
});

/** Start a match from explicit decks (top first). */
function match(decks: Record<string, CardInstance[]>, selector: string, tieCap = 12) {
  const seats = Object.keys(decks);
  return startMatch({
    seats,
    instances: Object.values(decks).flat(),
    decks: seats.map((s) => (decks[s] ?? []).map((c) => c.id)),
    selector,
    fallbackOrder: seats,
    tieCap,
    newId,
  });
}
const counts = (s: MatchState) =>
  Object.fromEntries(s.seats.map((x) => [x.memberId, x.deck.length]));

describe('pure SHA-256 / HMAC (no platform crypto in the engine)', () => {
  it('matches the FIPS 180-4 and RFC 4231 test vectors', () => {
    expect(toHex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(toHex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(utf8('a'.repeat(1_000_000))))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
    expect(toHex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('committed randomness (hmac-sha256-ctr-v1)', () => {
  it('commitment binds seed, room nonce and config hash', () => {
    const c = seedCommitment(seed, 'room-1', 'cfg');
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(seedCommitment(seed, 'room-2', 'cfg')).not.toBe(c);
  });

  it('streams are deterministic, independent by label, and uniform in range', () => {
    const a = new RandomStream(seed, 'deal');
    const b = new RandomStream(seed, 'deal');
    const other = new RandomStream(seed, 'seats');
    const xs = Array.from({ length: 50 }, () => a.uniform(7));
    expect(Array.from({ length: 50 }, () => b.uniform(7))).toEqual(xs);
    expect(Array.from({ length: 50 }, () => other.uniform(7))).not.toEqual(xs);
    const hist = new Array(6).fill(0);
    const s = new RandomStream(seed, 'fallback');
    for (let i = 0; i < 60_000; i += 1) hist[s.uniform(6)] += 1;
    for (const h of hist) expect(Math.abs(h - 10_000)).toBeLessThan(500);
  });

  it('shuffle is a permutation', () => {
    const out = new RandomStream(seed, 'deal').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('fair deal', () => {
  const rarities: Rarity[] = ['normal', 'bronze', 'silver', 'gold', 'dual_platinum'];
  const pool: DealDefinition[] = [];
  for (let i = 0; i < 60; i += 1)
    pool.push({ definitionId: `b${i}`, rarity: 'bronze', ratings: pts(10 * i, 300) });
  for (const r of ['normal', 'silver', 'gold'] as const)
    for (let i = 0; i < 8; i += 1)
      pool.push({ definitionId: `${r}${i}`, rarity: r, ratings: pts(900, 600) });
  for (let i = 0; i < 4; i += 1)
    pool.push({ definitionId: `d${i}`, rarity: 'dual_platinum', ratings: pts(950, 700) });
  const deal = (seats: string[], total: number, mode: 'stratified' | 'random' = 'stratified') =>
    dealMatch({
      pool,
      seats,
      totalCards: total,
      enabledRarities: rarities,
      mode,
      streams: streams(seed),
      newId,
    });

  it('every seat receives the same number; no definition twice; at most one dual', () => {
    for (const seats of [
      ['A', 'B'],
      ['A', 'B', 'C', 'D'],
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    ]) {
      const total = seats.length * 6;
      const r = deal(seats, total);
      expect(r.decks.map((d) => d.length)).toEqual(seats.map(() => 6));
      const defs = r.instances.map((i) => i.definitionId);
      expect(new Set(defs).size).toBe(defs.length);
      expect(defs.filter((d) => d.startsWith('d')).length).toBeLessThanOrEqual(1);
      expect(seats).toContain(r.selector);
      expect([...r.fallbackOrder].sort()).toEqual([...seats].sort());
    }
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = deal(['A', 'B', 'C', 'D'], 24);
    const b = deal(['A', 'B', 'C', 'D'], 24);
    expect(b.instances.map((i) => i.definitionId)).toEqual(a.instances.map((i) => i.definitionId));
    const other = dealMatch({
      pool,
      seats: ['A', 'B', 'C', 'D'],
      totalCards: 24,
      enabledRarities: rarities,
      mode: 'stratified',
      streams: streams(Uint8Array.from({ length: 32 }, () => 9)),
      newId,
    });
    expect(other.instances.map((i) => i.definitionId)).not.toEqual(
      a.instances.map((i) => i.definitionId),
    );
  });

  it('stratified: every seat gets the same number of cards from each strength band', () => {
    const r = deal(['A', 'B', 'C', 'D'], 32);
    const byId = new Map(r.instances.map((i) => [i.id, i]));
    const mean = (id: string) =>
      CARD_METRICS.reduce((s, m) => s + (byId.get(id)?.ratings[m] ?? 0), 0);
    const sorted = r.instances.map((i) => mean(i.id)).sort((a, b) => b - a);
    const topBand = sorted[7] as number; // 2 rounds × 4 seats in the strongest band
    for (const deck of r.decks) {
      expect(deck.filter((id) => mean(id) >= topBand).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects uneven or oversized deals and an insufficient pool before dealing', () => {
    expect(() => deal(['A', 'B', 'C'], 20)).toThrow(CardEngineError);
    expect(() => deal(['A'], 8)).toThrow(/2–8/);
    try {
      dealMatch({
        pool: pool.slice(0, 5),
        seats: ['A', 'B'],
        totalCards: 8,
        enabledRarities: ['bronze'],
        mode: 'random',
        streams: streams(seed),
        newId,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as CardEngineError).code).toBe('POOL_INSUFFICIENT');
    }
  });
});

describe('normal contest (rules §5, §14 vectors)', () => {
  it('92/87/94/79: C receives exactly 4, N conserved, C selects next', () => {
    const t = match(
      {
        A: [card('a1', 920), card('a2', 100)],
        B: [card('b1', 870), card('b2', 100)],
        C: [card('c1', 940), card('c2', 100)],
        D: [card('d1', 790), card('d2', 100)],
      },
      'A',
    );
    const c = t.state.comparison!;
    expect(c.active.map((x) => x.memberId)).toEqual(['A', 'B', 'C', 'D']);
    const r = selectCategory(t.state, { actor: 'A', comparisonId: c.id, metric: 'batting' }, newId);
    // C now owns 5; the next normal reveal already took one top card from each seat.
    expect(counts(r.state)).toEqual({ A: 0, B: 0, C: 4, D: 0 });
    expect(r.state.comparison?.active).toHaveLength(4);
    const resolved = r.events.find((e) => e.type === 'comparisonResolved');
    expect(resolved).toMatchObject({ winnerId: 'C', reason: 'UNIQUE_MAX' });
    const pot = r.events.find((e) => e.type === 'potChanged');
    expect(pot).toMatchObject({ awardedTo: 'C', awardedCount: 4 });
    expect(r.state.comparison?.selector).toBe('C');
    // C's winnings were appended at the tail in contribution order.
    expect(r.state.seats.find((s) => s.memberId === 'C')?.deck.slice(-4)).toEqual([
      'a1',
      'b1',
      'c1',
      'd1',
    ]);
  });

  it('94,94,82,76 then 88,96: B receives all 6; C and D submit once only', () => {
    const t = match(
      {
        A: [card('a1', 940), card('a2', 880), card('a3', 1)],
        B: [card('b1', 940), card('b2', 960), card('b3', 1)],
        C: [card('c1', 820), card('c2', 1)],
        D: [card('d1', 760), card('d2', 1)],
      },
      'A',
    );
    const tie = selectCategory(
      t.state,
      { actor: 'A', comparisonId: t.state.comparison!.id, metric: 'batting' },
      newId,
    );
    expect(tie.state.tiedSeats).toEqual(['A', 'B']);
    expect(tie.state.comparison?.contributors).toEqual(['A', 'B']);
    expect(tie.state.pot).toHaveLength(4);
    expect(tie.state.comparison?.selector).toBe('A');
    const done = selectCategory(
      tie.state,
      { actor: 'A', comparisonId: tie.state.comparison!.id, metric: 'batting' },
      newId,
    );
    expect(done.events.find((e) => e.type === 'potChanged')).toMatchObject({
      awardedTo: 'B',
      awardedCount: 6,
    });
    // C and D kept their second cards and return at the next normal boundary.
    expect(done.state.comparison?.contributors).toEqual(['A', 'B', 'C', 'D']);
  });

  it('a unique winner with a zero deck after the reveal survives; losers are eliminated after the award', () => {
    const t = match({ A: [card('a1', 990)], B: [card('b1', 100), card('b2', 100)] }, 'B');
    const r = selectCategory(
      t.state,
      { actor: 'B', comparisonId: t.state.comparison!.id, metric: 'batting' },
      newId,
    );
    expect(counts(r.state)).toEqual({ A: 1, B: 0 }); // A won 2, then revealed 1 vs B's last
    expect(r.state.seats.find((s) => s.memberId === 'A')?.eliminationOrder).toBeNull();
  });

  it('three simultaneous zero-card losers get a stable stored elimination order', () => {
    const t = match(
      {
        A: [card('a1', 990)],
        B: [card('b1', 100)],
        C: [card('c1', 200)],
        D: [card('d1', 300)],
      },
      'A',
    );
    const r = selectCategory(
      t.state,
      { actor: 'A', comparisonId: t.state.comparison!.id, metric: 'batting' },
      newId,
    );
    const elim = r.events.filter((e) => e.type === 'playerEliminated');
    expect(elim).toHaveLength(3);
    expect(r.state.result).toMatchObject({ reason: 'natural' });
    // Equal start counts and wins → fallback priority decides; stored, then reversed in standings.
    expect(r.state.result?.standings[0]).toBe('A');
    expect(r.state.result?.standings).toHaveLength(4);
    expect(new Set(r.state.result?.standings).size).toBe(4);
  });

  it('only the selector, only the open comparison, only real categories', () => {
    const t = match({ A: [card('a1', 500)], B: [card('b1', 400)] }, 'A');
    const id = t.state.comparison!.id;
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as CardEngineError).code;
      }
      return 'none';
    };
    expect(
      code(() =>
        selectCategory(t.state, { actor: 'B', comparisonId: id, metric: 'batting' }, newId),
      ),
    ).toBe('SELECTOR_ONLY');
    expect(
      code(() =>
        selectCategory(t.state, { actor: 'A', comparisonId: 'old', metric: 'batting' }, newId),
      ),
    ).toBe('STALE_COMPARISON');
    expect(
      code(() => selectCategory(t.state, { actor: 'A', comparisonId: id, metric: 'luck' }, newId)),
    ).toBe('METRIC_NOT_ALLOWED');
    // The input state is never mutated (a retried command replays from the same state).
    selectCategory(t.state, { actor: 'A', comparisonId: id, metric: 'batting' }, newId);
    expect(t.state.comparison?.id).toBe(id);
  });

  it('timeout picks the selector’s best advantage, enum order breaking equal advantages', () => {
    const a: CardInstance = {
      id: 'x1',
      definitionId: 'dx1',
      ratings: {
        batting: 500,
        bowling: 900,
        fielding: 500,
        form: 500,
        experience: 500,
        versatility: 500,
      },
    };
    const b: CardInstance = {
      id: 'y1',
      definitionId: 'dy1',
      ratings: {
        batting: 400,
        bowling: 600,
        fielding: 200,
        form: 500,
        experience: 500,
        versatility: 500,
      },
    };
    const t = match({ A: [a], B: [b] }, 'A');
    // batting +100, bowling +300, fielding +300: equal best advantages → enum order → bowling.
    expect(timeoutMetric(t.state)).toBe('bowling');
  });

  it('timeout resolves through the same reducer', () => {
    const t = match({ A: [card('a1', 500)], B: [card('b1', 400)] }, 'A');
    const r = timeoutSelection(t.state, { comparisonId: t.state.comparison!.id }, newId);
    expect(r.events.find((e) => e.type === 'comparisonResolved')).toMatchObject({
      byTimeout: true,
    });
  });
});

describe('ties and settlement (rules §6)', () => {
  it('sole remaining tied contributor takes the pot without an extra card', () => {
    const t = match(
      {
        A: [card('a1', 900)],
        B: [card('b1', 900), card('b2', 100)],
        C: [card('c1', 100), card('c2', 1)],
      },
      'A',
    );
    const r = selectCategory(
      t.state,
      { actor: 'A', comparisonId: t.state.comparison!.id, metric: 'batting' },
      newId,
    );
    expect(r.events.find((e) => e.type === 'comparisonResolved')).toMatchObject({
      reason: 'SOLE_TIE_CONTRIBUTOR',
      winnerId: 'B',
    });
  });

  it('all tied seats exhausted: fallback by the six-rating sum, A or B only', () => {
    const t = match(
      {
        A: [card('a1', 900, 600)],
        B: [card('b1', 900, 500)],
        C: [card('c1', 100), card('c2', 100)],
        D: [card('d1', 100), card('d2', 100)],
      },
      'A',
    );
    const r = selectCategory(
      t.state,
      { actor: 'A', comparisonId: t.state.comparison!.id, metric: 'batting' },
      newId,
    );
    expect(r.events.find((e) => e.type === 'comparisonResolved')).toMatchObject({
      reason: 'FALLBACK',
      winnerId: 'A',
    });
    expect(r.state.seats.find((s) => s.memberId === 'B')?.eliminationOrder).not.toBeNull();
  });

  it('identical cards fall back to the committed seat permutation', () => {
    const s = match({ A: [card('a1', 900)], B: [card('b1', 900)] }, 'A').state;
    s.pot = [
      { memberId: 'A', instanceId: 'a1', comparisonIndex: 0 },
      { memberId: 'B', instanceId: 'b1', comparisonIndex: 0 },
    ];
    s.fallbackOrder = ['B', 'A'];
    s.chainIndex = 0;
    expect(fallbackWinner(s, ['A', 'B'])).toBe('B');
    s.chainIndex = 1; // rotated by chainIndex mod participants
    expect(fallbackWinner(s, ['A', 'B'])).toBe('A');
  });

  it('time limit mid-chain restores contributions to deck fronts, then ranks', () => {
    const t = match(
      {
        A: [card('a1', 900), card('a2', 5)],
        B: [card('b1', 900), card('b2', 4)],
        C: [card('c1', 1), card('c2', 1)],
      },
      'A',
    );
    const tie = selectCategory(
      t.state,
      { actor: 'A', comparisonId: t.state.comparison!.id, metric: 'batting' },
      newId,
    );
    const end = finishMatch(tie.state, 'time_limit');
    expect(end.state.seats.find((s) => s.memberId === 'A')?.deck).toEqual(['a1', 'a2']);
    expect(end.state.seats.find((s) => s.memberId === 'C')?.deck).toEqual(['c1', 'c2']);
    expect(end.state.result?.reason).toBe('time_limit');
  });
});
