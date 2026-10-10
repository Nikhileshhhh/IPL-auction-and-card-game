import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermittedSnapshotDTO, RoomLobbyDTO } from '@stumps/contracts';
import { runDuePass } from '../../apps/server/src/jobs/deadlines';
import { ACCESS_CODE, createTestApi, onboardMember, type TestApi } from '../support/api';
import { collectEvents, emitAck, startRealtime, waitFor, type Realtime } from '../support/realtime';

let api: TestApi;
let rt: Realtime;
beforeAll(async () => {
  api = await createTestApi('stumps_it_rooms_rt');
  await api.setAccessCode(ACCESS_CODE);
  rt = await startRealtime(api);
});
afterAll(async () => {
  await rt?.close();
  await api?.close();
});

async function lobbyWithGuest(prefix: string) {
  const host = await onboardMember(api, `${prefix}_host`);
  const guest = await onboardMember(api, `${prefix}_guest`);
  const created = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
    'POST',
    '/v1/rooms',
    {
      gameType: 'card',
      name: 'Realtime',
      settings: { maxPlayers: 4, totalCards: 48 },
    },
  );
  const lobby = created.body.data!.lobby;
  const joined = await guest.client.mutate<RoomLobbyDTO>('POST', '/v1/rooms/join', {
    code: created.body.data!.roomCode,
    gameType: 'card',
  });
  return { host, guest, lobby, guestMemberId: joined.body.data!.myMembershipId };
}

describe('room sockets', () => {
  it('subscribe returns the permitted snapshot and pushes outbox events in order', async () => {
    const { host, guest, lobby } = await lobbyWithGuest('rt_sub');
    const hostSocket = await rt.open(host.client);
    const events = collectEvents(hostSocket);
    const sub = await emitAck<PermittedSnapshotDTO>(hostSocket, 'room.subscribe', {
      roomId: lobby.roomId,
    });
    expect(sub.ok, JSON.stringify(sub)).toBe(true);
    expect(sub.data!.room.members).toHaveLength(2);
    expect(sub.data!.me.isController).toBe(true);

    await guest.client.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
      ready: true,
      configVersion: lobby.configVersion,
    });
    await waitFor(() => events.some((e) => e.type === 'room.readinessChanged'));
    const publicStream = events.find((e) => e.type === 'room.readinessChanged')!.streamId;
    const seqs = events.filter((e) => e.streamId === publicStream).map((e) => Number(e.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('a non-member cannot subscribe; a raw stream name grants nothing', async () => {
    const { lobby } = await lobbyWithGuest('rt_acl');
    const outsider = await onboardMember(api, 'rt_acl_outsider');
    const socket = await rt.open(outsider.client);
    const events = collectEvents(socket);
    const sub = await emitAck(socket, 'room.subscribe', { roomId: lobby.roomId });
    expect(sub.ok).toBe(false);
    expect(sub.error!.code).toBe('NOT_FOUND');
    // There is no client event that joins an arbitrary Socket.IO room.
    socket.emit('join', `stream:${randomUUID()}`);
    await api.admin.query('SELECT 1');
    expect(events).toHaveLength(0);
  });

  it('host dropout: offline presence, then the earliest connected player becomes host', async () => {
    const { host, guest, lobby, guestMemberId } = await lobbyWithGuest('rt_drop');
    const hostSocket = await rt.open(host.client);
    const guestSocket = await rt.open(guest.client);
    const guestEvents = collectEvents(guestSocket);
    await emitAck(hostSocket, 'room.subscribe', { roomId: lobby.roomId });
    await emitAck(guestSocket, 'room.subscribe', { roomId: lobby.roomId });

    hostSocket.close();
    await waitFor(() =>
      guestEvents.some((e) => e.type === 'presence.changed' && e.payload.status === 'offline'),
    );
    const job = await api.admin.query(
      `SELECT 1 FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'room.host_absent'`,
      [lobby.roomId],
    );
    expect(job.rowCount).toBe(1);
    // Fast-forward the 60-second absence clock and run the durable worker.
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() WHERE room_id = $1 AND kind = 'room.host_absent'`,
      [lobby.roomId],
    );
    await runDuePass(api.pool, api.deps.rooms.deadlines, rt.outbox.wake);
    await waitFor(() => guestEvents.some((e) => e.type === 'room.hostTransferred'));
    expect(guestEvents.find((e) => e.type === 'room.hostTransferred')!.payload).toMatchObject({
      hostId: guestMemberId,
      reason: 'host_absent',
    });
  });

  it('a host who reconnects within the window keeps the room', async () => {
    const { host, lobby } = await lobbyWithGuest('rt_back');
    const first = await rt.open(host.client);
    await emitAck(first, 'room.subscribe', { roomId: lobby.roomId });
    first.close();
    await waitFor(() => false, 0).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    const again = await rt.open(host.client);
    await emitAck(again, 'room.subscribe', { roomId: lobby.roomId });
    const job = await api.admin.query(
      `SELECT 1 FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'room.host_absent'`,
      [lobby.roomId],
    );
    expect(job.rowCount).toBe(0);
  });

  it('duplicate tabs are read-only until an explicit fenced takeover (E25)', async () => {
    const { host, lobby } = await lobbyWithGuest('rt_tabs');
    const tabA = await rt.open(host.client);
    const tabB = await rt.open(host.client.clone());
    const a = await emitAck<PermittedSnapshotDTO>(tabA, 'room.subscribe', { roomId: lobby.roomId });
    const b = await emitAck<PermittedSnapshotDTO>(tabB, 'room.subscribe', { roomId: lobby.roomId });
    expect(a.data!.me.isController).toBe(true);
    expect(b.data!.me.isController).toBe(false);

    const command = (epoch: string) => ({
      type: 'room.host.accept',
      commandId: randomUUID(),
      roomId: lobby.roomId,
      expectedVersion: a.data!.room.stateVersion,
      controlEpoch: epoch,
      payload: { handoverId: randomUUID() },
    });
    const fromB = await emitAck(tabB, 'game.command', command(b.data!.me.controlEpoch));
    expect(fromB.error!.code).toBe('CONTROL_EPOCH_STALE');

    const take = await emitAck<{ newEpoch: string }>(tabB, 'room.control.take', {
      roomId: lobby.roomId,
      currentEpoch: b.data!.me.controlEpoch,
      commandId: randomUUID(),
    });
    expect(take.ok, JSON.stringify(take)).toBe(true);
    const fromA = await emitAck(tabA, 'game.command', command(a.data!.me.controlEpoch));
    expect(fromA.error!.code).toBe('CONTROL_EPOCH_STALE');
    // Tab B now reaches the handler (which rejects the unknown handover on its own merits).
    const fromBNow = await emitAck(tabB, 'game.command', command(take.data!.newEpoch));
    expect(fromBNow.error!.code).toBe('STATE_CONFLICT');
  });

  it('kick evicts the member’s sockets immediately', async () => {
    const { host, guest, lobby, guestMemberId } = await lobbyWithGuest('rt_kick');
    const guestSocket = await rt.open(guest.client);
    await emitAck(guestSocket, 'room.subscribe', { roomId: lobby.roomId });
    const removed = new Promise<{ roomId: string }>((resolve) =>
      guestSocket.once('room.removed', resolve),
    );
    await host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/kick`, { memberId: guestMemberId });
    expect((await removed).roomId).toBe(lobby.roomId);
  });
});
