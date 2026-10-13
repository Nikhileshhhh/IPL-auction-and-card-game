import { z } from 'zod';
import { AuctionPlayerSchema, RuleSummarySchema } from './auction';
import { DecimalString, IsoTimestamp, RupeesString, Uuid } from './primitives';
import { VoteTallySchema } from './teams';

/**
 * Live auction contracts (phase 10, ADR-025): lots, accepted bids, the RTM
 * stages, passes, pauses and the end. Money is integer rupees as strings.
 */

export const LOT_STAGES = ['bidding', 'rtm_intent', 'rtm_raise', 'rtm_match', 'settled'] as const;
export const LotStageSchema = z.enum(LOT_STAGES);
export type LotStage = z.infer<typeof LotStageSchema>;

export const LOT_STATUSES = ['open', 'sold', 'unsold', 'skipped', 'cancelled'] as const;
export const AUCTION_END_REASONS = ['pool_complete', 'no_buyers', 'time_limit', 'vote'] as const;

/** Why this viewer's team cannot bid right now (shown beside the bid button). */
export const BID_BLOCKS = [
  'NOT_ON_TEAM',
  'NO_BID_RIGHT',
  'ALREADY_LEADING',
  'SQUAD_FULL',
  'OVERSEAS_LIMIT',
  'BUDGET_RESERVE',
  'XI_INFEASIBLE',
  'NOT_BIDDING',
  /** The team is automatic or observing: someone resumes manual control first. */
  'TEAM_NOT_MANUAL',
] as const;
export const BidBlockSchema = z.enum(BID_BLOCKS);

// ------------------------------------------------------------------ commands
export const BidPayload = z
  .object({ nominationId: Uuid, nominationVersion: DecimalString, amountRupees: RupeesString })
  .strict();
export const BidAck = z
  .object({
    commandId: Uuid,
    nominationVersion: z.string(),
    acceptedAmountRupees: RupeesString,
    deadline: IsoTimestamp,
    stateVersion: z.string(),
  })
  .strict();

export const RtmIntentPayload = z.object({ nominationId: Uuid, invoke: z.boolean() }).strict();
export const RtmIntentAck = z.object({ stage: LotStageSchema }).strict();

/** The high bidder's one final offer; an amount equal to the standing bid holds. */
export const RtmFinalOfferPayload = z
  .object({ nominationId: Uuid, amountRupees: RupeesString })
  .strict();
export const RtmFinalOfferAck = z.object({ stage: LotStageSchema }).strict();

export const RtmMatchPayload = z.object({ nominationId: Uuid, match: z.boolean() }).strict();
export const RtmMatchAck = z
  .object({ acquisition: z.enum(['rtm', 'auction']), status: z.enum(LOT_STATUSES) })
  .strict();

export const PausePayload = z.object({}).strict();
export const PauseAck = z.object({ boundaryPause: z.boolean() }).strict();
export const ResumePayload = z.object({}).strict();
export const ResumeAck = z.object({ nextState: z.string() }).strict();
export const SkipPayload = z.object({ nominationId: Uuid }).strict();
export const SkipAck = z.object({ skipped: z.boolean() }).strict();

// -------------------------------------------------------------------- events
export const PublicPurseSchema = z
  .object({
    franchiseId: Uuid,
    remainingPurseRupees: RupeesString,
    rosterCount: z.number().int(),
    overseasCount: z.number().int(),
  })
  .strict();

export const LotOpenedPayload = z
  .object({
    playerPublicDTO: AuctionPlayerSchema,
    basePrice: RupeesString,
    nominationId: Uuid,
    bidVersion: z.string(),
    deadline: IsoTimestamp,
    lotNumber: z.number().int(),
    pass: z.number().int(),
  })
  .strict();
export const BidAcceptedPayload = z
  .object({
    nominationId: Uuid,
    franchiseId: Uuid,
    amountRupees: RupeesString,
    nominationVersion: z.string(),
    deadline: IsoTimestamp,
    actorType: z.enum(['human', 'auto']),
  })
  .strict();
export const TimerChangedPayload = z
  .object({ nominationId: Uuid, deadline: IsoTimestamp, generation: z.string() })
  .strict();
export const PlayerSoldPayload = z
  .object({
    nominationId: Uuid,
    playerId: Uuid,
    outcome: z.enum(['sold', 'rtm']),
    franchiseId: Uuid,
    price: RupeesString,
    publicPursesAndCounts: z.array(PublicPurseSchema),
  })
  .strict();
export const PlayerUnsoldPayload = z
  .object({
    nominationId: Uuid,
    playerId: Uuid,
    outcome: z.literal('unsold'),
    publicPursesAndCounts: z.array(PublicPurseSchema),
  })
  .strict();
export const PlayerSkippedPayload = z
  .object({ nominationId: Uuid, playerId: Uuid, outcome: z.literal('skipped') })
  .strict();
export const RtmStageChangedPayload = z
  .object({
    nominationId: Uuid,
    stage: LotStageSchema,
    eligibleFranchiseId: Uuid,
    standingBid: RupeesString,
    deadline: IsoTimestamp,
  })
  .strict();
export const PauseChangedPayload = z
  .object({
    reason: z.enum(['host', 'timeout']),
    phase: z.string(),
    deadline: IsoTimestamp.optional(),
    generation: z.string(),
  })
  .strict();

/** Live auction event payload schemas by type (checked against events.json). */
export const AUCTION_LIVE_EVENT_PAYLOADS = {
  'auction.playerNominated': LotOpenedPayload,
  'auction.biddingOpened': LotOpenedPayload,
  'auction.bidAccepted': BidAcceptedPayload,
  'auction.timerChanged': TimerChangedPayload,
  'auction.playerSold': PlayerSoldPayload,
  'auction.playerUnsold': PlayerUnsoldPayload,
  'auction.playerSkipped': PlayerSkippedPayload,
  'auction.rtmStageChanged': RtmStageChangedPayload,
  'auction.paused': PauseChangedPayload,
  'auction.resumed': PauseChangedPayload,
} as const;

// ------------------------------------------------------------------ snapshot
export const NominationSchema = z
  .object({
    id: Uuid,
    lotNumber: z.number().int(),
    pass: z.number().int(),
    player: AuctionPlayerSchema,
    stage: LotStageSchema,
    status: z.enum(LOT_STATUSES),
    basePriceRupees: RupeesString,
    highBidRupees: RupeesString.nullable(),
    highFranchiseId: Uuid.nullable(),
    bidVersion: z.string(),
    deadline: IsoTimestamp.nullable(),
    rtmFranchiseId: Uuid.nullable(),
    rtmFinalBidRupees: RupeesString.nullable(),
    publicFranchisePursesAndCounts: z.array(PublicPurseSchema),
    /** The exact amount this viewer's team may bid next, when it may. */
    ownLegalNextBidRupees: RupeesString.nullable(),
    ownRejectionReason: BidBlockSchema.nullable(),
    /** This player on the viewer's own team shortlist (private; never another team's). */
    myTarget: z
      .object({
        priority: z.number().int(),
        maxPriceRupees: RupeesString.nullable(),
        note: z.string().nullable(),
        tally: VoteTallySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Nomination = z.infer<typeof NominationSchema>;

export const LiveTeamSchema = z
  .object({
    teamId: Uuid,
    franchiseDefinitionId: Uuid,
    name: z.string(),
    shortName: z.string(),
    primaryHex: z.string(),
    secondaryHex: z.string(),
    captainName: z.string(),
    remainingPurseRupees: RupeesString,
    rosterCount: z.number().int(),
    overseasCount: z.number().int(),
    rtmCards: z.object({
      total: z.number().int(),
      capped: z.number().int(),
      uncapped: z.number().int(),
    }),
    /** Who is bidding for this team right now (public status, never its limits). */
    control: z.enum(['MANUAL', 'FAILOVER', 'AUTO', 'OBSERVE']),
    /** Most this team may commit for its next player (purse minus the minimum-squad reserve). */
    maxBidRupees: RupeesString.nullable(),
  })
  .strict();
export type LiveTeam = z.infer<typeof LiveTeamSchema>;

export const LotResultSchema = z
  .object({
    nominationId: Uuid,
    lotNumber: z.number().int(),
    pass: z.number().int(),
    playerId: Uuid,
    name: z.string(),
    outcome: z.enum(['sold', 'rtm', 'unsold', 'skipped', 'cancelled']),
    teamId: Uuid.nullable(),
    priceRupees: RupeesString.nullable(),
  })
  .strict();

export const LotBidSchema = z
  .object({
    teamId: Uuid,
    amountRupees: RupeesString,
    kind: z.enum(['normal', 'rtm_raise', 'rtm_match']),
    bidVersion: z.string(),
    at: IsoTimestamp,
  })
  .strict();

export const AuctionLiveSnapshotSchema = z
  .object({
    kind: z.literal('auction-live'),
    status: z.enum(['running', 'finished']),
    finishedReason: z.enum(AUCTION_END_REASONS).nullable(),
    rules: RuleSummarySchema,
    pass: z.number().int(),
    poolProgress: z.object({
      total: z.number().int(),
      sold: z.number().int(),
      unsold: z.number().int(),
      remaining: z.number().int(),
    }),
    lot: NominationSchema.nullable(),
    /** When the next lot opens (the gap between lots), unless paused. */
    nextLotAt: IsoTimestamp.nullable(),
    pausedUntil: IsoTimestamp.nullable(),
    pausesLeft: z.number().int(),
    teams: z.array(LiveTeamSchema),
    myTeamId: Uuid.nullable(),
    myCapabilities: z.object({ bid: z.boolean(), rtm: z.boolean() }),
    history: z.array(LotResultSchema),
    lotBids: z.array(LotBidSchema),
    myAllowedActions: z.array(z.string()),
    seedCommitment: z.string(),
    /** Disclosed when the auction ends, to verify the lot order. */
    auditSeed: z.string().nullable(),
  })
  .strict();
export type AuctionLiveSnapshot = z.infer<typeof AuctionLiveSnapshotSchema>;
