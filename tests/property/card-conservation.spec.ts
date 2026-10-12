import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CARD_METRICS } from '@stumps/contracts';
import {
  assertInvariants,
  dealMatch,
  expireFinishGrace,
  requestFinish,
  selectCategory,
  startMatch,
  streams,
  timeoutSelection,
  type DealDefinition,
  type MatchState,
} from '@stumps/game-engines';

/**
 * Card conservation (rules §1, master plan L221): over 2–8 seats, random deals and
 * random play (choices and timeouts), every transition keeps all N cards in exactly
 * one place, the match always terminates, and replay is deterministic.
 */
function play(seed: Uint8Array, seats: string[], perSeat: number, choices: number[]) {
  // Few distinct values → many ties, fallbacks and cycle-guard endings.
  const pool: DealDefinition[] = Array.from({ length: seats.length * perSeat + 10 }, (_, i) => ({
    definitionId: `def-${String(i).padStart(4, '0')}`,
    rarity: 'bronze',
    ratings: Object.fromEntries(
      CARD_METRICS.map((m, k) => [m, ((i * 7 + k * 3) % 5) * 100]),
    ) as DealDefinition['ratings'],
  }));
  let ids = 0;
  const newId = () => `id-${(ids += 1)}`;
  const dealt = dealMatch({
    pool,
    seats,
    totalCards: seats.length * perSeat,
    enabledRarities: ['bronze'],
    mode: 'stratified',
    streams: streams(seed),
    newId,
  });
  let { state } = startMatch({
    seats,
    instances: dealt.instances,
    decks: dealt.decks,
    selector: dealt.selector,
    fallbackOrder: dealt.fallbackOrder,
    tieCap: 12,
    newId,
  });
  let steps = 0;
  const TIMEOUT = CARD_METRICS.length;
  const END = TIMEOUT + 1;
  const GRACE = TIMEOUT + 2;
  while (!state.result) {
    const c = state.comparison as NonNullable<MatchState['comparison']>;
    const choice = choices[steps % choices.length] ?? 0;
    if (choice === END && !state.finishPending) {
      state = requestFinish(state, steps % 2 ? 'vote' : 'time_limit').state;
    } else if (choice === GRACE && state.finishPending) {
      state = expireFinishGrace(state).state;
    } else if (choice >= TIMEOUT) {
      state = timeoutSelection(state, { comparisonId: c.id }, newId).state;
    } else {
      state = selectCategory(
        state,
        { actor: c.selector, comparisonId: c.id, metric: CARD_METRICS[choice] as string },
        newId,
      ).state;
    }
    assertInvariants(state);
    steps += 1;
    if (steps > 20_000) throw new Error('did not terminate');
  }
  return { state, steps };
}

describe('card conservation property', () => {
  it('N cards in exactly one place after every transition; always terminates; deterministic', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 4, max: 8 }),
        // One index per category, then: let the selection time out, request an end
        // (time limit or vote), or expire a pending end's grace period.
        fc.array(fc.integer({ min: 0, max: CARD_METRICS.length + 2 }), {
          minLength: 1,
          maxLength: 12,
        }),
        (seed, n, perSeat, choices) => {
          const seats = Array.from({ length: n }, (_, i) => `seat-${i}`);
          const a = play(seed, seats, perSeat, choices);
          const total = a.state.seats.reduce((s, x) => s + x.deck.length, 0);
          expect(total).toBe(n * perSeat);
          expect(a.state.result?.standings).toHaveLength(n);
          expect(new Set(a.state.result?.standings).size).toBe(n);
          // Podium stability: every eliminated seat ranks below every remaining
          // seat, in reverse elimination order (never "all tied at zero").
          const standings = a.state.result?.standings ?? [];
          const order = (id: string) =>
            a.state.seats.find((x) => x.memberId === id)?.eliminationOrder ?? null;
          const firstOut = standings.findIndex((id) => order(id) !== null);
          if (firstOut >= 0) {
            const tail = standings.slice(firstOut);
            expect(tail.every((id) => order(id) !== null)).toBe(true);
            const orders = tail.map((id) => order(id) as number);
            expect(orders).toEqual([...orders].sort((x, y) => y - x));
          }
          const b = play(seed, seats, perSeat, choices);
          expect(b.state.result).toEqual(a.state.result);
          expect(b.steps).toBe(a.steps);
        },
      ),
      { numRuns: 60 },
    );
  }, 180_000);
});
