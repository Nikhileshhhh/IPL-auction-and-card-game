import { z } from 'zod';
import { DecimalString, IsoTimestamp, Uuid } from './primitives';

/**
 * Outbound event types (DB/realtime §8.3). Must match `schema/events.json`.
 */
export const EVENT_TYPES = [
  'room.snapshot',
  'room.memberJoined',
  'room.memberLeft',
  'room.memberRemoved',
  'room.settingsChanged',
  'room.readinessChanged',
  'room.hostTransferred',
  'room.hostHandoverProposed',
  'game.started',
  'card.roundOpened',
  'card.comparisonResolved',
  'card.potChanged',
  'card.playerEliminated',
  'team.created',
  'team.joinRequested',
  'team.membershipChanged',
  'team.permissionsChanged',
  'team.inviteChanged',
  'team.captainProposed',
  'team.captainChanged',
  'team.controlChanged',
  'team.autoDecision',
  'team.autoConfigured',
  'team.shortlistChanged',
  'team.shortlistVoteChanged',
  'team.retentionProposed',
  'auction.retentionLocked',
  'auction.setupPhaseChanged',
  'auction.playerNominated',
  'auction.biddingOpened',
  'auction.bidAccepted',
  'auction.timerChanged',
  'auction.playerSold',
  'auction.playerUnsold',
  'auction.playerSkipped',
  'auction.rtmStageChanged',
  'auction.paused',
  'auction.resumed',
  'presence.changed',
  'member.controlChanged',
  'vote.started',
  'vote.recorded',
  'vote.resolved',
  'chat.message',
  'chat.removed',
  'chat.muted',
  'game.finalizing',
  'game.evaluationProgress',
  'game.completed',
  'room.expiring',
  'room.closed',
  'auth.revoked',
  'control.revoked',
  'server.recovering',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EventTypeSchema = z.enum(EVENT_TYPES);

export const AUDIENCE_KINDS = ['public', 'team', 'member'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

export const EventEnvelopeSchema = z
  .object({
    eventId: Uuid,
    schemaVersion: z.number().int().positive(),
    type: EventTypeSchema,
    streamId: Uuid,
    seq: DecimalString,
    roomStateVersion: DecimalString,
    occurredAt: IsoTimestamp,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** Replay bounds before a fresh snapshot is required (DB/realtime §3.1). */
export const REPLAY_MAX_EVENTS = 500;
export const REPLAY_MAX_BYTES = 256 * 1024;
