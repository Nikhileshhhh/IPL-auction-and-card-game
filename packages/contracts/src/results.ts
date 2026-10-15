import { z } from 'zod';
import { IsoTimestamp, Uuid } from './primitives';

/**
 * End-game voting, finalization and temporary results (rules §10, §12, §13;
 * DB/realtime §7, §8, §10; ADR-029). The server alone computes thresholds,
 * tallies, scores, ranks and medals; clients only render them.
 */

// ------------------------------------------------------------------ voting

export const VOTE_CHOICES = ['end', 'continue'] as const;
export const VoteChoiceSchema = z.enum(VOTE_CHOICES);
export type VoteChoice = z.infer<typeof VoteChoiceSchema>;

export const VoteStartPayload = z.object({}).strict();
export const VoteStartAck = z
  .object({ voteId: Uuid, expiresAt: IsoTimestamp, threshold: z.number().int().min(1) })
  .strict();

export const VoteCastPayload = z.object({ voteId: Uuid, choice: VoteChoiceSchema }).strict();
export const VoteReceiptSchema = z
  .object({ voteId: Uuid, choice: VoteChoiceSchema, castAt: IsoTimestamp })
  .strict();
export const VoteCastAck = z.object({ receipt: VoteReceiptSchema }).strict();

/** DB/realtime §10 VoteDTO: no live tally before resolution. */
export const VoteDTOSchema = z
  .object({
    id: Uuid,
    startsAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    electorateCount: z.number().int().min(1),
    threshold: z.number().int().min(1),
    status: z.enum(['open', 'passed', 'failed']),
    canVote: z.boolean(),
    myRecordedChoice: VoteChoiceSchema.nullable(),
    representativeMemberId: Uuid.nullable(),
    savedPhaseLabel: z.string(),
  })
  .strict();
export type VoteDTO = z.infer<typeof VoteDTOSchema>;

export const VoteStartedPayload = z
  .object({
    voteId: Uuid,
    startsAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    electorateCount: z.number().int().min(1),
    threshold: z.number().int().min(1),
    /** Public event: null — each viewer's right to vote is in their snapshot. */
    canVote: z.boolean().nullable(),
  })
  .strict();
export const VoteRecordedPayload = z
  .object({ voteId: Uuid, choice: VoteChoiceSchema, receiptId: z.string() })
  .strict();
export const VoteResolvedPayload = z
  .object({
    voteId: Uuid,
    yes: z.number().int().min(0),
    no: z.number().int().min(0),
    abstain: z.number().int().min(0),
    passed: z.boolean(),
    resumedPhase: z.string().nullable(),
    deadline: IsoTimestamp.nullable(),
  })
  .strict();

// ----------------------------------------------------------------- results

export const CompletionReasonSchema = z.enum([
  'natural',
  'cycle',
  'contest_cap',
  'time_limit',
  'vote',
  'pool_complete',
  'no_buyers',
]);
export type CompletionReason = z.infer<typeof CompletionReasonSchema>;

export const MedalSchema = z.enum(['gold', 'silver', 'bronze']);

export const QualificationStatusSchema = z.enum(['qualifying', 'practice', 'no_champion']);

export const ResultMemberSchema = z
  .object({
    memberId: Uuid,
    displayName: z.string(),
    role: z.string(),
    /** Receives this result's medal (eligible at start and present ≥ 50 %). */
    credited: z.boolean(),
    reason: z.enum(['late_join', 'not_ready', 'low_presence']).nullable(),
  })
  .strict();

export const ResultRankingSchema = z
  .object({
    /** A room member (cards) or a franchise (auction). */
    competitorId: Uuid,
    displayName: z.string(),
    rank: z.number().int().min(1),
    medalPlacement: z.number().int().min(1).max(3).nullable(),
    medal: MedalSchema.nullable(),
    eligible: z.boolean(),
    /** Short plain-text explanation ("12 cards · 9 contests won", "Score 71.42"). */
    summary: z.string(),
    members: z.array(ResultMemberSchema).nullable(),
  })
  .strict();

export const ScoreComponentsSchema = z
  .object({
    batting: z.number(),
    bowling: z.number(),
    allRound: z.number(),
    composition: z.number(),
    depth: z.number(),
    value: z.number(),
  })
  .strict();

export const XiPlayerSchema = z
  .object({
    playerId: Uuid,
    name: z.string(),
    role: z.enum(['batter', 'bowler', 'all_rounder', 'wicketkeeper']),
    overseas: z.boolean(),
    portraitUrl: z.string(),
  })
  .strict();

export const ScoreReportSchema = z
  .object({
    franchiseId: Uuid,
    legal: z.boolean(),
    /** 0–100, two decimals, display only (ranking used the exact rational). */
    total: z.number().nullable(),
    components: ScoreComponentsSchema.nullable(),
    xi: z.array(XiPlayerSchema),
    squadSize: z.number().int().min(0),
    deficits: z.array(z.string()),
  })
  .strict();

export const OwnCreditSchema = z
  .object({
    rank: z.number().int().min(1),
    medal: MedalSchema.nullable(),
    scope: z.enum(['personal', 'franchise']),
    creditedRole: z.string(),
    qualifies: z.boolean(),
  })
  .strict();

export const SeedAuditSchema = z
  .object({
    seed: z.string().regex(/^[0-9a-f]{64}$/),
    commitment: z.string(),
    rngVersion: z.string(),
  })
  .strict();

/** DB/realtime §10 ResultDTO, filtered to the viewer (own credits only). */
export const ResultDTOSchema = z
  .object({
    gameType: z.enum(['card', 'auction']),
    completionReason: CompletionReasonSchema,
    qualificationStatus: QualificationStatusSchema,
    rankings: z.array(ResultRankingSchema),
    ownCredits: z.array(OwnCreditSchema),
    publicScoreReports: z.array(ScoreReportSchema).nullable(),
    ownPrivateReport: z.null(),
    rulesVersion: z.string(),
    dataVersion: z.string(),
    evaluatorVersion: z.string().nullable(),
    resultsExpiresAt: IsoTimestamp,
    seedAudit: SeedAuditSchema.nullable(),
  })
  .strict();
export type ResultDTO = z.infer<typeof ResultDTOSchema>;

/** Snapshot pointer: evaluation progress, then the results until they expire. */
export const ResultStatusSchema = z
  .object({
    status: z.enum(['finalizing', 'ready', 'expired']),
    progressPercent: z.number().int().min(0).max(100),
    resultsExpiresAt: IsoTimestamp.nullable(),
  })
  .strict();
export type ResultStatus = z.infer<typeof ResultStatusSchema>;

export const EvaluationProgressPayload = z
  .object({ stage: z.literal('evaluating'), progressPercent: z.number().int().min(0).max(100) })
  .strict();

export const VOTE_EVENT_PAYLOADS = {
  'vote.started': VoteStartedPayload,
  'vote.recorded': VoteRecordedPayload,
  'vote.resolved': VoteResolvedPayload,
  'game.evaluationProgress': EvaluationProgressPayload,
} as const;
