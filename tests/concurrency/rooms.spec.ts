import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermittedSnapshotDTO, RoomLobbyDTO } from '@stumps/contracts';
import { buildApp } from '../../apps/server/src/app';
import { CoordinatorLease, runDuePass } from '../../apps/server/src/jobs/deadlines';
import { DeadlineRegistry } from '../../apps/server/src/jobs/deadlines';
import { registerRoomDeadlines } from '../../apps/server/src/rooms/deadline-handlers';
import { createRoomRuntime } from '../../apps/server/src/modules/rooms/runtime';
import type { RuntimeDeps } from '../../apps/server/src/runtime';
import { ACCESS_CODE, BffClient, createTestApi, onboardMember, type TestApi } from '../support/api';
import { runtimeUrl } from '../support/db';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_cc_rooms');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());

async function cardLobby(maxPlayers: number) {
  const host = await onboardMember(api, `host_${randomUUID().slice(0, 8)}`);
  const res = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
    'POST',
    '/v1/rooms',
    {
      gameType: 'card',
      name: 'Race',
      settings: { maxPlayers, totalCards: maxPlayers * 4 },
    },
  );
  expect(res.status).toBe(201);
  return { host, ...res.body.data! };
}

describe('room capacity under the room lock (E13)', () => {
  it('two joiners racing for the last slot: exactly one wins', async () => {
    const { lobby, roomCode } = await cardLobby(2);
    const [a, b] = await Promise.all([
      onboardMember(api, `race_a_${randomUUID().slice(0, 6)}`),
      onboardMember(api, `race_b_${randomUUID().slice(0, 6)}`),
    ]);
    const results = await Promise.all(
      [a, b].map((m) =>
        m.client.mutate('POST', '/v1/rooms/join', { code: roomCode, gameType: 'card' }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 422]);
    expect(results.find((r) => r.status === 422)!.body.error!.code).toBe('ROOM_FULL');
    const count = await api.admin.query(
      'SELECT count(*)::int AS n FROM app_private.room_members WHERE room_id = $1',
      [lobby.roomId],
    );
    expect(count.rows[0].n).toBe(2);
  });

  it('a burst of joiners fills exactly the free seats with unique seat numbers', async () => {
    const { lobby, roomCode } = await cardLobby(4);
    const joiners = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        onboardMember(api, `burst_${i}_${randomUUID().slice(0, 6)}`),
      ),
    );
    const results = await Promise.all(
      joiners.map((m) =>
        m.client.mutate('POST', '/v1/rooms/join', { code: roomCode, gameType: 'card' }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(4);
    const seats = await api.admin.query<{ seat: number }>(
      'SELECT seat FROM app_private.room_members WHERE room_id = $1 ORDER BY seat',
      [lobby.roomId],
    );
    expect(seats.rows.map((r) => r.seat)).toEqual([0, 1, 2, 3]);
  });
});

describe('command idempotency (E43/E44)', () => {
  it('concurrent duplicates of one command apply once and return the same reply', async () => {
    const { host, lobby } = await cardLobby(4);
    const key = randomUUID();
    const body = { ready: true, configVersion: lobby.configVersion };
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, body, key),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    for (const r of results) expect(r.body.data).toEqual(results[0]!.body.data);
    const receipts = await api.admin.query(
      'SELECT count(*)::int AS n FROM app_private.room_commands WHERE room_id = $1 AND command_id = $2',
      [lobby.roomId, key],
    );
    expect(receipts.rows[0].n).toBe(1);
    const events = await api.admin.query(
      `SELECT count(*)::int AS n FROM app_private.room_events WHERE room_id = $1 AND type = 'room.readinessChanged'`,
      [lobby.roomId],
    );
    expect(events.rows[0].n).toBe(1);
    const conflict = await host.client.mutate(
      'POST',
      `/v1/rooms/${lobby.roomId}/ready`,
      { ...body, ready: false },
      key,
    );
    expect(conflict.body.error!.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('per-audience sequences stay contiguous under concurrent commands', async () => {
    const { host, lobby, roomCode } = await cardLobby(6);
    const guests = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        onboardMember(api, `seq_${i}_${randomUUID().slice(0, 6)}`),
      ),
    );
    await Promise.all(
      guests.map((g) =>
        g.client.mutate('POST', '/v1/rooms/join', { code: roomCode, gameType: 'card' }),
      ),
    );
    await Promise.all(
      [host, ...guests].map((m) =>
        m.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
          ready: true,
          configVersion: lobby.configVersion,
        }),
      ),
    );
    // Interleave private member-stream events with the public ones (E46).
    const target = await host.client.request<PermittedSnapshotDTO>(
      'GET',
      `/v1/rooms/${lobby.roomId}/snapshot`,
    );
    const someone = target.body.data!.room.members.find((m) => !m.isHost)!;
    await Promise.all([
      host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/host`, { memberId: someone.id }),
      guests[0]!.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
        ready: false,
        configVersion: lobby.configVersion,
      }),
    ]);
    const rows = await api.admin.query<{ stream_id: string; seqs: string[] }>(
      `SELECT stream_id, array_agg(seq::text ORDER BY seq) AS seqs FROM app_private.room_events
        WHERE room_id = $1 GROUP BY stream_id`,
      [lobby.roomId],
    );
    for (const row of rows.rows) {
      expect(row.seqs.map(Number)).toEqual(row.seqs.map((_, i) => i + 1));
    }
  });
});

describe('host dropout (E06)', () => {
  it('two workers racing on the same absent-host job transfer hosting exactly once', async () => {
    const { lobby, roomCode } = await cardLobby(4);
    const guests = await Promise.all(
      [0, 1].map((i) => onboardMember(api, `heir_${i}_${randomUUID().slice(0, 6)}`)),
    );
    const joined: string[] = [];
    for (const g of guests) {
      const res = await g.client.mutate<RoomLobbyDTO>('POST', '/v1/rooms/join', {
        code: roomCode,
        gameType: 'card',
      });
      joined.push(res.body.data!.myMembershipId);
    }
    // Both guests are connected; the host is not. The earliest joiner must win.
    for (const memberId of joined) {
      await api.admin.query(
        `INSERT INTO app_private.room_connections (room_id, member_id, socket_id, instance_id, is_controller, lease_epoch, expires_at)
         VALUES ($1, $2, $3, gen_random_uuid(), true, 0, now() + interval '30 seconds')`,
        [lobby.roomId, memberId, `sock-${randomUUID()}`],
      );
    }
    await api.admin.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, 'room.host_absent', $2, 0, now() - interval '1 second')`,
      [lobby.roomId, lobby.myMembershipId],
    );
    const registries = [0, 1].map(() => {
      const r = new DeadlineRegistry();
      registerRoomDeadlines(r);
      return r;
    });
    await Promise.all(registries.map((r) => runDuePass(api.pool, r, () => undefined)));
    await Promise.all(registries.map((r) => runDuePass(api.pool, r, () => undefined)));
    const host = await api.admin.query<{ id: string }>(
      `SELECT m.id FROM app_private.rooms r JOIN app_private.room_members m
         ON m.room_id = r.id AND m.user_id = r.host_user_id WHERE r.id = $1`,
      [lobby.roomId],
    );
    expect(host.rows[0]!.id).toBe(joined[0]);
    const transfers = await api.admin.query(
      `SELECT count(*)::int AS n FROM app_private.room_events WHERE room_id = $1 AND type = 'room.hostTransferred'`,
      [lobby.roomId],
    );
    expect(transfers.rows[0].n).toBe(1);
  });
});

describe('coordinator lease and restart', () => {
  it('fences a stale coordinator with a higher generation after expiry', async () => {
    await api.admin.query(`DELETE FROM app_private.runtime_leases WHERE name = 'coordinator'`);
    const first = new CoordinatorLease(api.pool, randomUUID(), 10_000);
    const second = new CoordinatorLease(api.pool, randomUUID(), 10_000);
    expect(await first.tryAcquire()).toBe(true);
    const generation = BigInt(first.generation!);
    // Concurrent attempts by the second owner while the lease is live all fail.
    const attempts = await Promise.all(Array.from({ length: 5 }, () => second.tryAcquire()));
    expect(attempts.every((a) => !a)).toBe(true);
    // Simulate a crashed coordinator: heartbeat stops and the lease expires.
    await api.admin.query(
      `UPDATE app_private.runtime_leases SET expires_at = now() - interval '1 second'`,
    );
    expect(await second.tryAcquire()).toBe(true);
    expect(BigInt(second.generation!)).toBe(generation + 1n);
    // The old owner cannot silently resume.
    expect(await first.tryAcquire()).toBe(false);
    await second.release();
  });

  it('rooms, snapshots and due jobs survive a full API restart', async () => {
    const { host, lobby } = await cardLobby(4);
    // Restart: brand-new pool, room runtime and app over the same database.
    const pool = new pg.Pool({ connectionString: runtimeUrl(api.dbName), max: 4 });
    const deps: RuntimeDeps = { ...api.deps, pool, rooms: createRoomRuntime(pool, api.secrets) };
    const app = await buildApp({ env: api.deps.env, readinessChecks: [], runtime: deps });
    await app.ready();
    try {
      const client = new BffClient(app, api.secrets.bffSigningKey, host.client.ip);
      client.gate = host.client.gate;
      client.member = host.client.member;
      const snap = await client.request<PermittedSnapshotDTO>(
        'GET',
        `/v1/rooms/${lobby.roomId}/snapshot`,
      );
      expect(snap.status).toBe(200);
      expect(snap.body.data!.room.roomId).toBe(lobby.roomId);
      expect(snap.body.data!.room.roomCode).toBeDefined();
      // The lobby-expiry job persisted in PostgreSQL is settled by the new runtime.
      await api.admin.query(
        `UPDATE app_private.rooms SET last_activity_at = now() - interval '2 hours' WHERE id = $1`,
        [lobby.roomId],
      );
      await api.admin.query(
        `UPDATE app_private.deadline_jobs SET due_at = now() WHERE room_id = $1`,
        [lobby.roomId],
      );
      await runDuePass(pool, deps.rooms.deadlines, () => undefined);
      const gone = await api.admin.query('SELECT 1 FROM app_private.rooms WHERE id = $1', [
        lobby.roomId,
      ]);
      expect(gone.rowCount).toBe(0);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
