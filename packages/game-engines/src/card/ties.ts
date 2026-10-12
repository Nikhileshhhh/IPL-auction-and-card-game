import { cardSum, clockwise, seatOf } from './shared';
import type { FallbackDetail, MatchState } from './types';

/**
 * Tie rules (rules §6). On multiple maxima the whole pot stays and only the
 * maxima continue; temporarily ineligible players keep their decks and return
 * at the next normal boundary. A losing seat never re-enters the chain.
 */

/** Tied seats that still hold a card and may contribute to the next comparison. */
export function ableSeats(s: MatchState, tied: readonly string[]): string[] {
  return tied.filter((id) => seatOf(s, id).deck.length > 0);
}

/**
 * Selector for the next tie comparison: the chain's original selector while it
 * is still tied and has a card; otherwise the first able seat clockwise after
 * that original selector. The original selector never regains control once it
 * has dropped out of the tied set.
 */
export function tieSelector(s: MatchState, able: readonly string[]): string {
  if (able.includes(s.chainSelector)) return s.chainSelector;
  const next = clockwise(s, s.chainSelector, (x) => able.includes(x.memberId));
  return next ?? (able[0] as string);
}

/**
 * Fallback (rules §6, proposed fixed v1): the tied seats' most recent
 * contributed cards compared by the sum of their stats; if still equal, the
 * committed fallback seat permutation rotated by `chainIndex mod seats`, first
 * tied seat wins. Deterministic given the seed; the detail is published.
 */
export function fallbackWinner(
  s: MatchState,
  tied: readonly string[],
): { winner: string; detail: FallbackDetail } {
  const lastSum = (memberId: string) => {
    const last = [...s.pot].reverse().find((p) => p.memberId === memberId);
    return last ? cardSum(s.instances[last.instanceId]) : -1;
  };
  const sums = tied.map((memberId) => ({ memberId, sum: lastSum(memberId) }));
  const best = Math.max(...sums.map((x) => x.sum));
  const leaders = sums.filter((x) => x.sum === best).map((x) => x.memberId);
  if (leaders.length === 1) {
    return {
      winner: leaders[0] as string,
      detail: { sums, byPermutation: false, rotatedOrder: [] },
    };
  }
  const n = s.seats.length;
  const r = ((s.chainIndex % n) + n) % n;
  const rotated = [...s.fallbackOrder.slice(r), ...s.fallbackOrder.slice(0, r)];
  const order = rotated.filter((id) => leaders.includes(id));
  return {
    winner: order[0] as string,
    detail: { sums, byPermutation: true, rotatedOrder: order },
  };
}
