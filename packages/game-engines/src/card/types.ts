import type { CardMetric, Rarity } from '@stumps/contracts';

/** Rating points per category, integers 0–1000 (rules §1; display is points/10). */
export type CardPoints = Readonly<Record<CardMetric, number>>;

/** One catalog definition offered to the deal (a frozen data version's card). */
export interface DealDefinition {
  definitionId: string;
  rarity: Rarity;
  ratings: CardPoints;
}

/** One dealt physical card of this match. */
export interface CardInstance {
  id: string;
  definitionId: string;
  ratings: CardPoints;
}

export interface SeatState {
  memberId: string;
  /** Deck top first. Only appended at the tail by winnings (rules §4.5). */
  deck: string[];
  /** Chain index at elimination, else null. */
  eliminatedChain: number | null;
  /** 1 = first eliminated (worst); stored at elimination, never changed. */
  eliminationOrder: number | null;
  /** Deck count at the start of the current chain (elimination tie-break). */
  chainStartCount: number;
  contestsWon: number;
}

export interface ActiveCard {
  memberId: string;
  instanceId: string;
}

export interface PotCard {
  memberId: string;
  instanceId: string;
  comparisonId: string;
  comparisonIndex: number;
}

export interface Comparison {
  id: string;
  /** Global, strictly increasing across the match. */
  index: number;
  selector: string;
  /** Contributors of this comparison in seat order. */
  contributors: string[];
  active: ActiveCard[];
}

export type FinishReason = 'natural' | 'cycle' | 'contest_cap' | 'time_limit' | 'vote';

/** An end requested mid-chain waits for the chain to settle (rules §6.2). */
export type PendingFinish = Extract<FinishReason, 'time_limit' | 'vote'>;

/** How an exhausted or capped tie was settled (rules §6 fallback), for the audit and S11. */
export interface FallbackDetail {
  /** Sum of the card stats of each tied seat's most recent contributed card. */
  sums: { memberId: string; sum: number }[];
  /** True when the sums were equal and the committed seat order decided. */
  byPermutation: boolean;
  /** The tied seats in the rotated committed order (only when it decided). */
  rotatedOrder: string[];
}

export interface MatchResult {
  reason: FinishReason;
  /** Member IDs, first place first. */
  standings: string[];
}

export interface MatchState {
  totalCards: number;
  tieCap: number;
  /** Immutable seat order. */
  seats: SeatState[];
  instances: Readonly<Record<string, CardInstance>>;
  /** Committed fallback permutation of member IDs (rules §4.4, §6). */
  fallbackOrder: string[];
  chainIndex: number;
  /** Original selector of the current chain. */
  chainSelector: string;
  /** Comparisons in the current chain after the normal one. */
  tieCount: number;
  /** Narrowed tied set of the current chain (empty at a normal comparison). */
  tiedSeats: string[];
  comparison: Comparison | null;
  /** Index of the last resolved comparison (-1 before the first). */
  lastComparisonIndex: number;
  pot: PotCard[];
  completedContests: number;
  eliminationsSoFar: number;
  /** Normal-boundary state key → occurrences (cycle guard, rules §6.2). */
  cycleCounts: Record<string, number>;
  /** Set when an end was requested mid-chain; the next normal boundary finishes. */
  finishPending: PendingFinish | null;
  result: MatchResult | null;
}

export type CardEngineEvent =
  | {
      type: 'roundOpened';
      comparisonId: string;
      comparisonIndex: number;
      chainIndex: number;
      selector: string;
      contributors: string[];
      cards: ActiveCard[];
      potCount: number;
      tie: boolean;
    }
  | {
      type: 'comparisonResolved';
      comparisonId: string;
      metric: CardMetric;
      byTimeout: boolean;
      values: { memberId: string; points: number }[];
      tiedSeats: string[];
      winnerId: string | null;
      reason: 'UNIQUE_MAX' | 'TIE' | 'SOLE_TIE_CONTRIBUTOR' | 'FALLBACK' | 'TIE_CAP';
      /** Present when FALLBACK or TIE_CAP settled the pot. */
      fallback?: FallbackDetail;
    }
  | {
      type: 'potChanged';
      potCount: number;
      awardedTo: string | null;
      awardedCount: number;
      deckCounts: Record<string, number>;
    }
  | { type: 'playerEliminated'; memberId: string; eliminationOrder: number }
  | { type: 'finishPending'; reason: PendingFinish }
  | { type: 'finished'; result: MatchResult };

export interface Transition {
  state: MatchState;
  events: CardEngineEvent[];
}

export type CardEngineErrorCode =
  | 'SELECTOR_ONLY'
  | 'STALE_COMPARISON'
  | 'METRIC_NOT_ALLOWED'
  | 'GAME_FINISHED'
  | 'POOL_INSUFFICIENT'
  | 'CONFIG_INVALID'
  | 'INVARIANT_VIOLATION';

export class CardEngineError extends Error {
  constructor(
    readonly code: CardEngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CardEngineError';
  }
}
