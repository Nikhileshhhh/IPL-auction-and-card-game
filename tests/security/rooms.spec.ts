import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomLobbyDTO } from '@stumps/contracts';
import { ACCESS_CODE, createTestApi, onboardMember, type TestApi } from '../support/api';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_sec_rooms');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());

async function room(password?: string) {
  const host = await onboardMember(api, `sec_${randomUUID().slice(0, 8)}`);
  const res = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
    'POST',
    '/v1/rooms',
    {
      gameType: 'card',
      name: 'Secure',
      ...(password ? { password } : {}),
      settings: { maxPlayers: 4, totalCards: 48 },
    },
  );
  expect(res.status).toBe(201);
  return { host, ...res.body.data! };
}

describe('room secrets never persist in plaintext', () => {
  it('room code and password are absent from rooms, receipts, commands and events', async () => {
    const password = 'plaintext-room-pass';
    const { lobby, roomCode } = await room(password);
    const raw = roomCode.replace(/-/g, '');
    const dump = await api.admin.query<{ blob: string }>(
      `SELECT concat_ws('|',
          (SELECT row_to_json(r)::text FROM app_private.rooms r WHERE r.id = $1),
          (SELECT string_agg(row_to_json(c)::text, '|') FROM app_private.request_receipts c WHERE c.resource_id = $1),
          (SELECT string_agg(row_to_json(c)::text, '|') FROM app_private.room_commands c WHERE c.room_id = $1),
          (SELECT string_agg(row_to_json(e)::text, '|') FROM app_private.room_events e WHERE e.room_id = $1)) AS blob`,
      [lobby.roomId],
    );
    expect(dump.rows[0]!.blob).not.toContain(raw);
    expect(dump.rows[0]!.blob).not.toContain(password);
  });
});

describe('room authorization', () => {
  it('non-members and malformed IDs get the same concealed 404', async () => {
    const { lobby } = await room();
    const outsider = await onboardMember(api, `out_${randomUUID().slice(0, 8)}`);
    const hidden = await outsider.client.request('GET', `/v1/rooms/${lobby.roomId}/snapshot`);
    const missing = await outsider.client.request('GET', `/v1/rooms/${randomUUID()}/snapshot`);
    const malformed = await outsider.client.request('GET', '/v1/rooms/not-a-uuid/snapshot');
    expect([hidden.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(hidden.body.error).toEqual(missing.body.error);
    for (const path of ['ready', 'start', 'leave', 'kick', 'host']) {
      const res = await outsider.client.mutate('POST', `/v1/rooms/${lobby.roomId}/${path}`, {});
      expect([400, 404], path).toContain(res.status);
    }
  });

  it('clients cannot assign host, seat, role or capacity', async () => {
    const host = await onboardMember(api, `forge_${randomUUID().slice(0, 8)}`);
    for (const extra of [
      { hostUserId: randomUUID() },
      { seat: 3 },
      { role: 'host' },
      { maxMembers: 99 },
    ]) {
      const res = await host.client.mutate('POST', '/v1/rooms', {
        gameType: 'card',
        name: 'Forged',
        settings: { maxPlayers: 4, totalCards: 48 },
        ...extra,
      });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const { lobby, roomCode } = await room();
    const guest = await onboardMember(api, `forge_g_${randomUUID().slice(0, 6)}`);
    const join = await guest.client.mutate('POST', '/v1/rooms/join', {
      code: roomCode,
      gameType: 'card',
      seat: 0,
    });
    expect(join.status).toBe(400);
    const settings = await guest.client.mutate('PATCH', `/v1/rooms/${lobby.roomId}/settings`, {
      patch: { maxPlayers: 8 },
      configVersion: lobby.configVersion,
    });
    expect(settings.status).toBe(404);
  });

  it('room code guessing is rate limited per user', async () => {
    const guesser = await onboardMember(api, `guess_${randomUUID().slice(0, 8)}`);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await guesser.client.mutate('POST', '/v1/rooms/join', {
        code: `ZZZZ-ZZZZ-ZZ${String(i).padStart(2, '0')}`,
        gameType: 'card',
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('the commands endpoint refuses a body for a different room than the URL', async () => {
    const { host, lobby } = await room();
    const res = await host.client.request('POST', `/v1/rooms/${lobby.roomId}/commands`, {
      type: 'room.host.accept',
      commandId: randomUUID(),
      roomId: randomUUID(),
      expectedVersion: '0',
      controlEpoch: '0',
      payload: { handoverId: randomUUID() },
    });
    expect(res.status).toBe(400);
  });
});
