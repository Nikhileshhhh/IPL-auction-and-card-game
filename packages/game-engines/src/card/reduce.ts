import { CARD_METRICS, type CardMetric } from '@stumps/contracts';
import { assertInvariants } from './invariants';
import { eliminateEmptySeats, finish } from './ranking';
import { sha256Hex } from './rng';
import { cloneState, clockwise, deckCounts, live, seatOf, type Ctx } from './shared';
import { ableSeats, fallbackWinner, tieSelector } from './ties';
import {
  CardEngineError,
  type CardEngineEvent,
  type CardInstance,
  type FallbackDetail,
  type MatchState,
  type SeatState,
  type Transition,
} from './types';

export { cloneState } from './shared';

/** Rules §1: three identical boundary states or 2,000 decided contests end the match. */
export const CYCLE_LIMIT = 3;
export const CONTEST_LIMIT = 2000;

export interface StartInput {
  seats: readonly string[];
  instances: readonly CardInstance[];
  decks: readonly (readonly string[])[];
  selector: string;
  fallbackOrder: readonly string[];
  tieCap: number;
  newId: () => string;
}

/** Initialize a dealt match and open its first comparison (rules §4.4–4.5). */
export function startMatch(input: StartInput): Transition {
  if (input.seats.length !== input.decks.length)
    throw new CardEngineError('INVARIANT_VIOLATION', 'One deck per seat.');
  const state: MatchState = {
    totalCards: input.instances.length,
    tieCap: input.tieCap,
    seats: input.seats.map((memberId, i) => ({
      memberId,
      deck: [...(input.decks[i] ?? [])],
      eliminatedChain: null,
      eliminationOrder: null,
      chainStartCount: input.decks[i]?.length ?? 0,
      contestsWon: 0,
    })),
    instances: Object.fromEntries(input.instances.map((c) => [c.id, c] as const)),
    fallbackOrder: [...input.fallbackOrder],
    chainIndex: -1,
    chainSelector: input.selector,
    tieCount: 0,
    tiedSeats: [],
    comparison: null,
    lastComparisonIndex: -1,
    pot: [],
    completedContests: 0,
    eliminationsSoFar: 0,
    cycleCounts: {},
    finishPending: null,
    result: null,
  };
  const ctx: Ctx = { state, events: [], newId: input.newId };
  openBoundary(ctx, input.selector);
  assertInvariants(ctx.state);
  return { state: ctx.state, events: ctx.events };
}

/** The selector's category command (rules §5). One valid command per comparison. */
export function selectCategory(
  state: MatchState,
  cmd: { actor: string; comparisonId: string; metric: string },
  newId: () => string,
): Transition {
  const ctx: Ctx = { state: cloneState(state), events: [], newId };
  const c = ctx.state.comparison;
  if (ctx.state.result) throw new CardEngineError('GAME_FINISHED', 'The match has finished.');
  if (!c || c.id !== cmd.comparisonId)
    throw new CardEngineError('STALE_COMPARISON', 'That comparison is no longer open.');
  if (cmd.actor !== c.selector)
    throw new CardEngineError('SELECTOR_ONLY', 'Only the selector can choose a category.');
  if (!(CARD_METRICS as readonly string[]).includes(cmd.metric))
    throw new CardEngineError('METRIC_NOT_ALLOWED', 'That category is not available.');
  resolve(ctx, cmd.metric as CardMetric, false);
  assertInvariants(ctx.state);
  return { state: ctx.state, events: ctx.events };
}

/**
 * Public deterministic timeout policy (rules §5): the category with the largest
 * (selector points − best opponent points); equal advantages go to enum order.
 */
export function timeoutMetric(state: MatchState): CardMetric {
  const c = state.comparison;
  if (!c) throw new CardEngineError('STALE_COMPARISON', 'No open comparison.');
  const card = (memberId: string) => {
    const a = c.active.find((x) => x.memberId === memberId);
    return state.instances[a?.instanceId ?? ''] as CardInstance;
  };
  const own = card(c.selector);
  let best: CardMetric = CARD_METRICS[0];
  let bestAdv = Number.NEGATIVE_INFINITY;
  for (const m of CARD_METRICS) {
    const opp = Math.max(
      ...c.contributors.filter((id) => id !== c.selector).map((id) => card(id).ratings[m]),
    );
    const adv = own.ratings[m] - opp;
    if (adv > bestAdv) {
      bestAdv = adv;
      best = m;
    }
  }
  return best;
}

/** Selection deadline passed: resolve with the timeout policy (offline users alike). */
export function timeoutSelection(
  state: MatchState,
  cmd: { comparisonId: string },
  newId: () => string,
): Transition {
  const ctx: Ctx = { state: cloneState(state), events: [], newId };
  const c = ctx.state.comparison;
  if (ctx.state.result) throw new CardEngineError('GAME_FINISHED', 'The match has finished.');
  if (!c || c.id !== cmd.comparisonId)
    throw new CardEngineError('STALE_COMPARISON', 'That comparison is no longer open.');
  resolve(ctx, timeoutMetric(ctx.state), true);
  assertInvariants(ctx.state);
  return { state: ctx.state, events: ctx.events };
}

// ------------------------------------------------------------------ internals

/**
 * A normal boundary: a pending end, completion and cycle checks, then the next
 * chain's reveal.
 */
function openBoundary(ctx: Ctx, preferredSelector: string) {
  const s = ctx.state;
  if (s.finishPending) return finish(ctx, s.finishPending);
  const eligible = live(s).filter((x) => x.deck.length > 0);
  if (eligible.length <= 1) {
    const owner = eligible[0];
    if (!owner || owner.deck.length !== s.totalCards)
      throw new CardEngineError('INVARIANT_VIOLATION', 'A natural winner must own all cards.');
    return finish(ctx, 'natural');
  }
  const selector = eligible.some((x) => x.memberId === preferredSelector)
    ? preferredSelector
    : (clockwise(s, preferredSelector, (x) => x.eliminationOrder === null && x.deck.length > 0) ??
      (eligible[0] as SeatState).memberId);

  // Cycle guard over (ordered remaining decks, live seat set, selector).
  const key = sha256Hex(
    JSON.stringify({
      decks: live(s).map((x) => [x.memberId, x.deck]),
      selector,
    }),
  );
  s.cycleCounts[key] = (s.cycleCounts[key] ?? 0) + 1;
  if (s.cycleCounts[key] >= CYCLE_LIMIT) return finish(ctx, 'cycle');
  if (s.completedContests >= CONTEST_LIMIT) return finish(ctx, 'contest_cap');

  s.chainIndex += 1;
  s.chainSelector = selector;
  s.tieCount = 0;
  s.tiedSeats = [];
  for (const seat of live(s)) seat.chainStartCount = seat.deck.length;
  openComparison(
    ctx,
    eligible.map((x) => x.memberId),
    selector,
    false,
  );
}

function openComparison(ctx: Ctx, contributors: string[], selector: string, tie: boolean) {
  const s = ctx.state;
  const ordered = s.seats.map((x) => x.memberId).filter((id) => contributors.includes(id));
  const active = ordered.map((memberId) => {
    const seat = seatOf(s, memberId);
    const instanceId = seat.deck.shift();
    if (!instanceId)
      throw new CardEngineError('INVARIANT_VIOLATION', 'Contributor without a card.');
    return { memberId, instanceId };
  });
  const index = s.lastComparisonIndex + 1;
  s.comparison = { id: ctx.newId(), index, selector, contributors: ordered, active };
  ctx.events.push({
    type: 'roundOpened',
    comparisonId: s.comparison.id,
    comparisonIndex: index,
    chainIndex: s.chainIndex,
    selector,
    contributors: ordered,
    cards: active,
    potCount: s.pot.length,
    tie,
  });
}

function resolve(ctx: Ctx, metric: CardMetric, byTimeout: boolean) {
  const s = ctx.state;
  const c = s.comparison;
  if (!c) throw new CardEngineError('STALE_COMPARISON', 'No open comparison.');
  const values = c.active.map((a) => ({
    memberId: a.memberId,
    points: (s.instances[a.instanceId] as CardInstance).ratings[metric],
  }));
  // ACTIVE → POT in seat order, tagged with this comparison.
  s.pot.push(...c.active.map((a) => ({ ...a, comparisonId: c.id, comparisonIndex: c.index })));
  s.lastComparisonIndex = c.index;
  s.comparison = null;

  const max = Math.max(...values.map((v) => v.points));
  const top = values.filter((v) => v.points === max).map((v) => v.memberId);
  const resolved = (
    winnerId: string | null,
    reason: Extract<CardEngineEvent, { type: 'comparisonResolved' }>['reason'],
    fallback?: FallbackDetail,
  ) =>
    ctx.events.push({
      type: 'comparisonResolved',
      comparisonId: c.id,
      metric,
      byTimeout,
      values,
      tiedSeats: top.length > 1 ? top : [],
      winnerId,
      reason,
      ...(fallback ? { fallback } : {}),
    });

  if (top.length === 1) {
    resolved(top[0] as string, 'UNIQUE_MAX');
    return award(ctx, top[0] as string);
  }

  // Tie (rules §6): the whole pot stays; only the maxima continue.
  s.tiedSeats = top;
  s.tieCount += 1;
  if (s.tieCount >= s.tieCap) {
    const { winner, detail } = fallbackWinner(s, top);
    resolved(winner, 'TIE_CAP', detail);
    return award(ctx, winner);
  }
  const able = ableSeats(s, top);
  if (able.length >= 2) {
    resolved(null, 'TIE');
    return openComparison(ctx, able, tieSelector(s, able), true);
  }
  if (able.length === 1) {
    resolved(able[0] as string, 'SOLE_TIE_CONTRIBUTOR');
    return award(ctx, able[0] as string);
  }
  const { winner, detail } = fallbackWinner(s, top);
  resolved(winner, 'FALLBACK', detail);
  return award(ctx, winner);
}

/** Transfer the whole pot to the winner's tail, then eliminate, then the next boundary. */
function award(ctx: Ctx, winnerId: string) {
  const s = ctx.state;
  const winner = seatOf(s, winnerId);
  const won = s.pot.map((p) => p.instanceId);
  winner.deck.push(...won);
  winner.contestsWon += 1;
  s.completedContests += 1;
  s.pot = [];
  s.tiedSeats = [];
  ctx.events.push({
    type: 'potChanged',
    potCount: 0,
    awardedTo: winnerId,
    awardedCount: won.length,
    deckCounts: deckCounts(s),
  });
  // Elimination only now, after the pot is empty (rules §6.1).
  eliminateEmptySeats(ctx);
  openBoundary(ctx, winnerId);
}
