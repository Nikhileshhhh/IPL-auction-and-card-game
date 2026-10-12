import { cardSum, live, type Ctx } from './shared';
import type { FinishReason, MatchResult, MatchState, SeatState } from './types';

/**
 * Elimination and podium (rules §6.1–6.2).
 *
 * Elimination happens only after the pot is empty. Simultaneous eliminations
 * are ordered by larger start-of-chain deck count, then more decided contests
 * won, then committed fallback priority; that order is stored and never changes.
 */
export function eliminateEmptySeats(ctx: Ctx) {
  const s = ctx.state;
  const priority = (id: string) => s.fallbackOrder.indexOf(id);
  const out = live(s)
    .filter((x) => x.deck.length === 0)
    .sort(
      (a, b) =>
        a.chainStartCount - b.chainStartCount ||
        a.contestsWon - b.contestsWon ||
        priority(b.memberId) - priority(a.memberId),
    );
  for (const seat of out) {
    s.eliminationsSoFar += 1;
    seat.eliminationOrder = s.eliminationsSoFar;
    seat.eliminatedChain = s.chainIndex;
    ctx.events.push({
      type: 'playerEliminated',
      memberId: seat.memberId,
      eliminationOrder: seat.eliminationOrder,
    });
  }
}

/**
 * Final standings. Remaining players rank by deck count, then decided contests
 * won, then the sum of their deck's stats, then committed fallback priority
 * (a natural winner owns every card, so it is first). Eliminated players follow
 * in reverse elimination order — never all tied at zero.
 */
export function standings(s: MatchState): string[] {
  const priority = (id: string) => s.fallbackOrder.indexOf(id);
  const deckSum = (seat: SeatState) =>
    seat.deck.reduce((sum, id) => sum + cardSum(s.instances[id]), 0);
  const alive = live(s).sort(
    (a, b) =>
      b.deck.length - a.deck.length ||
      b.contestsWon - a.contestsWon ||
      deckSum(b) - deckSum(a) ||
      priority(a.memberId) - priority(b.memberId),
  );
  const eliminated = s.seats
    .filter((x) => x.eliminationOrder !== null)
    .sort((a, b) => (b.eliminationOrder ?? 0) - (a.eliminationOrder ?? 0));
  return [...alive, ...eliminated].map((x) => x.memberId);
}

/** Record the result; the match accepts no further transitions. */
export function finish(ctx: Ctx, reason: FinishReason) {
  const s = ctx.state;
  const result: MatchResult = { reason, standings: standings(s) };
  s.result = result;
  s.comparison = null;
  s.finishPending = null;
  ctx.events.push({ type: 'finished', result });
}
