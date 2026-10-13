import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  AuctionLiveSnapshotSchema,
  AuctionSetupSnapshotSchema,
  type AuctionLiveSnapshot,
  type AuctionSetupSnapshot,
  type PermittedSnapshotDTO,
  type RoomLobbyDTO,
} from '@stumps/contracts';
import { runDuePass } from '../../apps/server/src/jobs/deadlines';
import { onboardMember, type BffClient, type TestApi } from './api';

/**
 * Live auction helpers (phase 10). Timers are driven by making jobs and lot
 * deadlines due in the database, then running the real due pass.
 */

export type Snap = PermittedSnapshotDTO & { game: unknown };

export function auctionHelpers(apiOf: () => TestApi) {
  type Snap = PermittedSnapshotDTO & { game: unknown };

  async function snapshot(client: BffClient, roomId: string): Promise<Snap> {
    const res = await client.request<Snap>('GET', `/v1/rooms/${roomId}/snapshot`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data!;
  }
  const setup = async (c: BffClient, roomId: string): Promise<AuctionSetupSnapshot> =>
    AuctionSetupSnapshotSchema.parse((await snapshot(c, roomId)).game);
  const live = async (c: BffClient, roomId: string): Promise<AuctionLiveSnapshot> =>
    AuctionLiveSnapshotSchema.parse((await snapshot(c, roomId)).game);

  async function command(
    client: BffClient,
    roomId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const snap = await snapshot(client, roomId);
    return client.mutate<Record<string, unknown>>('POST', `/v1/rooms/${roomId}/commands`, {
      type,
      commandId: randomUUID(),
      roomId,
      expectedVersion: snap.room.stateVersion,
      controlEpoch: snap.me.controlEpoch,
      payload,
    });
  }

  const duePass = () => runDuePass(apiOf().pool, apiOf().deps.rooms.deadlines, () => undefined);

  /** Make the open lot's clock (and its job) due now, then run the due pass. */
  async function expireLot(roomId: string) {
    await apiOf().admin.query(
      `UPDATE app_private.auction_nominations SET deadline = now() - interval '1 second'
        WHERE room_id = $1 AND status = 'open'`,
      [roomId],
    );
    await apiOf().admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind IN ('auction.bidding_deadline', 'auction.rtm_deadline')`,
      [roomId],
    );
    await duePass();
  }

  /** Skip the gap between lots. */
  async function nextLot(roomId: string) {
    await apiOf().admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'auction.next_lot'`,
      [roomId],
    );
    await duePass();
  }

  /** Two teams (host and guest captains) in a started auction. */
  async function startedAuction(tag: string, format: 'retention' | 'fresh' = 'fresh') {
    const host = await onboardMember(apiOf(), `${tag}_h`);
    const guest = await onboardMember(apiOf(), `${tag}_g`);
    const created = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
      'POST',
      '/v1/rooms',
      {
        gameType: 'auction',
        name: 'Auction night',
        settings: { franchiseCount: 2, collaboratorsPerFranchise: 2, format },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { lobby, roomCode } = created.body.data!;
    const roomId = lobby.roomId;
    await guest.client.mutate('POST', '/v1/rooms/join', { code: roomCode, gameType: 'auction' });
    const teams = [...(await setup(host.client, roomId)).teams].sort(
      (a, b) => b.previousSquadCount - a.previousSquadCount,
    );
    for (const [i, c] of [host.client, guest.client].entries()) {
      const res = await command(c, roomId, 'auction.claimFranchise', {
        franchiseDefinitionId: teams[i]!.franchiseDefinitionId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(
      (await command(host.client, roomId, 'auction.franchiseSelection.close', {})).status,
    ).toBe(200);
    if (format === 'retention') {
      for (const c of [host.client, guest.client]) {
        await command(c, roomId, 'auction.retention.propose', { playersAndAllocations: [] });
        const pkg = (await setup(c, roomId)).myTeam!.package!;
        const locked = await command(c, roomId, 'auction.retention.lock', {
          packageId: pkg.packageId,
          version: pkg.version,
        });
        expect(locked.status, JSON.stringify(locked.body)).toBe(200);
      }
    }
    const configVersion = (await snapshot(host.client, roomId)).room.configVersion;
    for (const c of [host.client, guest.client]) {
      await c.mutate('POST', `/v1/rooms/${roomId}/ready`, { ready: true, configVersion });
    }
    const start = await host.client.mutate('POST', `/v1/rooms/${roomId}/start`, { configVersion });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const view = await live(host.client, roomId);
    const teamOf = async (c: BffClient) => (await live(c, roomId)).myTeamId!;
    return {
      roomId,
      host: host.client,
      guest: guest.client,
      hostTeam: await teamOf(host.client),
      guestTeam: await teamOf(guest.client),
      view,
    };
  }

  /** Bid the exact next legal amount, as a client does after a STALE_BID tells it the price. */
  async function bid(client: BffClient, roomId: string) {
    const s = await live(client, roomId);
    const send = (amountRupees: string, nominationVersion: string) =>
      command(client, roomId, 'auction.bid', {
        nominationId: s.lot!.id,
        nominationVersion,
        amountRupees,
      });
    if (s.lot!.ownLegalNextBidRupees) return send(s.lot!.ownLegalNextBidRupees, s.lot!.bidVersion);
    const probe = await send(s.lot!.basePriceRupees, s.lot!.bidVersion);
    if (probe.body.error?.code !== 'STALE_BID') return probe;
    const d = probe.body.error.details as { nextAmountRupees: string; nominationVersion: string };
    return send(d.nextAmountRupees, d.nominationVersion);
  }

  async function publicEvents(roomId: string, prefix = 'auction.') {
    const res = await apiOf().admin.query<{ type: string; payload: Record<string, unknown> }>(
      `SELECT e.type, e.payload FROM app_private.room_events e
         JOIN app_private.room_streams s ON s.id = e.stream_id
        WHERE e.room_id = $1 AND s.audience_kind = 'public' AND e.type LIKE $2 ORDER BY e.seq`,
      [roomId, `${prefix}%`],
    );
    return res.rows;
  }

  async function acquisitions(roomId: string) {
    const res = await apiOf().admin.query<{
      player_id: string;
      auction_franchise_id: string;
      kind: string;
      charged_price: string;
    }>(
      `SELECT player_id, auction_franchise_id, kind, charged_price::text
         FROM app_private.auction_acquisitions WHERE room_id = $1 AND kind <> 'retention'`,
      [roomId],
    );
    return res.rows;
  }

  return {
    snapshot,
    setup,
    live,
    command,
    duePass,
    expireLot,
    nextLot,
    startedAuction,
    bid,
    publicEvents,
    acquisitions,
  };
}
