import { CARD_METRICS } from '@stumps/contracts';
import {
  CardEngineError,
  type CardEngineEvent,
  type CardInstance,
  type MatchState,
  type SeatState,
} from './types';

/** A transition in progress: a private copy of the state plus the events it emits. */
export type Ctx = { state: MatchState; events: CardEngineEvent[]; newId: () => string };

/** Transitions never mutate their input (the state is plain JSON data). */
export const cloneState = (s: MatchState): MatchState =>
  JSON.parse(JSON.stringify(s)) as MatchState;

export const seatOf = (s: MatchState, memberId: string): SeatState => {
  const seat = s.seats.find((x) => x.memberId === memberId);
  if (!seat) throw new CardEngineError('INVARIANT_VIOLATION', `Unknown seat ${memberId}.`);
  return seat;
};

/** Seats not yet eliminated, in immutable seat order. */
export const live = (s: MatchState) => s.seats.filter((x) => x.eliminationOrder === null);

export const deckCounts = (s: MatchState) =>
  Object.fromEntries(s.seats.map((x) => [x.memberId, x.deck.length] as const));

/** First seat clockwise after `from` (exclusive, wrapping) that satisfies `ok`. */
export function clockwise(
  s: MatchState,
  from: string,
  ok: (seat: SeatState) => boolean,
): string | null {
  const start = s.seats.findIndex((x) => x.memberId === from);
  for (let step = 1; step <= s.seats.length; step += 1) {
    const seat = s.seats[(start + step) % s.seats.length] as SeatState;
    if (ok(seat)) return seat.memberId;
  }
  return null;
}

/** Sum of a card's stats (fallback composite and final rating tie-break). */
export const cardSum = (card: CardInstance | undefined) =>
  card ? CARD_METRICS.reduce((t, m) => t + card.ratings[m], 0) : 0;
