import { z } from 'zod';
import { CardMetricSchema, PublicCardSchema, RATING_MAX } from './catalog';
import { IsoTimestamp, Uuid } from './primitives';

/** Card match payloads (DB spec §8.2–§8.3, §10). Ratings on the wire are 0–100. */

export const SelectCategoryPayload = z
  .object({ comparisonId: Uuid, metric: CardMetricSchema })
  .strict();
export type SelectCategoryPayloadDTO = z.infer<typeof SelectCategoryPayload>;

export const RevealAcknowledgedPayload = z.object({ comparisonId: Uuid }).strict();

/** A dealt card currently visible to everyone (revealed or in the pot). */
export const ArenaCardSchema = PublicCardSchema.extend({ instanceId: Uuid });
export type ArenaCardDTO = z.infer<typeof ArenaCardSchema>;

export const RevealedCardSchema = z.object({ memberId: Uuid, card: ArenaCardSchema }).strict();

/** A card in the pot, with the comparison it was contributed in (pot history, S11). */
export const PotCardSchema = z
  .object({ memberId: Uuid, card: ArenaCardSchema, comparisonIndex: z.number().int().min(0) })
  .strict();

export const CardSeatSchema = z
  .object({
    memberId: Uuid,
    seatOrder: z.number().int().min(0).max(7),
    deckCount: z.number().int().min(0),
    eliminationOrder: z.number().int().min(1).nullable(),
    contestsWon: z.number().int().min(0),
  })
  .strict();

export const FINISH_REASONS = ['natural', 'cycle', 'contest_cap', 'time_limit', 'vote'] as const;
/** Ends that wait for the current chain to settle (rules §6.2). */
export const PENDING_FINISH = ['time_limit', 'vote'] as const;

/** How an exhausted or capped tie was settled (rules §6 fallback). */
export const FallbackDetailSchema = z
  .object({
    sums: z.array(z.object({ memberId: Uuid, sum: z.number().int().min(0) }).strict()),
    byPermutation: z.boolean(),
    rotatedOrder: z.array(Uuid),
  })
  .strict();
export const CardResultSchema = z
  .object({
    reason: z.enum(FINISH_REASONS),
    standings: z.array(Uuid).min(2).max(8),
  })
  .strict();

export const LastComparisonSchema = z
  .object({
    comparisonId: Uuid,
    metric: CardMetricSchema,
    byTimeout: z.boolean(),
    submittedValues: z.array(
      z.object({ memberId: Uuid, value: z.number().int().min(0).max(RATING_MAX) }).strict(),
    ),
    winnerId: Uuid.nullable(),
    tiedSeats: z.array(Uuid),
    reason: z.string(),
    /** Present when the fallback or the tie cap settled the pot. */
    fallback: FallbackDetailSchema.nullable(),
  })
  .strict();

/**
 * Per-viewer card snapshot. Other players' deck order and the seed (until
 * `auditSeed` after completion) are never included; the viewer's own deck is
 * (product owner, ADR-021 §5a).
 */
export const PermittedCardSnapshotSchema = z
  .object({
    totalCards: z.number().int().min(8).max(240),
    seats: z.array(CardSeatSchema).min(2).max(8),
    /** Spec name (DB §10); the same counts as `seats[].deckCount`. */
    deckCountsBySeat: z.record(Uuid, z.number().int().min(0)),
    comparisonId: Uuid.nullable(),
    comparisonIndex: z.number().int().min(-1),
    chainIndex: z.number().int().min(-1),
    selectorSeat: Uuid.nullable(),
    eligibleSeats: z.array(Uuid),
    tiedSeats: z.array(Uuid),
    isTie: z.boolean(),
    visibleCards: z.array(RevealedCardSchema),
    potCount: z.number().int().min(0),
    /** Pot history in contribution order (comparison, then seat). */
    contributions: z.array(PotCardSchema),
    /** The chain's original selector (S11 marker). */
    chainSelector: Uuid.nullable(),
    /** Tie comparisons so far in this chain, and the cap before the fallback decides. */
    tieCount: z.number().int().min(0),
    tieCap: z.number().int().min(4).max(30),
    /** Players still in the match who sit out the current tie comparison. */
    waitingSeats: z.array(Uuid),
    /**
     * The viewer's own deck in play order (front first; won cards join the
     * back). Only the owner ever receives it; everyone else sees counts.
     */
    myDeck: z.array(ArenaCardSchema),
    allowedMetrics: z.array(CardMetricSchema),
    /** Category of the most recently decided comparison. */
    metric: CardMetricSchema.nullable(),
    deadline: IsoTimestamp.nullable(),
    myAllowedActions: z.array(z.enum(['card.selectCategory', 'card.revealAcknowledged'])),
    seedCommitment: z.string().regex(/^[0-9a-f]{64}$/),
    rngVersion: z.string(),
    /** An end requested mid-chain: the match finishes when this chain settles. */
    finishPending: z.enum(PENDING_FINISH).nullable(),
    completedContests: z.number().int().min(0),
    lastComparison: LastComparisonSchema.nullable(),
    result: CardResultSchema.nullable(),
    auditSeed: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
  })
  .strict();
export type PermittedCardSnapshotDTO = z.infer<typeof PermittedCardSnapshotSchema>;

// ------------------------------------------------------------------ events

export const GameStartedPayload = z
  .object({
    stateVersion: z.string(),
    seedCommitment: z.string(),
    dataVersion: Uuid,
    rulesHash: z.string(),
  })
  .strict();

export const RoundOpenedPayload = z
  .object({
    comparisonId: Uuid,
    comparisonIndex: z.number().int().min(0),
    chainIndex: z.number().int().min(0),
    eligibleSeats: z.array(Uuid),
    selector: Uuid,
    visibleCards: z.array(RevealedCardSchema),
    allowedMetrics: z.array(CardMetricSchema),
    deadline: IsoTimestamp,
    potCount: z.number().int().min(0),
    tie: z.boolean(),
  })
  .strict();

export const ComparisonResolvedPayload = LastComparisonSchema;

export const PotChangedPayload = z
  .object({
    potCount: z.number().int().min(0),
    awardedTo: Uuid.nullable().optional(),
    awardedCount: z.number().int().min(0),
    deckCounts: z.record(z.string(), z.number().int().min(0)),
  })
  .strict();

export const PlayerEliminatedPayload = z
  .object({
    memberId: Uuid,
    eliminationOrder: z.number().int().min(1),
    reason: z.literal('NO_CARDS'),
  })
  .strict();

/** Medals and the results TTL arrive with phases 14–15; until then they are `deferred`/null. */
/** `game.finalizing`: phase 08 uses stage `finish_pending` (an end waits for the chain). */
export const FinalizingPayload = z
  .object({
    /** finish_pending: a card end waits for the chain; evaluation_pending: an auction ended (phase 14 scores it). */
    stage: z.enum(['finish_pending', 'evaluation_pending']),
    progressPercent: z.number().int().min(0).max(100),
    reason: z.enum([...PENDING_FINISH, 'pool_complete', 'no_buyers']),
    deadline: IsoTimestamp.nullable(),
  })
  .strict();

export const GameCompletedPayload = z
  .object({
    publicResult: CardResultSchema,
    medalStatus: z.enum(['deferred', 'pending', 'awarded', 'none']),
    resultsExpiresAt: IsoTimestamp.nullable(),
    auditSeed: z.string().regex(/^[0-9a-f]{64}$/),
    rngVersion: z.string(),
  })
  .strict();

export const SelectCategoryAck = z
  .object({ comparisonId: Uuid, stateVersion: z.string() })
  .strict();
export const RevealAcknowledgedAck = z.object({ accepted: z.literal(true) }).strict();

/** Card event payload schemas by event type (checked against events.json). */
export const CARD_EVENT_PAYLOADS = {
  'game.started': GameStartedPayload,
  'card.roundOpened': RoundOpenedPayload,
  'card.comparisonResolved': ComparisonResolvedPayload,
  'card.potChanged': PotChangedPayload,
  'card.playerEliminated': PlayerEliminatedPayload,
  'game.finalizing': FinalizingPayload,
  'game.completed': GameCompletedPayload,
} as const;
