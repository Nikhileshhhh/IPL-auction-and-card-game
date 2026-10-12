import {
  CARD_METRICS,
  type CardMetric,
  type PermittedCardSnapshotDTO,
  type RoomMemberSummary,
} from '@stumps/contracts';

export type CardGame = PermittedCardSnapshotDTO;
type ArenaCard = CardGame['visibleCards'][number]['card'];

/** Display name for a seat; members who left keep their seat as "Former player". */
export function seatName(members: readonly RoomMemberSummary[], memberId: string | null): string {
  if (!memberId) return 'Nobody';
  return members.find((m) => m.id === memberId)?.displayName ?? 'Former player';
}

/** Whole seconds until a deadline, judged on the server clock (never below zero). */
export function secondsLeft(deadline: string | null, serverNowMs: number): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - serverNowMs) / 1000));
}

export const FINISH_LABELS: Record<NonNullable<CardGame['result']>['reason'], string> = {
  natural: 'One player collected every card.',
  cycle: 'The same position repeated three times, so the match ended by card count.',
  contest_cap: 'The contest limit was reached, so the match ended by card count.',
  time_limit: 'The match time limit was reached, so it ended by card count.',
  vote: 'The players voted to end the match, so it ended by card count.',
};

export const REASON_LABELS: Record<string, string> = {
  UNIQUE_MAX: 'Highest value wins the pot.',
  TIE: 'Tie: the pot carries over and the tied players reveal again.',
  SOLE_TIE_CONTRIBUTOR: 'Tie, and only one tied player had cards left, so they win the pot.',
  FALLBACK: 'Tie with no cards left: decided by the latest cards, then the committed seat order.',
  TIE_CAP: 'Tie limit reached: decided by the latest cards, then the committed seat order.',
};

export interface ArenaView {
  myCard: ArenaCard | null;
  isSelector: boolean;
  /** The server lists the action; the UI still needs a live, controlling tab. */
  canSelect: boolean;
  /** In a tie chain this player is not among the eligible seats. */
  waitingForTie: boolean;
  eliminated: boolean;
  /** Seats in immutable order with their visible card, if any. */
  seats: {
    memberId: string;
    deckCount: number;
    eliminated: boolean;
    contestsWon: number;
    card: ArenaCard | null;
    eligible: boolean;
  }[];
}

export function arenaView(game: CardGame, myMemberId: string, canAct: boolean): ArenaView {
  const cardOf = (id: string) => game.visibleCards.find((v) => v.memberId === id)?.card ?? null;
  const me = game.seats.find((s) => s.memberId === myMemberId);
  const isSelector = game.selectorSeat === myMemberId;
  return {
    myCard: cardOf(myMemberId),
    isSelector,
    canSelect:
      canAct && game.comparisonId !== null && game.myAllowedActions.includes('card.selectCategory'),
    waitingForTie:
      game.isTie && game.comparisonId !== null && !game.eligibleSeats.includes(myMemberId),
    eliminated: (me?.eliminationOrder ?? null) !== null,
    seats: game.seats.map((s) => ({
      memberId: s.memberId,
      deckCount: s.deckCount,
      eliminated: s.eliminationOrder !== null,
      contestsWon: s.contestsWon,
      card: cardOf(s.memberId),
      eligible: game.eligibleSeats.includes(s.memberId),
    })),
  };
}

/** Category rows in fixed enum order (rows never move between rounds). */
export function metricRows(card: ArenaCard | null): { metric: CardMetric; value: number | null }[] {
  return CARD_METRICS.map((metric) => ({ metric, value: card ? card.ratings[metric] : null }));
}
