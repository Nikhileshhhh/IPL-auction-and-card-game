import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADVISOR_CAPABILITIES,
  ChatChannelSchema,
  type ChatChannel,
  type RoomLobbyDTO,
  type TeamView,
} from '@stumps/contracts';
import {
  ACCESS_CODE,
  createTestApi,
  onboardMember,
  type BffClient,
  type TestApi,
} from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

/**
 * Temporary room and team chat (phase 13, ADR-028): plain text up to 500 code
 * points, idempotent sends, rate limits, mutes, removal with redaction, and
 * cleanup with the room.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_chat');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { command, startedAuction, snapshot } = auctionHelpers(() => api);

export async function channel(c: BffClient, roomId: string, kind: 'room' | 'team') {
  const res = await c.request<ChatChannel>('GET', `/v1/rooms/${roomId}/chat/${kind}/messages`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ChatChannelSchema.parse(res.body.data);
}

const send = (c: BffClient, roomId: string, channelId: string, text: string, id = randomUUID()) =>
  command(c, roomId, 'chat.send', { channelId, clientMessageId: id, text });

async function joinTeam(roomId: string, captain: BffClient, mate: BffClient) {
  const code = (await captain.request<TeamView>('GET', `/v1/rooms/${roomId}/team`)).body.data!
    .joinCode;
  const asked = await command(mate, roomId, 'team.requestJoin', { franchiseCode: code });
  await command(captain, roomId, 'team.decideJoin', {
    requestId: asked.body.data!.requestId,
    approve: true,
    role: 'advisor',
    capabilities: ADVISOR_CAPABILITIES,
  });
}

describe('room chat', () => {
  it('stores plain text verbatim, counts code points, and is idempotent per client id', async () => {
    const ctx = await startedAuction('ch_text');
    const room = await channel(ctx.host, ctx.roomId, 'room');
    expect(room.audienceLabel).toBe('Everyone in this room');
    const xss = `<img src=x onerror="alert(1)"><script>alert('x')</script> & "quotes"`;
    const first = await send(ctx.host, ctx.roomId, room.channelId, xss);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // 500 emoji are 500 code points (1,000 UTF-16 units): allowed; 501 is not.
    const bats = '🏏'.repeat(500);
    expect((await send(ctx.guest, ctx.roomId, room.channelId, bats)).status).toBe(200);
    expect((await send(ctx.guest, ctx.roomId, room.channelId, `${bats}!`)).status).toBe(400);
    expect((await send(ctx.guest, ctx.roomId, room.channelId, '   ')).status).toBe(400);
    // A retried send with the same client id is the same message.
    const id = randomUUID();
    const a = await send(ctx.guest, ctx.roomId, room.channelId, 'hello', id);
    const b = await send(ctx.guest, ctx.roomId, room.channelId, 'hello', id);
    expect(b.body.data!.messageId).toBe(a.body.data!.messageId);
    const seen = await channel(ctx.guest, ctx.roomId, 'room');
    expect(seen.messages.map((m) => m.text)).toEqual([xss, bats, 'hello']);
    expect(seen.messages[0]).toMatchObject({ mine: false, removed: false });
    expect(seen.messages[2]).toMatchObject({ mine: true });
    const events = await api.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app_private.room_events WHERE room_id = $1 AND type = 'chat.message'`,
      [ctx.roomId],
    );
    expect(events.rows[0]!.n).toBe(3);
    // Chat never goes into the persistent inbox.
    const inbox = await api.admin.query(
      `SELECT 1 FROM app_private.notifications WHERE safe_payload::text LIKE '%hello%' OR safe_payload::text LIKE '%onerror%'`,
    );
    expect(inbox.rowCount).toBe(0);
  });

  it('rate-limits bursts, honours mutes and erases removed text from history and replay', async () => {
    const ctx = await startedAuction('ch_mod');
    const room = await channel(ctx.host, ctx.roomId, 'room');
    for (let i = 0; i < 5; i += 1) {
      expect((await send(ctx.guest, ctx.roomId, room.channelId, `m${i}`)).status).toBe(200);
    }
    const burst = await send(ctx.guest, ctx.roomId, room.channelId, 'too fast');
    expect(burst.body.error!.code).toBe('RATE_LIMITED');
    expect(burst.body.error!.details).toHaveProperty('retryAfterMs');

    // Only the host moderates the room channel.
    const guestId = (await snapshot(ctx.guest, ctx.roomId)).me.memberId;
    const hostId = (await snapshot(ctx.host, ctx.roomId)).me.memberId;
    const notHost = await command(ctx.guest, ctx.roomId, 'chat.mute', {
      channelId: room.channelId,
      memberId: hostId,
      durationSeconds: 60,
      reason: 'test',
    });
    expect(notHost.status).toBe(403);
    const muted = await command(ctx.host, ctx.roomId, 'chat.mute', {
      channelId: room.channelId,
      memberId: guestId,
      durationSeconds: 120,
      reason: 'Too many messages',
    });
    expect(muted.status, JSON.stringify(muted.body)).toBe(200);
    await api.admin.query(
      `UPDATE app_private.chat_messages SET created_at = now() - interval '1 minute' WHERE room_id = $1`,
      [ctx.roomId],
    );
    const whileMuted = await send(ctx.guest, ctx.roomId, room.channelId, 'still here');
    expect(whileMuted.body.error!.code).toBe('MUTED');
    expect((await channel(ctx.guest, ctx.roomId, 'room')).canSend).toBe(false);

    // The host removes a message: its text is gone from history and from the stored event.
    const target = (await channel(ctx.host, ctx.roomId, 'room')).messages[0]!;
    expect(
      (await command(ctx.guest, ctx.roomId, 'chat.remove', { messageId: randomUUID() })).status,
    ).toBe(404);
    const removed = await command(ctx.host, ctx.roomId, 'chat.remove', {
      messageId: target.messageId,
    });
    expect(removed.body.data).toEqual({ removed: true });
    const after = (await channel(ctx.guest, ctx.roomId, 'room')).messages[0]!;
    expect(after).toMatchObject({ messageId: target.messageId, removed: true, text: '' });
    const stored = await api.admin.query<{ text: string }>(
      `SELECT payload->>'text' AS text FROM app_private.room_events
        WHERE room_id = $1 AND type = 'chat.message' AND payload->>'messageId' = $2`,
      [ctx.roomId, target.messageId],
    );
    expect(stored.rows[0]!.text).toBe('');
    const body = await api.admin.query<{ body: string }>(
      'SELECT body FROM app_private.chat_messages WHERE id = $1',
      [target.messageId],
    );
    expect(body.rows[0]!.body).not.toBe('m0');
  });

  it('team chat belongs to the team; card rooms have room chat only; chat is deleted with the room', async () => {
    const ctx = await startedAuction('ch_team', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => joinTeam(roomId, host, mates[0]!),
    });
    const [mate] = ctx.mates as [BffClient];
    const team = await channel(mate, ctx.roomId, 'team');
    expect(team.audienceLabel).toMatch(/^Only .+ members$/);
    expect(team.members!.length).toBe(2);
    expect((await send(mate, ctx.roomId, team.channelId, 'Bid up to 4 cr on him')).status).toBe(
      200,
    );
    expect((await channel(ctx.host, ctx.roomId, 'team')).messages[0]!.text).toBe(
      'Bid up to 4 cr on him',
    );
    // The rival's "team" is their own channel, empty.
    const rivalTeam = await channel(ctx.guest, ctx.roomId, 'team');
    expect(rivalTeam.channelId).not.toBe(team.channelId);
    expect(rivalTeam.messages).toEqual([]);

    // A card room: room chat works, team chat does not exist.
    const solo = await onboardMember(api, 'ch_card');
    const created = await solo.client.mutate<{ lobby: RoomLobbyDTO }>('POST', '/v1/rooms', {
      gameType: 'card',
      name: 'Cards',
      settings: { maxPlayers: 2, totalCards: 8 },
    });
    const cardRoom = created.body.data!.lobby.roomId;
    const cardChat = await channel(solo.client, cardRoom, 'room');
    expect((await send(solo.client, cardRoom, cardChat.channelId, 'gl hf')).status).toBe(200);
    const noTeam = await solo.client.request('GET', `/v1/rooms/${cardRoom}/chat/team/messages`);
    expect((noTeam.body as { error: { code: string } }).error.code).toBe('CHAT_FORBIDDEN');

    // Strictly temporary: deleting the room deletes its chat.
    await api.admin.query('DELETE FROM app_private.rooms WHERE id = $1', [ctx.roomId]);
    const left = await api.admin.query(
      'SELECT 1 FROM app_private.chat_messages WHERE room_id = $1 UNION ALL SELECT 1 FROM app_private.chat_channels WHERE room_id = $1',
      [ctx.roomId],
    );
    expect(left.rowCount).toBe(0);
  });
});
