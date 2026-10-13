import { z } from 'zod';
import { DecimalString, IsoTimestamp, RupeesString, Uuid } from './primitives';

/**
 * Reconnect, failover and safe automation (phase 12, ADR-027). A team's
 * automated-bidding limits are private to the team; control changes and
 * automated decisions go to the team stream with plain reason codes.
 */

export const CONTROL_MODES = ['MANUAL', 'FAILOVER', 'AUTO', 'OBSERVE'] as const;
export const ControlModeSchema = z.enum(CONTROL_MODES);
export type ControlMode = z.infer<typeof ControlModeSchema>;

const Role = z.enum(['batter', 'bowler', 'all_rounder', 'wicketkeeper']);

/** The limits a captain (or limits manager) saves for automated bidding. */
export const AutoStrategyInputSchema = z
  .object({
    enabled: z.boolean(),
    /** Named targets in priority order, each with its own ceiling. */
    targetLimits: z
      .array(z.object({ playerId: Uuid, ceilingRupees: RupeesString }).strict())
      .max(40),
    /** A ceiling for any player of a role the squad still needs. */
    roleLimits: z.partialRecord(Role, RupeesString),
    totalAutoCapRupees: RupeesString,
    maxAutoPurchases: z.number().int().min(0).max(25),
    minReserveRupees: RupeesString,
    allowRTM: z.boolean(),
    rtmCeilingRupees: RupeesString.nullable(),
  })
  .strict();
export type AutoStrategyInput = z.infer<typeof AutoStrategyInputSchema>;

export const AutoConfigurePayload = z
  .object({ strategy: AutoStrategyInputSchema, version: DecimalString })
  .strict();
export const AutoConfigureAck = z.object({ strategyVersion: z.string() }).strict();

/** "Resume manual control": fenced by the franchise control epoch the client saw. */
export const AutoTakeoverPayload = z.object({ currentEpoch: DecimalString }).strict();
export const AutoTakeoverAck = z.object({ manual: z.boolean(), newEpoch: z.string() }).strict();

// -------------------------------------------------------------------- events
export const TeamControlChangedPayload = z
  .object({ mode: ControlModeSchema, epoch: z.string(), reasonCode: z.string() })
  .strict();
export const AutoDecisionSchema = z
  .object({
    action: z.enum(['BID', 'PASS', 'RTM_INVOKE', 'RTM_DECLINE', 'MATCH', 'NO_MATCH', 'HOLD']),
    nominationId: Uuid,
    lotNumber: z.number().int(),
    playerName: z.string(),
    amountRupees: RupeesString.nullable(),
  })
  .strict();
export const TeamAutoDecisionPayload = z
  .object({
    mode: ControlModeSchema,
    epoch: z.string(),
    reasonCode: z.string(),
    decision: AutoDecisionSchema,
    ceiling: RupeesString.nullable().optional(),
  })
  .strict();
export const TeamAutoConfiguredPayload = z
  .object({ strategyVersion: z.string(), enabled: z.boolean() })
  .strict();
/** Socket notice: the server restarted after a gap; clocks were paused (recovery pause). */
export const ServerRecoveringPayload = z
  .object({
    reason: z.string(),
    reconnectAfterMs: z.number().int(),
    recoveryGeneration: z.string(),
  })
  .strict();

export const AUTO_EVENT_PAYLOADS = {
  'team.controlChanged': TeamControlChangedPayload,
  'team.autoDecision': TeamAutoDecisionPayload,
  'team.autoConfigured': TeamAutoConfiguredPayload,
  'server.recovering': ServerRecoveringPayload,
} as const;

// ---------------------------------------------------------------------- DTOs
/** DB/realtime §10 StrategyDTO: the team's private automated limits and counters. */
export const StrategyDTOSchema = z
  .object({
    franchiseId: Uuid,
    version: z.string(),
    enabled: z.boolean(),
    targetLimits: z.array(z.object({ playerId: Uuid, ceilingRupees: RupeesString })),
    roleLimits: z.partialRecord(Role, RupeesString),
    priorityOrder: z.array(Uuid),
    totalAutoCapRupees: RupeesString,
    spentAutoRupees: RupeesString,
    maxAutoPurchases: z.number().int(),
    purchasesAuto: z.number().int(),
    minReserveRupees: RupeesString,
    allowRTM: z.boolean(),
    rtmCeilingRupees: RupeesString.nullable(),
    controlEpoch: z.string(),
  })
  .strict();
export type StrategyDTO = z.infer<typeof StrategyDTOSchema>;

/** GET /v1/rooms/:id/franchises/:f/strategy — S26, own team only (others: 404). */
export const AutoViewSchema = z
  .object({
    teamId: Uuid,
    strategy: StrategyDTOSchema.nullable(),
    control: z.object({
      mode: ControlModeSchema,
      epoch: z.string(),
      reasonCode: z.string().nullable(),
      changedAt: IsoTimestamp.nullable(),
      failoverMemberId: Uuid.nullable(),
    }),
    remainingPurseRupees: RupeesString,
    lifecycle: z.string(),
    canConfigure: z.boolean(),
    canTakeover: z.boolean(),
    /** Latest automated decisions, newest first, with their reasons. */
    decisions: z.array(
      TeamAutoDecisionPayload.extend({ at: IsoTimestamp }).omit({ mode: true, epoch: true }),
    ),
    /** Players bought by automated bids. */
    autoPurchases: z.array(
      z.object({
        playerId: Uuid,
        playerName: z.string(),
        priceRupees: RupeesString,
        lotNumber: z.number().int(),
      }),
    ),
  })
  .strict();
export type AutoView = z.infer<typeof AutoViewSchema>;
