import { z } from 'zod';
import { AuctionPlayerSchema, TeamCapabilitiesSchema, TeamRoleSchema } from './auction';
import { IsoTimestamp, RupeesString, Uuid } from './primitives';

/**
 * Team collaboration contracts (phase 11, ADR-026): capability delegation,
 * captain handover by consent, join-code rotation with a friend-only
 * auto-join list, and the private shortlist with advisory votes. Everything
 * here is visible to the team's own approved members only.
 */

/** Roles a captain can give; a second captain is never possible. */
export const DelegatedRoleSchema = TeamRoleSchema.exclude(['captain']);

// ------------------------------------------------------------------ commands
export const TeamPermissionsPayload = z
  .object({ memberId: Uuid, capabilities: TeamCapabilitiesSchema, role: DelegatedRoleSchema })
  .strict();
export const TeamPermissionsAck = z.object({ version: z.string() }).strict();

export const CaptainProposePayload = z.object({ memberId: Uuid }).strict();
export const PendingHandoverSchema = z
  .object({
    handoverId: Uuid,
    fromMemberId: Uuid,
    toMemberId: Uuid,
    expiresAt: IsoTimestamp,
  })
  .strict();
export const CaptainProposeAck = z.object({ pendingHandover: PendingHandoverSchema }).strict();

export const CaptainAcceptPayload = z.object({ handoverId: Uuid }).strict();
export const CaptainAcceptAck = z.object({ captainId: Uuid, epoch: z.string() }).strict();

/** Rotating the code revokes pending code requests; auto-join is for accepted friends only. */
export const InviteRotatePayload = z
  .object({ autoJoinUserIds: z.array(Uuid).max(20).optional() })
  .strict();
export const InviteRotateAck = z.object({ newCode: z.string() }).strict();

export const ShortlistUpsertPayload = z
  .object({
    playerId: Uuid,
    priority: z.number().int().min(0).max(100),
    note: z.string().trim().max(500).nullable().optional(),
    /** A private ceiling: only members allowed to manage limits may set it. */
    maxPrice: RupeesString.nullable().optional(),
  })
  .strict();
export const ShortlistRemovePayload = z.object({ playerId: Uuid }).strict();
export const ShortlistRemoveAck = z.object({ removed: z.boolean() }).strict();

/** +1 recommend, −1 against, 0 withdraws the vote. Advisory only. */
export const ShortlistVotePayload = z
  .object({ playerId: Uuid, value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
  .strict();
export const ShortlistVoteAck = z.object({ recorded: z.boolean() }).strict();

export const VoteTallySchema = z.object({ up: z.number().int(), down: z.number().int() }).strict();

export const ShortlistEntrySchema = z
  .object({
    playerId: Uuid,
    priority: z.number().int(),
    note: z.string().nullable(),
    maxPriceRupees: RupeesString.nullable(),
    proposedBy: z.string().nullable(),
    tally: VoteTallySchema,
  })
  .strict();
export type ShortlistEntry = z.infer<typeof ShortlistEntrySchema>;
export const ShortlistUpsertAck = z.object({ entry: ShortlistEntrySchema }).strict();

// -------------------------------------------------------------------- events
export const TeamPermissionsChangedPayload = z
  .object({
    memberId: Uuid,
    role: TeamRoleSchema,
    capabilities: TeamCapabilitiesSchema,
    version: z.string(),
  })
  .strict();
export const TeamInviteChangedPayload = z
  .object({ expiresAt: IsoTimestamp.nullable(), autoJoinUserIds: z.array(Uuid) })
  .strict();
export const TeamCaptainProposedPayload = PendingHandoverSchema;
export const TeamCaptainChangedPayload = z
  .object({ memberId: Uuid, role: TeamRoleSchema, approved: z.boolean(), epoch: z.string() })
  .strict();
export const TeamShortlistChangedPayload = z
  .object({ entries: z.array(ShortlistEntrySchema) })
  .strict();
export const TeamShortlistVoteChangedPayload = z
  .object({ playerId: Uuid, tally: VoteTallySchema })
  .strict();

export const TEAM_EVENT_PAYLOADS = {
  'team.permissionsChanged': TeamPermissionsChangedPayload,
  'team.inviteChanged': TeamInviteChangedPayload,
  'team.captainProposed': TeamCaptainProposedPayload,
  'team.captainChanged': TeamCaptainChangedPayload,
  'team.shortlistChanged': TeamShortlistChangedPayload,
  'team.shortlistVoteChanged': TeamShortlistVoteChangedPayload,
} as const;

// ---------------------------------------------------------------------- DTOs
export const TeamMemberViewSchema = z
  .object({
    memberId: Uuid,
    displayName: z.string(),
    role: TeamRoleSchema,
    capabilities: TeamCapabilitiesSchema,
    /** Approved before the auction started: counts for this game's medal (rules §11). */
    eligibleAtStart: z.boolean(),
    /** Approved after the start: observer/advisor only, no medal this game. */
    lateJoiner: z.boolean(),
    online: z.boolean(),
  })
  .strict();

/** GET /v1/rooms/:id/team — the viewer's own team, members only. */
export const TeamViewSchema = z
  .object({
    teamId: Uuid,
    franchiseDefinitionId: Uuid,
    name: z.string(),
    shortName: z.string(),
    primaryHex: z.string(),
    secondaryHex: z.string(),
    lifecycle: z.string(),
    myMemberId: Uuid,
    myRole: TeamRoleSchema,
    myCapabilities: TeamCapabilitiesSchema,
    controlEpoch: z.string(),
    members: z.array(TeamMemberViewSchema),
    /** Captain only. */
    requests: z.array(z.object({ requestId: Uuid, memberId: Uuid, displayName: z.string() })),
    /** Captain and inviters only. */
    joinCode: z.string().nullable(),
    /** Captain only: friends who join without a request, and friends who could be added. */
    autoJoin: z
      .array(z.object({ userId: Uuid, displayName: z.string(), enabled: z.boolean() }))
      .nullable(),
    pendingHandover: PendingHandoverSchema.nullable(),
    collaboratorLimit: z.number().int(),
    myAllowedActions: z.array(z.string()),
  })
  .strict();
export type TeamView = z.infer<typeof TeamViewSchema>;

export const ShortlistPlayerSchema = AuctionPlayerSchema.extend({
  /** Where the player stands in the auction: still to come, sold, unsold or retained. */
  status: z.enum(['available', 'retained', 'sold', 'unsold', 'skipped']),
});

/** GET /v1/rooms/:id/franchises/:f/shortlist — own team only (others: 404). */
export const ShortlistViewSchema = z
  .object({
    teamId: Uuid,
    entries: z.array(ShortlistEntrySchema.extend({ myVote: z.number().int() })),
    pool: z.array(ShortlistPlayerSchema),
    canEdit: z.boolean(),
    canSetLimits: z.boolean(),
  })
  .strict();
export type ShortlistView = z.infer<typeof ShortlistViewSchema>;
