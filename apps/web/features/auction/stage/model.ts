import type { AuctionLiveSnapshot, LiveTeam } from '@stumps/contracts';

/** The live auction projection inside the room snapshot (null outside the live auction). */
export function liveOf(game: unknown): AuctionLiveSnapshot | null {
  const g = game as AuctionLiveSnapshot | null;
  return g?.kind === 'auction-live' ? g : null;
}

export const teamById = (live: AuctionLiveSnapshot, id: string | null): LiveTeam | undefined =>
  id ? live.teams.find((t) => t.teamId === id) : undefined;

export const STAGE_LABELS = {
  bidding: 'Bidding',
  rtm_intent: 'Right to match: decision',
  rtm_raise: 'Right to match: final raise',
  rtm_match: 'Right to match: match or let go',
  settled: 'Settled',
} as const;

/** Why this team cannot bid, in plain words beside the bid button. */
export const BLOCK_REASONS = {
  NOT_ON_TEAM: 'You are watching: you are not in a team.',
  NO_BID_RIGHT: 'Your captain has not given you the right to bid.',
  ALREADY_LEADING: 'Your team holds the highest bid.',
  SQUAD_FULL: 'Your squad is full (25 players).',
  OVERSEAS_LIMIT: 'Your squad already has 8 overseas players.',
  BUDGET_RESERVE: 'That would leave too little purse to fill your minimum squad.',
  XI_INFEASIBLE: 'Buying this player would leave no legal XI within your squad places.',
  NOT_BIDDING: 'Bidding on this player has closed.',
} as const;

export const END_REASONS = {
  pool_complete: 'Every player has been under the hammer.',
  no_buyers: 'No team can buy any more players.',
  time_limit: 'The 8-hour limit was reached.',
  vote: 'The room voted to end the auction.',
} as const;

export const OUTCOME_LABELS = {
  sold: 'Sold',
  rtm: 'Right to match',
  unsold: 'Unsold',
  skipped: 'Skipped',
  cancelled: 'Not completed',
} as const;
