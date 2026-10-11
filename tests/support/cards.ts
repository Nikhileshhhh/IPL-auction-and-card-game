import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import type {
  PermittedCardSnapshotDTO,
  PermittedSnapshotDTO,
  RoomLobbyDTO,
} from '@stumps/contracts';
import { publishVersion } from '../../apps/server/src/modules/cricket-data/publish';
import { importStatus, startImport } from '../../apps/server/src/modules/cricket-data/service';
import { LocalDiskStorage } from '../../apps/server/src/modules/media/storage';
import { onboardMember, type BffClient, type TestApi } from './api';

/** Import and publish the fictional demo pack (portraits included) into a test database. */
export async function publishDemoPack(api: TestApi) {
  const job = await startImport(
    {
      pool: api.pool,
      storage: new LocalDiskStorage(join(tmpdir(), 'stumps-test-media', api.dbName)),
      cricsheetDir: 'unused',
    },
    { kind: 'demo', label: 'Demo pack' },
    null,
  );
  await job.done;
  const status = await importStatus(api.pool, job.importId);
  expect(status.status).toBe('succeeded');
  await publishVersion(api.pool, status.dataVersionId!, { prune: false, actorId: null });
}

export interface Player {
  client: BffClient;
  memberId: string;
}

export type Snap = PermittedSnapshotDTO & { game: PermittedCardSnapshotDTO | null };

/** Card-match helpers bound to a lazily created test API. */
export function cardHelpers(apiOf: () => TestApi) {
  async function snapshot(client: BffClient, roomId: string): Promise<Snap> {
    const res = await client.request<Snap>('GET', `/v1/rooms/${roomId}/snapshot`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data!;
  }

  /** Two onboarded players in a started card room. */
  async function startedMatch(tag: string, settings: Record<string, unknown> = {}) {
    const host = await onboardMember(apiOf(), `${tag}_h`);
    const guest = await onboardMember(apiOf(), `${tag}_g`);
    const created = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
      'POST',
      '/v1/rooms',
      {
        gameType: 'card',
        name: 'Arena',
        settings: { maxPlayers: 2, totalCards: 8, selectionSeconds: 10, ...settings },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { lobby, roomCode } = created.body.data!;
    const joined = await guest.client.mutate<RoomLobbyDTO>('POST', '/v1/rooms/join', {
      code: roomCode,
      gameType: 'card',
    });
    for (const c of [host.client, guest.client]) {
      await c.mutate('POST', `/v1/rooms/${lobby.roomId}/ready`, {
        ready: true,
        configVersion: lobby.configVersion,
      });
    }
    const started = await host.client.mutate('POST', `/v1/rooms/${lobby.roomId}/start`, {
      configVersion: lobby.configVersion,
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const players: Player[] = [
      { client: host.client, memberId: lobby.myMembershipId },
      { client: guest.client, memberId: joined.body.data!.myMembershipId },
    ];
    return { roomId: lobby.roomId, players };
  }

  async function command(
    client: BffClient,
    roomId: string,
    payload: Record<string, unknown>,
    options: { commandId?: string; expectedVersion?: string; type?: string } = {},
  ) {
    const snap = await snapshot(client, roomId);
    return client.mutate<{ stateVersion: string }>('POST', `/v1/rooms/${roomId}/commands`, {
      type: options.type ?? 'card.selectCategory',
      commandId: options.commandId ?? randomUUID(),
      roomId,
      expectedVersion: options.expectedVersion ?? snap.room.stateVersion,
      controlEpoch: snap.me.controlEpoch,
      payload,
    });
  }

  const selectorOf = (players: Player[], game: PermittedCardSnapshotDTO) =>
    players.find((p) => p.memberId === game.selectorSeat)!;

  async function publicEvents(roomId: string) {
    const res = await apiOf().admin.query<{
      type: string;
      state_version: string;
      payload: unknown;
    }>(
      `SELECT e.type, e.state_version::text, e.payload FROM app_private.room_events e
       JOIN app_private.room_streams s ON s.id = e.stream_id
      WHERE e.room_id = $1 AND s.audience_kind = 'public' ORDER BY e.seq`,
      [roomId],
    );
    return res.rows;
  }

  return { snapshot, startedMatch, command, selectorOf, publicEvents };
}
