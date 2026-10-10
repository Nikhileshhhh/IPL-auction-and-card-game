import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermittedSnapshotDTO, RoomLobbyDTO } from '@stumps/contracts';
import { runDuePass } from '../../apps/server/src/jobs/deadlines';
import {
  ACCESS_CODE,
  createTestApi,
  onboardMember,
  type BffClient,
  type TestApi,
} from '../support/api';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_rooms');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());

const cardRoom = (overrides: Record<string, unknown> = {}) => ({
  gameType: 'card' as const,
  name: 'Friday night',
  settings: { maxPlayers: 4, totalCards: 48, ...overrides },
});

async function createCard(client: BffClient, body = cardRoom()) {
  const res = await client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
    'POST',
    '/v1/rooms',
    body,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data!;
}

async function join(client: BffClient, code: string, extra: Record<string, unknown> = {}) {
  return client.mutate<RoomLobbyDTO>('POST', '/v1/rooms/join', {
    code,
    gameType: 'card',
    ...extra,
  });
}

async function snapshot(client: BffClient, roomId: string) {
  return client.request<PermittedSnapshotDTO>('GET', `/v1/rooms/${roomId}/snapshot`);
}

describe('room creation and join (S05–S07)', () => {
  it('creates a lobby with a server-generated 12-character code and host seat 0', async () => {
    const { client } = await onboardMember(api, 'host_create');
    const { lobby, roomCode } = await createCard(client);
    expect(roomCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(lobby.lifecycle).toBe('LOBBY');
    expect(lobby.members).toHaveLength(1);
    expect(lobby.members[0]).toMatchObject({ seat: 0, isHost: true, ready: false });
    expect(lobby.myCapabilities).toEqual(expect.arrayContaining(['host', 'settings', 'start']));
    // Only a keyed digest and ciphertext are stored, never the plaintext code.
    const row = await api.admin.query<{ code_ciphertext: Buffer }>(
      'SELECT code_ciphertext FROM app_private.rooms WHERE id = $1',
      [lobby.roomId],
    );
    expect(row.rows[0]!.code_ciphertext.toString()).not.toContain(roomCode.replace(/-/g, ''));
  });

  it('requires an Idempotency-Key and replays creation without a second room', async () => {
    const { client } = await onboardMember(api, 'host_idem');
    const missing = await client.request('POST', '/v1/rooms', cardRoom());
    expect(missing.status).toBe(400);
    const key = randomUUID();
    const first = await client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
      'POST',
      '/v1/rooms',
      cardRoom(),
      key,
    );
    const again = await client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
      'POST',
      '/v1/rooms',
      cardRoom(),
      key,
    );
    expect(again.status).toBe(201);
    expect(again.body.data!.lobby.roomId).toBe(first.body.data!.lobby.roomId);
    expect(again.body.data!.roomCode).toBe(first.body.data!.roomCode);
    const conflict = await client.mutate('POST', '/v1/rooms', cardRoom({ totalCards: 40 }), key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error!.code).toBe('IDEMPOTENCY_CONFLICT');
    const count = await api.admin.query(
      `SELECT count(*)::int AS n FROM app_private.rooms r JOIN app_private.profiles p ON p.user_id = r.host_user_id
        WHERE p.username = 'host_idem'`,
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('rejects invalid settings with CONFIG_INVALID-style validation and unknown fields', async () => {
    const { client } = await onboardMember(api, 'host_invalid');
    const bad = await client.mutate('POST', '/v1/rooms', cardRoom({ maxPlayers: 12 }));
    expect(bad.status).toBe(400);
    const extra = await client.mutate('POST', '/v1/rooms', {
      ...cardRoom(),
      hostUserId: randomUUID(),
    });
    expect(extra.status).toBe(400);
  });

  it('joins with a normalized code, assigns the lowest free seat and rejects the wrong game', async () => {
    const host = await onboardMember(api, 'host_join');
    const guest = await onboardMember(api, 'guest_join');
    const { lobby, roomCode } = await createCard(host.client);
    const typed = roomCode.toLowerCase().replace(/-/g, ' ');
    const wrongGame = await guest.client.mutate('POST', '/v1/rooms/join', {
      code: typed,
      gameType: 'auction',
    });
    expect(wrongGame.status).toBe(422);
    expect(wrongGame.body.error!.code).toBe('GAME_MISMATCH');
    const joined = await join(guest.client, typed);
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body.data!.roomId).toBe(lobby.roomId);
    expect(joined.body.data!.members.map((m) => m.seat)).toEqual([0, 1]);
    // Joining again is idempotent and does not duplicate the membership.
    const again = await join(guest.client, roomCode);
    expect(again.body.data!.members).toHaveLength(2);
  });

  it('password rooms: wrong password and unknown code share one generic failure', async () => {
    const host = await onboardMember(api, 'host_pw');
    const guest = await onboardMember(api, 'guest_pw');
    const { lobby, roomCode } = await createCard(host.client, {
      ...cardRoom(),
      password: 'secret-word',
    } as never);
    expect(lobby.passwordProtected).toBe(true);
    const wrong = await join(guest.client, roomCode, { password: 'nope-nope' });
    const unknown = await join(guest.client, 'ZZZZ-ZZZZ-ZZZZ', { password: 'nope-nope' });
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrong.body.error).toEqual(unknown.body.error);
    const members = await api.admin.query(
      'SELECT count(*)::int AS n FROM app_private.room_members WHERE room_id = $1',
      [lobby.roomId],
    );
    expect(members.rows[0].n).toBe(1);
    const ok = await join(guest.client, roomCode, { password: 'secret-word' });
    expect(ok.status).toBe(200);
  });

  it('enforces capacity and the two-active-rooms limit', async () => {
    const host = await onboardMember(api, 'host_cap');
    const { roomCode } = await createCard(host.client, cardRoom({ maxPlayers: 2, totalCards: 8 }));
    const a = await onboardMember(api, 'cap_a');
    const b = await onboardMember(api, 'cap_b');
    expect((await join(a.client, roomCode)).status).toBe(200);
    const full = await join(b.client, roomCode);
    expect(full.status).toBe(422);
    expect(full.body.error!.code).toBe('ROOM_FULL');

    const busy = await onboardMember(api, 'busy_member');
    await createCard(busy.client);
    await createCard(busy.client);
    const third = await busy.client.mutate('POST', '/v1/rooms', cardRoom());
    expect(third.status).toBe(422);
    expect(third.body.error!.details).toMatchObject({ reason: 'MEMBERSHIP_LIMIT' });
  });

  it('requires a finished profile', async () => {
    const res = await api.client('192.0.2.77').mutate('POST', '/v1/rooms', cardRoom());
    expect(res.status).toBe(401);
  });
});

describe('lobby readiness, settings and start gates', () => {
  it('settings changes bump configVersion and clear every ready flag (E38)', async () => {
    const host = await onboardMember(api, 'host_settings');
    const guest = await onboardMember(api, 'guest_settings');
    const { lobby, roomCode } = await createCard(host.client);
    await join(guest.client, roomCode);
    const ready = await guest.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
      ready: true,
      configVersion: lobby.configVersion,
    });
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    const notHost = await guest.client.mutate('PATCH', `/v1/rooms/${lobby.roomId}/settings`, {
      patch: { selectionSeconds: 30 },
      configVersion: lobby.configVersion,
    });
    expect(notHost.status).toBe(403);
    const changed = await host.client.mutate<{ configVersion: string }>(
      'PATCH',
      `/v1/rooms/${lobby.roomId}/settings`,
      {
        patch: { selectionSeconds: 30 },
        configVersion: lobby.configVersion,
      },
    );
    expect(changed.status).toBe(200);
    expect(BigInt(changed.body.data!.configVersion)).toBe(BigInt(lobby.configVersion) + 1n);
    const snap = await snapshot(guest.client, lobby.roomId);
    expect(snap.body.data!.room.members.every((m) => !m.ready)).toBe(true);
    expect(snap.body.data!.room.settings.selectionSeconds).toBe(30);
    // Ready on the old rules is refused.
    const stale = await guest.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
      ready: true,
      configVersion: lobby.configVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error!.code).toBe('STALE_CONFIG');
  });

  it('start requires two ready players, an even deal and an available engine', async () => {
    const host = await onboardMember(api, 'host_start');
    const guest = await onboardMember(api, 'guest_start');
    const { lobby, roomCode } = await createCard(host.client, cardRoom({ totalCards: 50 }));
    const start = () =>
      host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/start`, {
        configVersion: current.configVersion,
      });
    let current = lobby;
    const alone = await start();
    expect(alone.body.error).toMatchObject({
      code: 'NOT_READY',
      details: { reason: 'TOO_FEW_PLAYERS' },
    });
    await join(guest.client, roomCode);
    const notReady = await start();
    expect(notReady.body.error).toMatchObject({
      code: 'NOT_READY',
      details: { reason: 'NOT_READY' },
    });
    for (const c of [host.client, guest.client]) {
      await c.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
        ready: true,
        configVersion: current.configVersion,
      });
    }
    // 50 cards cannot be split between... 2 players works (25 each), so make it uneven with 3.
    const third = await onboardMember(api, 'third_start');
    await join(third.client, roomCode);
    await third.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
      ready: true,
      configVersion: current.configVersion,
    });
    const uneven = await start();
    expect(uneven.status).toBe(422);
    expect(uneven.body.error).toMatchObject({
      code: 'CONFIG_INVALID',
      details: { reason: 'UNEVEN_DEAL' },
    });
    expect(
      (uneven.body.error!.details as { suggestedTotals: number[] }).suggestedTotals.every(
        (t) => t % 3 === 0,
      ),
    ).toBe(true);

    await host.client.mutate('PATCH', `/v1/rooms/${lobby.roomId}/settings`, {
      patch: { totalCards: 48 },
      configVersion: current.configVersion,
    });
    current = (await snapshot(host.client, lobby.roomId)).body.data!.room;
    for (const c of [host.client, guest.client, third.client]) {
      await c.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
        ready: true,
        configVersion: current.configVersion,
      });
    }
    const noEngine = await start();
    expect(noEngine.status).toBe(422);
    expect(noEngine.body.error).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { reason: 'ENGINE_UNAVAILABLE' },
    });
    const after = await snapshot(host.client, lobby.roomId);
    expect(after.body.data!.room.lifecycle).toBe('LOBBY');
  });
});

describe('host lifecycle, leave and kick', () => {
  it('kick removes the member; the kicked user can no longer read the room', async () => {
    const host = await onboardMember(api, 'host_kick');
    const guest = await onboardMember(api, 'guest_kick');
    const { lobby, roomCode } = await createCard(host.client);
    const joined = await join(guest.client, roomCode);
    const guestId = joined.body.data!.myMembershipId;
    const self = await host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/kick`, {
      memberId: lobby.myMembershipId,
    });
    expect(self.status).toBe(422);
    const kicked = await host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/kick`, {
      memberId: guestId,
    });
    expect(kicked.status).toBe(200);
    expect((await snapshot(guest.client, lobby.roomId)).status).toBe(404);
  });

  it('host leaving hands the lobby to the next member; last member leaving deletes it', async () => {
    const host = await onboardMember(api, 'host_leave');
    const guest = await onboardMember(api, 'guest_leave');
    const { lobby, roomCode } = await createCard(host.client);
    await join(guest.client, roomCode);
    expect((await host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/leave`)).status).toBe(200);
    const snap = await snapshot(guest.client, lobby.roomId);
    expect(snap.body.data!.room.members).toHaveLength(1);
    expect(snap.body.data!.room.members[0]!.isHost).toBe(true);
    await guest.client.mutate('POST', `/v1/rooms/${lobby.roomId}/leave`);
    const gone = await api.admin.query('SELECT 1 FROM app_private.rooms WHERE id = $1', [
      lobby.roomId,
    ]);
    expect(gone.rowCount).toBe(0);
  });

  it('voluntary host transfer needs the target to accept via room.host.accept', async () => {
    const host = await onboardMember(api, 'host_xfer');
    const guest = await onboardMember(api, 'guest_xfer');
    const { lobby, roomCode } = await createCard(host.client);
    const joined = await join(guest.client, roomCode);
    const proposal = await host.client.mutate<{ pendingHandover: string }>(
      'POST',
      `/v1/rooms/${lobby.roomId}/host`,
      {
        memberId: joined.body.data!.myMembershipId,
      },
    );
    expect(proposal.status).toBe(200);
    const snap = (await snapshot(guest.client, lobby.roomId)).body.data!;
    expect(snap.pendingHostHandover?.handoverId).toBe(proposal.body.data!.pendingHandover);
    const accept = await guest.client.request('POST', `/v1/rooms/${lobby.roomId}/commands`, {
      type: 'room.host.accept',
      commandId: randomUUID(),
      roomId: lobby.roomId,
      expectedVersion: snap.room.stateVersion,
      controlEpoch: snap.me.controlEpoch,
      payload: { handoverId: snap.pendingHostHandover!.handoverId },
    });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const after = (await snapshot(host.client, lobby.roomId)).body.data!.room;
    expect(after.hostMemberId).toBe(joined.body.data!.myMembershipId);
  });

  it('client-sent internal actions are UNKNOWN_COMMAND', async () => {
    const host = await onboardMember(api, 'host_unknown');
    const { lobby } = await createCard(host.client);
    const res = await host.client.request('POST', `/v1/rooms/${lobby.roomId}/commands`, {
      type: 'card.award',
      commandId: randomUUID(),
      roomId: lobby.roomId,
      expectedVersion: '0',
      controlEpoch: '0',
      payload: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error!.code).toMatch(/UNKNOWN_COMMAND|VALIDATION_FAILED/);
  });
});

describe('streams, replay and deadlines', () => {
  it('replays public events in order and conceals other members’ streams', async () => {
    const host = await onboardMember(api, 'host_replay');
    const guest = await onboardMember(api, 'guest_replay');
    const outsider = await onboardMember(api, 'outsider_replay');
    const { lobby, roomCode } = await createCard(host.client);
    const before = (await snapshot(host.client, lobby.roomId)).body.data!;
    await join(guest.client, roomCode);
    const guestSnap = (await snapshot(guest.client, lobby.roomId)).body.data!;
    const publicCursor = before.cursors.find((c) =>
      guestSnap.cursors.some((g) => g.streamId === c.streamId),
    )!;
    const events = await host.client.request<{
      events: { type: string; seq: string }[];
      snapshotRequired: boolean;
    }>(
      'GET',
      `/v1/rooms/${lobby.roomId}/events?streamId=${publicCursor.streamId}&afterSeq=${publicCursor.seq}`,
    );
    expect(events.status).toBe(200);
    expect(events.body.data!.events.map((e) => e.type)).toContain('room.memberJoined');
    const seqs = events.body.data!.events.map((e) => BigInt(e.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => (a < b ? -1 : 1)));

    // The guest's private member stream is not readable by the host or an outsider.
    const guestPrivate = guestSnap.cursors.find((c) => c.streamId !== publicCursor.streamId)!;
    const hostReads = await host.client.request(
      'GET',
      `/v1/rooms/${lobby.roomId}/events?streamId=${guestPrivate.streamId}&afterSeq=0`,
    );
    expect(hostReads.status).toBe(404);
    const outsiderReads = await outsider.client.request(
      'GET',
      `/v1/rooms/${lobby.roomId}/events?streamId=${publicCursor.streamId}&afterSeq=0`,
    );
    expect(outsiderReads.status).toBe(404);
    expect((await snapshot(outsider.client, lobby.roomId)).status).toBe(404);
  });

  it('a replay gap beyond the window requires a fresh snapshot', async () => {
    const host = await onboardMember(api, 'host_gap');
    const { lobby } = await createCard(host.client);
    const snap = (await snapshot(host.client, lobby.roomId)).body.data!;
    const stream = snap.cursors[0]!;
    await api.admin.query(
      `WITH s AS (UPDATE app_private.room_streams SET seq = seq + 600 WHERE id = $1 RETURNING seq)
       INSERT INTO app_private.room_events (room_id, stream_id, seq, state_version, type, payload, published_at)
       SELECT $2, $1, g, 0, 'presence.changed', '{}'::jsonb, now()
         FROM s, generate_series(s.seq - 599, s.seq) g`,
      [stream.streamId, lobby.roomId],
    );
    const res = await host.client.request<{ snapshotRequired: boolean; events: unknown[] }>(
      'GET',
      `/v1/rooms/${lobby.roomId}/events?streamId=${stream.streamId}&afterSeq=${stream.seq}`,
    );
    expect(res.body.data).toEqual({ events: [], snapshotRequired: true });
  });

  it('lobby inactivity deadline deletes an abandoned lobby (durable job, not a timer)', async () => {
    const host = await onboardMember(api, 'host_expire');
    const { lobby } = await createCard(host.client);
    await api.admin.query(
      `UPDATE app_private.rooms SET last_activity_at = now() - interval '31 minutes' WHERE id = $1`,
      [lobby.roomId],
    );
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second' WHERE room_id = $1`,
      [lobby.roomId],
    );
    const processed = await runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined);
    expect(processed).toBeGreaterThanOrEqual(1);
    const gone = await api.admin.query('SELECT 1 FROM app_private.rooms WHERE id = $1', [
      lobby.roomId,
    ]);
    expect(gone.rowCount).toBe(0);
  });

  it('lists the caller’s active rooms', async () => {
    const host = await onboardMember(api, 'host_list');
    const { lobby } = await createCard(host.client);
    const res = await host.client.request<{ items: { roomId: string }[] }>('GET', '/v1/me/rooms');
    expect(res.body.data!.items.map((i) => i.roomId)).toContain(lobby.roomId);
  });
});
