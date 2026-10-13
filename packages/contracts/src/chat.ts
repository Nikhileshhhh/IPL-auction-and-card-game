import { z } from 'zod';
import { IsoTimestamp, Uuid } from './primitives';

/**
 * Temporary room and team chat (phase 13, ADR-028). Plain text only, at most
 * 500 Unicode code points (an emoji counts once), never HTML. Messages live
 * only as long as their room and are never copied into notifications.
 */

export const CHAT_MAX_CODEPOINTS = 500;
/** Code points, not UTF-16 units: "🏏" is one. */
export const codepoints = (text: string) => [...text].length;

export const ChatText = z
  .string()
  .refine((t) => t.trim().length > 0, 'Write a message first.')
  .refine((t) => codepoints(t) <= CHAT_MAX_CODEPOINTS, 'At most 500 characters.');

export const ChatChannelKindSchema = z.enum(['room', 'team']);
export type ChatChannelKind = z.infer<typeof ChatChannelKindSchema>;

// ------------------------------------------------------------------ commands
export const ChatSendPayload = z
  .object({ channelId: Uuid, clientMessageId: Uuid, text: ChatText })
  .strict();
export const ChatSendAck = z.object({ messageId: Uuid, createdAt: IsoTimestamp }).strict();

export const ChatRemovePayload = z.object({ messageId: Uuid }).strict();
export const ChatRemoveAck = z.object({ removed: z.boolean() }).strict();

export const ChatMutePayload = z
  .object({
    channelId: Uuid,
    memberId: Uuid,
    durationSeconds: z.number().int().min(1).max(86_400),
    reason: z.string().trim().min(1).max(120),
  })
  .strict();
export const ChatMuteAck = z.object({ expiresAt: IsoTimestamp }).strict();

export const ChatSubscribePayload = z
  .object({ channelId: Uuid, afterSeq: z.string().optional() })
  .strict();
export const ChatSubscribeAck = z.object({ authorizedCursor: z.string() }).strict();
export const ChatUnsubscribePayload = z.object({ channelId: Uuid }).strict();
export const ChatUnsubscribeAck = z.object({ unsubscribed: z.boolean() }).strict();

// -------------------------------------------------------------------- events
export const ChatSenderSchema = z.object({ memberId: Uuid, displayName: z.string() }).strict();
export const ChatMessagePayload = z
  .object({
    channelId: Uuid,
    messageId: Uuid,
    sender: ChatSenderSchema,
    text: z.string(),
    createdAt: IsoTimestamp,
  })
  .strict();
export const ChatRemovedPayload = z
  .object({ channelId: Uuid, messageId: Uuid, removed: z.boolean(), createdAt: IsoTimestamp })
  .strict();
export const ChatMutedPayload = z
  .object({ channelId: Uuid, expiresAt: IsoTimestamp, reason: z.string() })
  .strict();

export const CHAT_EVENT_PAYLOADS = {
  'chat.message': ChatMessagePayload,
  'chat.removed': ChatRemovedPayload,
  'chat.muted': ChatMutedPayload,
} as const;

// ---------------------------------------------------------------------- DTOs
export const ChatMessageSchema = z
  .object({
    messageId: Uuid,
    sender: ChatSenderSchema,
    /** Empty once removed: removed text is never sent again. */
    text: z.string(),
    removed: z.boolean(),
    createdAt: IsoTimestamp,
    mine: z.boolean(),
  })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** GET /v1/rooms/:id/chat/:channel/messages — `room` for everyone, `team` for its members. */
export const ChatChannelSchema = z
  .object({
    channelId: Uuid,
    kind: ChatChannelKindSchema,
    /** "Everyone in this room" or "Only Mumbai Indians members". */
    audienceLabel: z.string(),
    members: z.array(z.object({ memberId: Uuid, displayName: z.string() })).nullable(),
    messages: z.array(ChatMessageSchema),
    canSend: z.boolean(),
    mutedUntil: IsoTimestamp.nullable(),
    canModerate: z.boolean(),
  })
  .strict();
export type ChatChannel = z.infer<typeof ChatChannelSchema>;
