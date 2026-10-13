import {
  ChatMutePayload,
  ChatRemovePayload,
  ChatSendPayload,
  ChatSubscribePayload,
  ChatUnsubscribePayload,
  type CommandEnvelope,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { requireMembership } from '../../rooms/projection';
import { runRoomCommand } from '../../rooms/room-tx';
import { streamFor } from '../../rooms/streams';
import type { CommandDispatcher } from '../commands/dispatcher';
import type { RoomDeps } from '../rooms/service';
import { audienceOf, authorizedChannel, canModerate, mutedUntil } from './channels';

/**
 * Chat commands (DB/realtime §8.2, ADR-028): plain text, at most 500 code
 * points, 5 messages per 10 seconds per member and channel, idempotent by
 * client message id. Message bodies are never written to logs. A removed
 * message's text is erased from the table and from the stored stream event,
 * so neither history nor replay can bring it back.
 */

export const RATE = { messages: 5, windowMs: 10_000 } as const;

function run<T>(
  deps: RoomDeps,
  actorUserId: string,
  env: CommandEnvelope,
  payload: unknown,
  handler: Parameters<typeof runRoomCommand<T>>[2],
) {
  return runRoomCommand<T>(
    deps.pool,
    {
      roomId: env.roomId,
      actorKey: `user:${actorUserId}`,
      commandId: env.commandId,
      body: { type: env.type, payload },
    },
    handler,
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

export function registerChatCommands(commands: CommandDispatcher) {
  commands.register('chat.send', async (deps, actor, env) => {
    const payload = ChatSendPayload.parse(env.payload);
    type Reply = { messageId: string; createdAt: string };
    return run<Reply>(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const channel = await authorizedChannel(tx, room, member, payload.channelId);
      // A retried send with the same client id is the same message.
      const existing = (
        await tx.query<{ id: string; created_at: Date }>(
          `SELECT id, created_at FROM app_private.chat_messages
            WHERE sender_member_id = $1 AND client_message_id = $2`,
          [member.id, payload.clientMessageId],
        )
      ).rows[0];
      if (existing) {
        return { reply: { messageId: existing.id, createdAt: existing.created_at.toISOString() } };
      }
      const muted = await mutedUntil(tx, channel.id, member.id, now);
      if (muted) {
        throw new AppError('MUTED', 'You are muted in this chat for now.', {
          until: muted.toISOString(),
        });
      }
      const recent = await tx.query<{ n: number; oldest: Date | null }>(
        `SELECT count(*)::int AS n, min(created_at) AS oldest FROM app_private.chat_messages
          WHERE channel_id = $1 AND sender_member_id = $2 AND created_at > $3`,
        [channel.id, member.id, new Date(now.getTime() - RATE.windowMs)],
      );
      const r = recent.rows[0];
      if (r && r.n >= RATE.messages && r.oldest) {
        throw new AppError('RATE_LIMITED', 'Slow down a little before sending again.', {
          retryAfterMs: Math.max(0, r.oldest.getTime() + RATE.windowMs - now.getTime()),
        });
      }
      const row = (
        await tx.query<{ id: string; created_at: Date }>(
          `INSERT INTO app_private.chat_messages
             (room_id, channel_id, sender_member_id, client_message_id, body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
          [room.id, channel.id, member.id, payload.clientMessageId, payload.text, now],
        )
      ).rows[0] as { id: string; created_at: Date };
      return {
        reply: { messageId: row.id, createdAt: row.created_at.toISOString() },
        events: [
          {
            audience: audienceOf(channel),
            type: 'chat.message',
            payload: {
              channelId: channel.id,
              messageId: row.id,
              sender: { memberId: member.id, displayName: member.display_name },
              text: payload.text,
              createdAt: row.created_at.toISOString(),
            },
          },
        ],
        touch: true,
      };
    });
  });

  commands.register('chat.remove', async (deps, actor, env) => {
    const payload = ChatRemovePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const message = (
        await tx.query<{ channel_id: string; sender_member_id: string; removed: boolean }>(
          `SELECT channel_id, sender_member_id, removed_at IS NOT NULL AS removed
             FROM app_private.chat_messages WHERE id = $1 AND room_id = $2`,
          [payload.messageId, room.id],
        )
      ).rows[0];
      if (!message) throw new AppError('NOT_FOUND', 'Message not found.');
      // Concealed exactly like a missing message for anyone outside the channel.
      const channel = await authorizedChannel(tx, room, member, message.channel_id).catch(() => {
        throw new AppError('NOT_FOUND', 'Message not found.');
      });
      const own = message.sender_member_id === member.id;
      if (!own && !(await canModerate(tx, room, member, channel))) {
        throw new AppError('FORBIDDEN', 'Only the sender or a moderator can remove this.');
      }
      if (message.removed) return { reply: { removed: true } };
      await tx.query(
        `UPDATE app_private.chat_messages
            SET body = '·', removed_at = $2, removed_by = $3,
                moderation_reason = CASE WHEN $4 THEN NULL ELSE 'moderator' END
          WHERE id = $1`,
        [payload.messageId, now, member.id, own],
      );
      await tx.query(
        `UPDATE app_private.room_events SET payload = jsonb_set(payload, '{text}', '""'::jsonb)
          WHERE room_id = $1 AND type = 'chat.message' AND payload->>'messageId' = $2`,
        [room.id, payload.messageId],
      );
      return {
        reply: { removed: true },
        events: [
          {
            audience: audienceOf(channel),
            type: 'chat.removed',
            payload: {
              channelId: channel.id,
              messageId: payload.messageId,
              removed: true,
              createdAt: now.toISOString(),
            },
          },
        ],
        touch: true,
      };
    });
  });

  commands.register('chat.mute', async (deps, actor, env) => {
    const payload = ChatMutePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room, now }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const channel = await authorizedChannel(tx, room, member, payload.channelId);
      if (!(await canModerate(tx, room, member, channel))) {
        throw new AppError(
          'FORBIDDEN',
          'Only the host (room chat) or captain (team chat) can mute.',
        );
      }
      if (payload.memberId === member.id) {
        throw new AppError('FORBIDDEN', 'You cannot mute yourself.');
      }
      const target = (
        await tx.query<{ id: string; user_id: string; display_name: string }>(
          `SELECT m.id, m.user_id, p.display_name FROM app_private.room_members m
             JOIN app_private.profiles p ON p.user_id = m.user_id
            WHERE m.id = $1 AND m.room_id = $2`,
          [payload.memberId, room.id],
        )
      ).rows[0];
      if (!target) throw new AppError('NOT_FOUND', 'That person is not in this room.');
      // A team captain can only mute people who can see the team channel.
      await authorizedChannel(
        tx,
        room,
        { ...member, id: target.id, user_id: target.user_id, display_name: target.display_name },
        channel.id,
      ).catch(() => {
        throw new AppError('NOT_FOUND', 'That person is not in this chat.');
      });
      const expiresAt = new Date(now.getTime() + payload.durationSeconds * 1000);
      await tx.query(
        `INSERT INTO app_private.chat_mutes (room_id, channel_id, member_id, muted_by, reason, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (channel_id, member_id) DO UPDATE
           SET muted_by = EXCLUDED.muted_by, reason = EXCLUDED.reason,
               created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
        [room.id, channel.id, target.id, member.id, payload.reason, now, expiresAt],
      );
      return {
        reply: { expiresAt: expiresAt.toISOString() },
        events: [
          {
            audience: { kind: 'member', memberId: target.id },
            type: 'chat.muted',
            payload: {
              channelId: channel.id,
              expiresAt: expiresAt.toISOString(),
              reason: payload.reason,
            },
          },
        ],
        touch: true,
      };
    });
  });

  // The channel's stream cursor this member may read from (delivery itself rides the stream ACL).
  commands.register('chat.subscribe', async (deps, actor, env) => {
    const payload = ChatSubscribePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room }) => {
      const member = await requireMembership(tx, room.id, actor.userId);
      const channel = await authorizedChannel(tx, room, member, payload.channelId);
      const stream = await streamFor(tx, room.id, audienceOf(channel));
      const seq = await tx.query<{ seq: string }>(
        'SELECT seq::text FROM app_private.room_streams WHERE id = $1',
        [stream],
      );
      return { reply: { authorizedCursor: seq.rows[0]?.seq ?? '0' } };
    });
  });

  commands.register('chat.unsubscribe', async (deps, actor, env) => {
    const payload = ChatUnsubscribePayload.parse(env.payload);
    return run(deps, actor.userId, env, payload, async ({ tx, room }) => {
      await requireMembership(tx, room.id, actor.userId);
      return { reply: { unsubscribed: true } };
    });
  });
}
