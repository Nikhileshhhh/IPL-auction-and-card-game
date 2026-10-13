import { purchaseRejection, type BidCheck } from './bids';
import { rtmCards } from './retention';
import { LAKH, type AuctionFormat, type AuctionRules, type CappedStatus } from './types';

/**
 * Right to match (TATA IPL Player Regulations 2025–27, rules §8.4). When
 * bidding closes with a leader, the player's previous franchise may use an RTM
 * card: it invokes (or declines), the high bidder then gets one final raise of
 * any whole-lakh amount at or above the standing bid (equal = hold), and the
 * RTM franchise matches that final offer or lets the bidder buy at it.
 */

export const RTM_STAGES = ['rtm_intent', 'rtm_raise', 'rtm_match'] as const;
export type RtmStage = (typeof RTM_STAGES)[number];

export interface RtmHolder {
  format: AuctionFormat;
  retainedCapped: number;
  retainedUncapped: number;
  rtmUsedCapped: number;
  rtmUsedUncapped: number;
}

/** Does the holder still have a card for a player of this status? */
export function hasRtmCard(rules: AuctionRules, h: RtmHolder, status: CappedStatus): boolean {
  const cards = rtmCards(
    rules,
    h.format,
    h.retainedCapped,
    h.retainedUncapped,
    h.rtmUsedCapped,
    h.rtmUsedUncapped,
  );
  if (cards.total <= 0) return false;
  if (status === 'capped') return cards.capped > 0;
  if (status === 'uncapped') return cards.uncapped > 0;
  return false; // an unknown status is never assumed
}

/**
 * RTM opens only for a previous franchise that is in the room, is not the
 * leader, holds a card for this player and could itself buy at the standing bid.
 */
export function rtmOpens(input: {
  rules: AuctionRules;
  holder: RtmHolder | null;
  holderTeamId: string | null;
  leaderTeamId: string;
  status: CappedStatus;
  purchaseAtStanding: Omit<BidCheck, 'leaderTeamId'> | null;
}): boolean {
  if (!input.holder || !input.holderTeamId || input.holderTeamId === input.leaderTeamId)
    return false;
  if (!hasRtmCard(input.rules, input.holder, input.status)) return false;
  return input.purchaseAtStanding !== null && purchaseRejection(input.purchaseAtStanding) === null;
}

export type FinalOfferProblem =
  | { code: 'NOT_WHOLE_LAKH' }
  | { code: 'BELOW_STANDING' }
  | { code: 'BUDGET_RESERVE'; allowedCeiling: bigint };

/** The high bidder's single final raise: whole lakhs, ≥ standing (equal holds), within its ceiling. */
export function finalOfferProblem(
  amount: bigint,
  standing: bigint,
  ceiling: bigint,
): FinalOfferProblem | null {
  if (amount % LAKH !== 0n) return { code: 'NOT_WHOLE_LAKH' };
  if (amount < standing) return { code: 'BELOW_STANDING' };
  if (amount > ceiling) return { code: 'BUDGET_RESERVE', allowedCeiling: ceiling };
  return null;
}
