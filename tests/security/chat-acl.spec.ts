import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADVISOR_CAPABILITIES, type ChatChannel, type TeamView } from '@stumps/contracts';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

/**
 * Team chat is private (ADR-028): opponents can neither read, send to,
 * moderate nor replay it, and someone who leaves the team loses it at once —
 * enforced by the server, not by hiding UI.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_sec_chat');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { command, startedAuction, snapshot } = auctionHelpers(() => api);

const history = (c: BffClient, roomId: string, kind: 'room' | 'team') =>
  c.request<ChatChannel>('GET', `/v1/rooms/${roomId}/chat/${kind}/messages`);

describe('team chat access', () => {
  it('opponents cannot read, send, remove, mute or replay; a removed member loses it', async () => {
    let mateId = '';
    const ctx = await startedAuction('sc_acl', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        const code = (await host.request<TeamView>('GET', `/v1/rooms/${roomId}/team`)).body.data!
          .joinCode;
        const asked = await command(mates[0]!, roomId, 'team.requestJoin', { franchiseCode: code });
        await command(host, roomId, 'team.decideJoin', {
          requestId: asked.body.data!.requestId,
          approve: true,
          role: 'advisor',
          capabilities: ADVISOR_CAPABILITIES,
        });
        mateId = (await snapshot(mates[0]!, roomId)).me.memberId;
      },
    });
    const [mate] = ctx.mates as [BffClient];
    const team = (await history(ctx.host, ctx.roomId, 'team')).body.data!;
    const secret = 'Our max for him is 6 cr';
    const sent = await command(ctx.host, ctx.roomId, 'chat.send', {
      channelId: team.channelId,
      clientMessageId: randomUUID(),
      text: secret,
    });
    expect(sent.status).toBe(200);
    const messageId = sent.body.data!.messageId as string;

    // The rival addresses the host team's channel directly by id.
    const rivalSend = await command(ctx.guest, ctx.roomId, 'chat.send', {
      channelId: team.channelId,
      clientMessageId: randomUUID(),
      text: 'hi',
    });
    expect(rivalSend.body.error!.code).toBe('CHAT_FORBIDDEN');
    const rivalRemove = await command(ctx.guest, ctx.roomId, 'chat.remove', { messageId });
    expect(rivalRemove.status).toBe(404);
    const rivalMute = await command(ctx.guest, ctx.roomId, 'chat.mute', {
      channelId: team.channelId,
      memberId: mateId,
      durationSeconds: 60,
      reason: 'x',
    });
    expect(rivalMute.body.error!.code).toBe('CHAT_FORBIDDEN');
    const rivalSub = await command(ctx.guest, ctx.roomId, 'chat.subscribe', {
      channelId: team.channelId,
    });
    expect(rivalSub.body.error!.code).toBe('CHAT_FORBIDDEN');
    // Nothing of the team channel appears in the rival's own views or streams.
    const rivalTeam = (await history(ctx.guest, ctx.roomId, 'team')).body.data!;
    expect(JSON.stringify(rivalTeam)).not.toContain(secret);
    expect(JSON.stringify((await history(ctx.guest, ctx.roomId, 'room')).body.data)).not.toContain(
      secret,
    );
    const stream = (
      await api.admin.query<{ id: string }>(
        `SELECT id FROM app_private.room_streams WHERE room_id = $1 AND audience_kind = 'team' AND audience_id = $2`,
        [ctx.roomId, ctx.hostTeam],
      )
    ).rows[0]!.id;
    const replay = (c: BffClient) =>
      c.request('GET', `/v1/rooms/${ctx.roomId}/events?streamId=${stream}&afterSeq=0`);
    expect((await replay(ctx.guest)).status).toBe(404);
    // The team member can replay it (the message is there)…
    const own = await replay(mate);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain(secret);
    // …until they leave the team: then history and replay are refused at once.
    await api.admin.query('DELETE FROM app_private.franchise_members WHERE member_id = $1', [
      mateId,
    ]);
    expect(
      ((await history(mate, ctx.roomId, 'team')).body as { error: { code: string } }).error.code,
    ).toBe('CHAT_FORBIDDEN');
    expect((await replay(mate)).status).toBe(404);
    const late = await command(mate, ctx.roomId, 'chat.send', {
      channelId: team.channelId,
      clientMessageId: randomUUID(),
      text: 'still here?',
    });
    expect(late.body.error!.code).toBe('CHAT_FORBIDDEN');
  });

  it('a non-member of the room cannot read its chat at all', async () => {
    const ctx = await startedAuction('sc_out');
    const other = await startedAuction('sc_out2');
    const res = await other.host.request('GET', `/v1/rooms/${ctx.roomId}/chat/room/messages`);
    expect(res.status).toBe(404);
    const room = (await history(ctx.host, ctx.roomId, 'room')).body.data!;
    const send = await command(other.host, other.roomId, 'chat.send', {
      channelId: room.channelId,
      clientMessageId: randomUUID(),
      text: 'cross-room',
    });
    expect(send.body.error!.code).toBe('CHAT_FORBIDDEN');
  });
});
