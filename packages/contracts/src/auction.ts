import { z } from 'zod';
import { RupeesString, Uuid } from './primitives';

/**
 * Auction setup contracts (phase 09, ADR-024): franchise claims, team join
 * requests, retentions and the setup snapshot. Money is integer rupees as
 * decimal strings.
 */

export const AUCTION_SETUP_PHASES = ['FRANCHISE_SELECTION', 'RETENTION', 'AUCTION_LOBBY'] as const;
export const AuctionSetupPhaseSchema = z.enum(AUCTION_SETUP_PHASES);
export type AuctionSetupPhase = z.infer<typeof AuctionSetupPhaseSchema>;

export const TEAM_ROLES = ['captain', 'cocaptain', 'bidder', 'advisor'] as const;
export const TeamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const CappedStatusSchema = z.enum(['capped', 'uncapped', 'unknown']);
export const PoolRoleSchema = z.enum(['batter', 'bowler', 'all_rounder', 'wicketkeeper']);

/** Team capabilities (rules §9). The full editor arrives in phase 11. */
export const TeamCapabilitiesSchema = z
  .object({
    bid: z.boolean(),
    invite: z.boolean(),
    strategy: z.boolean(),
    retainPropose: z.boolean(),
    rtm: z.boolean(),
    manageLimits: z.boolean(),
  })
  .strict();
export type TeamCapabilities = z.infer<typeof TeamCapabilitiesSchema>;

/** Default for an approved collaborator: an advisor who can view and recommend only. */
export const ADVISOR_CAPABILITIES: TeamCapabilities = {
  bid: false,
  invite: false,
  strategy: true,
  retainPropose: false,
  rtm: false,
  manageLimits: false,
};

/** A pool player as shown on setup screens; the portrait is required (ADR-017). */
export const AuctionPlayerSchema = z
  .object({
    playerId: Uuid,
    name: z.string(),
    role: PoolRoleSchema,
    country: z.string().nullable(),
    overseas: z.boolean(),
    cappedStatus: CappedStatusSchema,
    basePriceRupees: RupeesString,
    /** "registered" (a real auction listing) or "not_registered" (owner rule) or "demo". */
    priceSource: z.enum(['registered', 'not_registered', 'demo']),
    currentSalaryRupees: RupeesString.nullable(),
    previousFranchiseId: Uuid.nullable(),
    setLabel: z.string(),
    portraitUrl: z.string(),
    portraitAlt: z.string(),
  })
  .strict();
export type AuctionPlayer = z.infer<typeof AuctionPlayerSchema>;

// ------------------------------------------------------------------ commands
export const ClaimFranchisePayload = z.object({ franchiseDefinitionId: Uuid }).strict();
export const ClaimFranchiseAck = z.object({ franchiseId: Uuid }).strict();

export const RequestJoinPayload = z
  .object({ franchiseCode: z.string().trim().min(8).max(20) })
  .strict();
export const RequestJoinAck = z.object({ requestId: Uuid, pending: z.boolean() }).strict();

export const DecideJoinPayload = z
  .object({
    requestId: Uuid,
    approve: z.boolean(),
    role: TeamRoleSchema.exclude(['captain']).default('advisor'),
    capabilities: TeamCapabilitiesSchema.default(ADVISOR_CAPABILITIES),
  })
  .strict();
export const DecideJoinAck = z.object({ decision: z.enum(['approved', 'rejected']) }).strict();

export const RetentionPickSchema = z
  .object({ playerId: Uuid, salaryRupees: RupeesString })
  .strict();
export const RetentionProposePayload = z
  .object({ playersAndAllocations: z.array(RetentionPickSchema).max(6) })
  .strict();
export const RetentionProposeAck = z.object({ packageVersion: z.string() }).strict();

export const RetentionLockPayload = z.object({ packageId: Uuid, version: z.string() }).strict();
export const RetentionLockAck = z
  .object({ retained: z.array(Uuid), cost: RupeesString, purse: RupeesString })
  .strict();

export const CloseFranchiseSelectionPayload = z.object({}).strict();
export const CloseFranchiseSelectionAck = z.object({ phase: AuctionSetupPhaseSchema }).strict();

// -------------------------------------------------------------------- events
export const TeamCreatedPayload = z
  .object({ franchiseId: Uuid, franchiseDefinitionId: Uuid, captainMemberId: Uuid })
  .strict();
export const TeamJoinRequestedPayload = z
  .object({ requestId: Uuid, memberId: Uuid, displayName: z.string() })
  .strict();
export const TeamMembershipChangedPayload = z
  .object({
    memberId: Uuid,
    role: TeamRoleSchema.nullable(),
    approved: z.boolean(),
    epoch: z.string(),
  })
  .strict();
export const RetentionLinePayload = z
  .object({
    playerId: Uuid,
    salaryRupees: RupeesString,
    slabFloorRupees: RupeesString,
    allocatedRupees: RupeesString,
    capped: z.boolean(),
    overseas: z.boolean(),
  })
  .strict();
export const TeamRetentionProposedPayload = z
  .object({
    packageId: Uuid,
    version: z.string(),
    playersAndAllocations: z.array(RetentionLinePayload),
    totalCharge: RupeesString,
  })
  .strict();
export const RetentionLockedPayload = z
  .object({
    franchiseId: Uuid,
    retainedPlayerIds: z.array(Uuid),
    retentionCharge: RupeesString,
    remainingPurse: RupeesString,
  })
  .strict();
export const SetupPhaseChangedPayload = z.object({ phase: AuctionSetupPhaseSchema }).strict();

/** Auction setup event payload schemas by type (checked against events.json). */
export const AUCTION_EVENT_PAYLOADS = {
  'team.created': TeamCreatedPayload,
  'team.joinRequested': TeamJoinRequestedPayload,
  'team.membershipChanged': TeamMembershipChangedPayload,
  'team.retentionProposed': TeamRetentionProposedPayload,
  'auction.retentionLocked': RetentionLockedPayload,
  'auction.setupPhaseChanged': SetupPhaseChangedPayload,
} as const;

// ------------------------------------------------------------------ snapshot
export const RuleSummarySchema = z
  .object({
    name: z.string(),
    label: z.string(),
    season: z.number().int(),
    purseRupees: RupeesString,
    squadMin: z.number().int(),
    squadMax: z.number().int(),
    overseasMax: z.number().int(),
    overseasInXI: z.number().int(),
    retentionMax: z.number().int(),
    retentionCappedMax: z.number().int(),
    retentionUncappedMax: z.number().int(),
    cappedSlabsRupees: z.array(RupeesString),
    uncappedFloorRupees: RupeesString,
    basePriceBandsRupees: z.array(RupeesString),
    uncappedAfterYears: z.number().int(),
    provenance: z.record(z.string(), z.enum(['official', 'reported', 'simulator'])),
    sources: z.array(z.object({ title: z.string(), url: z.string(), published: z.string() })),
  })
  .strict();
export type RuleSummary = z.infer<typeof RuleSummarySchema>;

/** Public team row: anyone in the room sees purses and counts (public purse projection). */
export const PublicTeamSchema = z
  .object({
    franchiseDefinitionId: Uuid,
    name: z.string(),
    shortName: z.string(),
    primaryHex: z.string(),
    secondaryHex: z.string(),
    teamId: Uuid.nullable(),
    captain: z.object({ memberId: Uuid, displayName: z.string() }).nullable(),
    memberCount: z.number().int(),
    retention: z.enum(['none', 'draft', 'locked']),
    retainedCount: z.number().int(),
    retentionChargeRupees: RupeesString,
    initialPurseRupees: RupeesString,
    remainingPurseRupees: RupeesString,
    rosterCount: z.number().int(),
    overseasCount: z.number().int(),
    /** Players from this franchise's 2026 squad in the pool (retention/RTM rights). */
    previousSquadCount: z.number().int(),
    ready: z.boolean(),
  })
  .strict();
export type PublicTeam = z.infer<typeof PublicTeamSchema>;

export const RetentionPackageSchema = z
  .object({
    packageId: Uuid,
    version: z.string(),
    status: z.enum(['draft', 'locked']),
    lines: z.array(RetentionLinePayload),
    cappedFloorsRupees: RupeesString,
    cappedNegotiatedRupees: RupeesString,
    totalChargeRupees: RupeesString,
    remainingPurseRupees: RupeesString,
    rtmCards: z.object({
      total: z.number().int(),
      capped: z.number().int(),
      uncapped: z.number().int(),
    }),
  })
  .strict();

export const MyTeamSchema = z
  .object({
    teamId: Uuid,
    franchiseDefinitionId: Uuid,
    role: TeamRoleSchema,
    capabilities: TeamCapabilitiesSchema,
    /** Shown to the captain and inviters only. */
    joinCode: z.string().nullable(),
    members: z.array(z.object({ memberId: Uuid, displayName: z.string(), role: TeamRoleSchema })),
    requests: z.array(z.object({ requestId: Uuid, memberId: Uuid, displayName: z.string() })),
    package: RetentionPackageSchema.nullable(),
    /** Previous squad players this team may retain, in auction set order. */
    eligible: z.array(AuctionPlayerSchema),
  })
  .strict();
export type MyTeam = z.infer<typeof MyTeamSchema>;

export const AuctionSetupSnapshotSchema = z
  .object({
    kind: z.literal('auction-setup'),
    phase: AuctionSetupPhaseSchema,
    format: z.enum(['fresh', 'retention']),
    rules: RuleSummarySchema,
    rulesHash: z.string(),
    dataKind: z.enum(['demo', 'factual']),
    franchiseLimit: z.number().int(),
    collaboratorLimit: z.number().int(),
    teams: z.array(PublicTeamSchema),
    pool: z.object({
      total: z.number().int(),
      available: z.number().int(),
      lowestBasePriceRupees: RupeesString,
    }),
    myTeam: MyTeamSchema.nullable(),
    myRequest: z.object({ requestId: Uuid, franchiseDefinitionId: Uuid }).nullable(),
    myAllowedActions: z.array(z.string()),
  })
  .strict();
export type AuctionSetupSnapshot = z.infer<typeof AuctionSetupSnapshotSchema>;

export const SquadDTOSchema = z
  .object({
    franchiseId: Uuid,
    acquisitions: z.array(
      z.object({
        player: AuctionPlayerSchema,
        kind: z.enum(['retention', 'auction', 'rtm']),
        costRupees: RupeesString,
      }),
    ),
    remainingPurseRupees: RupeesString,
    reserveRupees: RupeesString,
    overseasCount: z.number().int(),
    rosterCount: z.number().int(),
    deficits: z.array(z.string()),
    /** The best legal XI so far (phase 14 evaluator). */
    provisionalXI: z.array(Uuid).optional(),
  })
  .strict();
export type SquadDTO = z.infer<typeof SquadDTOSchema>;
