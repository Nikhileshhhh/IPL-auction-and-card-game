import { assertInvariants } from './invariants';
import { finish } from './ranking';
import { cloneState, type Ctx } from './shared';
import {
  CardEngineError,
  type FinishReason,
  type MatchState,
  type PendingFinish,
  type Transition,
} from './types';

/**
 * Ending a match (rules §6.2).
 *
 * - `finishMatch` ends now. An unresolved chain is restored first: every POT
 *   and ACTIVE card returns to its contributor's deck front in original
 *   chronological order, so the cards taken at the start of the chain are on
 *   top again and all N cards have an owner. Eliminations and counters only
 *   change when a pot is awarded, so nothing provisional remains.
 * - `requestFinish` (soft time limit, vote) waits for the current chain: it
 *   marks `finishPending`, and the next normal boundary finishes the match.
 * - `expireFinishGrace` ends a still-pending match after its grace period.
 */

function restoreChain(s: MatchState) {
  const open = s.comparison;
  const contributed = [
    ...s.pot,
    ...(open?.active.map((a) => ({ ...a, comparisonIndex: open.index })) ?? []),
  ].sort((a, b) => a.comparisonIndex - b.comparisonIndex);
  for (const seat of s.seats) {
    const mine = contributed.filter((p) => p.memberId === seat.memberId).map((p) => p.instanceId);
    seat.deck = [...mine, ...seat.deck];
  }
  s.pot = [];
  s.comparison = null;
  s.tiedSeats = [];
  s.tieCount = 0;
}

/** End the match now (hard ceiling, grace expiry, or an end at a boundary). */
export function finishMatch(state: MatchState, reason: FinishReason): Transition {
  const ctx: Ctx = { state: cloneState(state), events: [], newId: () => '' };
  if (ctx.state.result) throw new CardEngineError('GAME_FINISHED', 'The match has finished.');
  restoreChain(ctx.state);
  finish(ctx, reason);
  assertInvariants(ctx.state);
  return { state: ctx.state, events: ctx.events };
}

/**
 * Request an end (soft time limit or approved vote). The open chain may still
 * settle; the match then finishes at the next normal boundary. Repeating a
 * request while one is pending changes nothing.
 */
export function requestFinish(state: MatchState, reason: PendingFinish): Transition {
  const ctx: Ctx = { state: cloneState(state), events: [], newId: () => '' };
  if (ctx.state.result) throw new CardEngineError('GAME_FINISHED', 'The match has finished.');
  if (ctx.state.finishPending) return { state: ctx.state, events: [] };
  ctx.state.finishPending = reason;
  ctx.events.push({ type: 'finishPending', reason });
  assertInvariants(ctx.state);
  return { state: ctx.state, events: ctx.events };
}

/** The pending chain did not settle in time: restore it and finish. */
export function expireFinishGrace(state: MatchState): Transition {
  if (state.result) throw new CardEngineError('GAME_FINISHED', 'The match has finished.');
  if (!state.finishPending)
    throw new CardEngineError('STALE_COMPARISON', 'No end is pending for this match.');
  return finishMatch(state, state.finishPending);
}
