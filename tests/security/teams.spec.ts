import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomLobbyDTO } from '@stumps/contracts';
import { ACCESS_CODE, createTestApi, onboardMember, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

/**
 * Team privacy and authority (ADR-026): the room host has no team powers, a
 * team code alone never grants membership, and a team's plans and events are
 * readable by its own approved members only.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_sec_teams');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { setup, command, snapshot } = auctionHelpers(() => api);

describe('team authority', () => {
  it('the host, a code holder and a rival get nothing from another team', async () => {
    const host = await onboardMember(api, 'st_host');
    const captain = await onboardMember(api, 'st_cap');
    const asker = await onboardMember(api, 'st_ask');
    const created = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
      'POST',
      '/v1/rooms',
      { gameType: 'auction', name: 'Privacy', settings: { franchiseCount: 2 } },
    );
    const roomId = created.body.data!.lobby.roomId;
    const roomCode = created.body.data!.roomCode;
    for (const c of [captain.client, asker.client]) {
      await c.mutate('POST', '/v1/rooms/join', { code: roomCode, gameType: 'auction' });
    }
    const franchise = (await setup(captain.client, roomId)).teams[0]!.franchiseDefinitionId;
    expect(
      (
        await command(captain.client, roomId, 'auction.claimFranchise', {
          franchiseDefinitionId: franchise,
        })
      ).status,
    ).toBe(200);
    const teamId = (await setup(captain.client, roomId)).myTeam!.teamId;
    const code = (await setup(captain.client, roomId)).myTeam!.joinCode!;

    // A code makes a pending request, not membership.
    const asked = await command(asker.client, roomId, 'team.requestJoin', { franchiseCode: code });
    expect(asked.body.data).toMatchObject({ pending: true });
    expect((await asker.client.request('GET', `/v1/rooms/${roomId}/team`)).status).toBe(404);
    expect(
      (await asker.client.request('GET', `/v1/rooms/${roomId}/franchises/${teamId}/shortlist`))
        .status,
    ).toBe(404);
    const streams = (await snapshot(asker.client, roomId)).cursors.map((c) => c.streamId);
    const teamStream = await api.admin.query<{ id: string }>(
      `SELECT id FROM app_private.room_streams WHERE room_id = $1 AND audience_kind = 'team'`,
      [roomId],
    );
    expect(streams).not.toContain(teamStream.rows[0]!.id);

    // The host is not in the team: no approval, no delegation, no rotation, no reading.
    const requestId = asked.body.data!.requestId as string;
    const hostDecides = await command(host.client, roomId, 'team.decideJoin', {
      requestId,
      approve: true,
    });
    expect(hostDecides.status).toBe(403);
    const captainMember = (await snapshot(captain.client, roomId)).me.memberId;
    for (const [type, payload] of [
      [
        'team.permissions',
        {
          memberId: captainMember,
          role: 'advisor',
          capabilities: {
            bid: false,
            invite: false,
            strategy: true,
            retainPropose: false,
            rtm: false,
            manageLimits: false,
          },
        },
      ],
      ['team.captain.propose', { memberId: captainMember }],
      ['team.invite.rotate', {}],
      ['team.shortlist.vote', { playerId: captainMember, value: 1 }],
    ] as const) {
      const res = await command(host.client, roomId, type, payload);
      expect(res.status, type).toBe(403);
    }
    expect((await host.client.request('GET', `/v1/rooms/${roomId}/team`)).status).toBe(404);
    expect(
      (await host.client.request('GET', `/v1/rooms/${roomId}/franchises/${teamId}/shortlist`))
        .status,
    ).toBe(404);
    expect(
      (
        await host.client.request(
          'GET',
          `/v1/rooms/${roomId}/events?streamId=${teamStream.rows[0]!.id}&afterSeq=0`,
        )
      ).status,
    ).toBe(404);

    // Only after the captain approves does the asker see the team.
    const approved = await command(captain.client, roomId, 'team.decideJoin', {
      requestId,
      approve: true,
    });
    expect(approved.status).toBe(200);
    expect((await asker.client.request('GET', `/v1/rooms/${roomId}/team`)).status).toBe(200);
  });
});
