import { z } from 'zod';
import { DecimalString, Uuid } from './primitives';

/**
 * Allowlisted gameplay/team/vote/chat command types (DB/realtime §8.2).
 * The socket dispatcher is an allowlist: anything else is UNKNOWN_COMMAND.
 * Must match `schema/commands.json` (verified by `pnpm contracts:check`).
 */
export const COMMAND_TYPES = [
  'room.host.accept',
  'card.selectCategory',
  'card.revealAcknowledged',
  'auction.claimFranchise',
  'team.requestJoin',
  'team.decideJoin',
  'team.invite.rotate',
  'team.permissions',
  'team.captain.propose',
  'team.captain.accept',
  'team.shortlist.upsert',
  'team.shortlist.remove',
  'team.shortlist.vote',
  'auction.retention.propose',
  'auction.retention.lock',
  'auction.franchiseSelection.close',
  'auction.bid',
  'auction.rtm.intent',
  'auction.rtm.finalOffer',
  'auction.rtm.match',
  'auction.pause',
  'auction.resume',
  'auction.skip',
  'team.auto.configure',
  'team.auto.takeover',
  'vote.start',
  'vote.cast',
  'chat.send',
  'chat.mute',
  'chat.remove',
  'chat.subscribe',
  'chat.unsubscribe',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export const CommandTypeSchema = z.enum(COMMAND_TYPES);

/**
 * Common command envelope. Payload schemas are registered per command type in the
 * phase that implements the command; until then the dispatcher rejects the type.
 */
export const CommandEnvelopeSchema = z
  .object({
    type: z.string().min(1).max(64),
    commandId: Uuid,
    roomId: Uuid,
    expectedVersion: DecimalString,
    controlEpoch: DecimalString,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export function isAllowlistedCommand(type: string): type is CommandType {
  return (COMMAND_TYPES as readonly string[]).includes(type);
}
