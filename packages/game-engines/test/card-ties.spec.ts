import { describe, expect, it } from 'vitest';
import {
  expireFinishGrace,
  finishMatch,
  requestFinish,
  selectCategory,
  startMatch,
  timeoutSelection,
  type CardEngineEvent,
  type CardInstance,
  type MatchState,
} from '../src';
import scenarios from '../../../tests/fixtures/cards/tie-scenarios.json';

type Triple = [number, number, number];
interface Scenario {
  name: string;
  selector: string;
  decks: Record<string, Triple[]>;
  steps: (
    | { select: string }
    | { timeout: true }
    | { requestFinish: 'time_limit' | 'vote' }
    | { expireGrace: true }
    | { playUntilDone: string; max: number }
  )[];
  expect: {
    reasons?: string[];
    holdings?: Record<string, number>;
    decks?: Record<string, string[]>;
    eliminated?: string[];
    tieContributors?: string[][];
    fallback?: { byPermutation: boolean; sums?: Record<string, number>; rotatedOrder?: string[] };
    result: { reason: string; standings?: string[] } | null;
  };
}

const fixture = scenarios as unknown as { scenarios: Scenario[] };

function run(sc: Scenario) {
  let ids = 0;
  const newId = () => `cmp-${(ids += 1)}`;
  const seats = Object.keys(sc.decks);
  const instances: CardInstance[] = seats.flatMap((seat) =>
    (sc.decks[seat] ?? []).map(([batting, bowling, runs], i) => ({
      id: `${seat}${i}`,
      definitionId: `def-${seat}${i}`,
      ratings: { batting, bowling, runs },
    })),
  );
  let t = startMatch({
    seats,
    instances,
    decks: seats.map((seat) => (sc.decks[seat] ?? []).map((_, i) => `${seat}${i}`)),
    selector: sc.selector,
    fallbackOrder: seats,
    tieCap: 12,
    newId,
  });
  const events: CardEngineEvent[] = [...t.events];
  const states: MatchState[] = [t.state];
  const apply = (next: typeof t) => {
    t = next;
    events.push(...next.events);
    states.push(next.state);
  };
  for (const step of sc.steps) {
    const open = t.state.comparison;
    if ('select' in step) {
      apply(
        selectCategory(
          t.state,
          { actor: open!.selector, comparisonId: open!.id, metric: step.select },
          newId,
        ),
      );
    } else if ('timeout' in step) {
      apply(timeoutSelection(t.state, { comparisonId: open!.id }, newId));
    } else if ('requestFinish' in step) {
      apply(requestFinish(t.state, step.requestFinish));
    } else if ('expireGrace' in step) {
      apply(expireFinishGrace(t.state));
    } else {
      for (let i = 0; i < step.max && !t.state.result; i += 1) {
        const c = t.state.comparison!;
        apply(
          selectCategory(
            t.state,
            { actor: c.selector, comparisonId: c.id, metric: step.playUntilDone },
            newId,
          ),
        );
      }
    }
  }
  return { state: t.state, events, states };
}

const holdings = (s: MatchState) =>
  Object.fromEntries(
    s.seats.map((x) => [
      x.memberId,
      x.deck.length + (s.comparison?.active.some((a) => a.memberId === x.memberId) ? 1 : 0),
    ]),
  );

describe('tie and termination scenarios (rules §6, fixtures)', () => {
  for (const sc of fixture.scenarios) {
    it(sc.name, () => {
      const { state, events, states } = run(sc);
      const total = Object.values(sc.decks).reduce((n, d) => n + d.length, 0);
      // N conserved after every transition (the engine also asserts invariants).
      for (const s of states) {
        const owned = Object.values(holdings(s)).reduce((n, v) => n + v, 0);
        expect(owned + s.pot.length).toBe(total);
      }
      const resolved = events.filter(
        (e): e is Extract<CardEngineEvent, { type: 'comparisonResolved' }> =>
          e.type === 'comparisonResolved',
      );
      if (sc.expect.reasons) expect(resolved.map((e) => e.reason)).toEqual(sc.expect.reasons);
      if (sc.expect.holdings) expect(holdings(state)).toEqual(sc.expect.holdings);
      if (sc.expect.decks) {
        expect(Object.fromEntries(state.seats.map((x) => [x.memberId, x.deck]))).toEqual(
          sc.expect.decks,
        );
      }
      if (sc.expect.eliminated) {
        expect(events.flatMap((e) => (e.type === 'playerEliminated' ? [e.memberId] : []))).toEqual(
          sc.expect.eliminated,
        );
      }
      if (sc.expect.tieContributors) {
        const tieRounds = events.flatMap((e) =>
          e.type === 'roundOpened' && e.tie ? [e.contributors] : [],
        );
        expect(tieRounds).toEqual(sc.expect.tieContributors);
      }
      if (sc.expect.fallback) {
        const detail = resolved.find((e) => e.fallback)?.fallback;
        expect(detail?.byPermutation).toBe(sc.expect.fallback.byPermutation);
        if (sc.expect.fallback.sums) {
          expect(Object.fromEntries(detail!.sums.map((x) => [x.memberId, x.sum]))).toEqual(
            sc.expect.fallback.sums,
          );
        }
        if (sc.expect.fallback.rotatedOrder)
          expect(detail!.rotatedOrder).toEqual(sc.expect.fallback.rotatedOrder);
      }
      if (sc.expect.result === null) {
        expect(state.result).toBeNull();
      } else {
        expect(state.result?.reason).toBe(sc.expect.result.reason);
        if (sc.expect.result.standings)
          expect(state.result?.standings).toEqual(sc.expect.result.standings);
        // Every seat appears exactly once on the podium.
        expect(new Set(state.result?.standings).size).toBe(state.seats.length);
      }
    });
  }
});

describe('requesting an end (rules §6.2)', () => {
  it('a pending end is idempotent and ends at the next boundary, never mid-chain', () => {
    const sc = fixture.scenarios.find((s) => s.name.startsWith('an end requested'))!;
    const { states } = run(sc);
    const pending = states.find((s) => s.finishPending === 'vote')!;
    expect(pending.result).toBeNull();
    expect(pending.comparison).not.toBeNull(); // the tie comparison is still open
    expect(requestFinish(pending, 'time_limit').events).toEqual([]);
    expect(requestFinish(pending, 'time_limit').state.finishPending).toBe('vote');
  });

  it('a vote that passes mid-tie restores every contribution to its contributor once (V09)', () => {
    const sc = fixture.scenarios.find((s) => s.name.startsWith('an end requested'))!;
    const { states } = run(sc);
    const midTie = states.find((s) => s.finishPending === 'vote')!;
    expect(midTie.pot.length + (midTie.comparison ? 1 : 0)).toBeGreaterThan(0);
    const { state } = finishMatch(midTie, 'vote');
    expect(state.result?.reason).toBe('vote');
    expect(state.pot).toEqual([]);
    expect(state.comparison).toBeNull();
    // N conserved, and each seat is back to its deck size at the start of the chain.
    expect(state.seats.reduce((n, seat) => n + seat.deck.length, 0)).toBe(state.totalCards);
    for (const seat of state.seats) expect(seat.deck.length).toBe(seat.chainStartCount);
    expect(new Set(state.seats.flatMap((seat) => seat.deck)).size).toBe(state.totalCards);
  });

  it('grace expiry without a pending end is refused', () => {
    const sc = fixture.scenarios[0]!;
    const { state } = run({ ...sc, steps: [] });
    expect(() => expireFinishGrace(state)).toThrow(/No end is pending/);
  });
});
