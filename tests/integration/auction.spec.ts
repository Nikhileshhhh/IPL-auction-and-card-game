import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuctionSetupSnapshotSchema,
  SquadDTOSchema,
  type AuctionSetupSnapshot,
  type PermittedSnapshotDTO,
  type RoomLobbyDTO,
} from '@stumps/contracts';
import { CRORE, IPL_MEGA_RULES_2025_27 } from '@stumps/game-engines';
import {
  ACCESS_CODE,
  createTestApi,
  onboardMember,
  type BffClient,
  type TestApi,
} from '../support/api';
import { publishDemoPack } from '../support/cards';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_auction');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api); // publishing the demo pack also publishes its auction pool
}, 120_000);
afterAll(async () => api?.close());

type Snap = PermittedSnapshotDTO & { game: AuctionSetupSnapshot | null };

async function snapshot(client: BffClient, roomId: string): Promise<Snap> {
  const res = await client.request<Snap>('GET', `/v1/rooms/${roomId}/snapshot`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data!;
}

async function setup(client: BffClient, roomId: string): Promise<AuctionSetupSnapshot> {
  return AuctionSetupSnapshotSchema.parse((await snapshot(client, roomId)).game);
}

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

/** A host and `guests` members in a new auction room. */
async function auctionRoom(tag: string, guests: number, settings: Record<string, unknown> = {}) {
  const host = await onboardMember(api, `${tag}_h`);
  const created = await host.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
    'POST',
    '/v1/rooms',
    {
      gameType: 'auction',
      name: 'Auction night',
      settings: { franchiseCount: 4, collaboratorsPerFranchise: 3, ...settings },
    },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const { lobby, roomCode } = created.body.data!;
  const others: BffClient[] = [];
  for (let i = 0; i < guests; i += 1) {
    const g = await onboardMember(api, `${tag}_${i}`);
    const joined = await g.client.mutate('POST', '/v1/rooms/join', {
      code: roomCode,
      gameType: 'auction',
    });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    others.push(g.client);
  }
  return {
    roomId: lobby.roomId,
    host: host.client,
    guests: others,
    configVersion: lobby.configVersion,
  };
}

const claim = (client: BffClient, roomId: string, franchiseDefinitionId: string) =>
  command(client, roomId, 'auction.claimFranchise', { franchiseDefinitionId });

/** The franchise with the most previous-squad players (rich retention choices). */
const biggest = (s: AuctionSetupSnapshot) =>
  [...s.teams].sort((a, b) => b.previousSquadCount - a.previousSquadCount);

describe('auction room setup (ADR-024)', () => {
  it('binds the published real-rules pool and opens franchise selection', async () => {
    const { roomId, host } = await auctionRoom('au_bind', 0);
    const s = await setup(host, roomId);
    expect(s.phase).toBe('FRANCHISE_SELECTION');
    expect(s.format).toBe('retention');
    expect(s.rules.name).toBe('IPL_MEGA_RULES_2025_27');
    expect(s.rules.purseRupees).toBe(String(120n * CRORE));
    expect(s.rules.cappedSlabsRupees).toEqual(
      IPL_MEGA_RULES_2025_27.retention.cappedSlabs.map(String),
    );
    expect(s.rules.provenance.purse).toBe('official');
    expect(s.dataKind).toBe('demo');
    expect(s.teams.length).toBeGreaterThanOrEqual(4);
    expect(s.teams.every((t) => t.teamId === null)).toBe(true);
    expect(s.pool.total).toBeGreaterThanOrEqual(72);
    expect(s.myAllowedActions).toEqual(
      expect.arrayContaining(['auction.claimFranchise', 'auction.franchiseSelection.close']),
    );
    const room = await api.admin.query<{ ruleset_id: string; data_version_id: string }>(
      'SELECT ruleset_id, data_version_id FROM app_private.rooms WHERE id = $1',
      [roomId],
    );
    expect(room.rows[0]!.ruleset_id).toBeTruthy();
    expect(room.rows[0]!.data_version_id).toBeTruthy();
  });

  it('concurrent claims of one franchise: exactly one wins, the other gets FRANCHISE_TAKEN', async () => {
    const { roomId, host, guests } = await auctionRoom('au_race', 1);
    const target = biggest(await setup(host, roomId))[0]!.franchiseDefinitionId;
    const results = await Promise.all([
      claim(host, roomId, target),
      claim(guests[0]!, roomId, target),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error!.code).toBe('FRANCHISE_TAKEN');
    const s = await setup(host, roomId);
    const team = s.teams.find((t) => t.franchiseDefinitionId === target)!;
    expect(team.teamId).not.toBeNull();
    expect(team.memberCount).toBe(1);
    // The captain is whoever claimed; one team per member.
    const winner = results[0]!.status === 200 ? host : guests[0]!;
    const other = biggest(s).find((t) => t.teamId === null)!.franchiseDefinitionId;
    const second = await claim(winner, roomId, other);
    expect(second.status).toBe(409);
    expect(second.body.error!.details).toMatchObject({ reason: 'ALREADY_ON_TEAM' });
  });

  it('join by team code needs captain approval; only team members read the team stream', async () => {
    const { roomId, host, guests } = await auctionRoom('au_join', 2);
    const [mate, outsider] = guests as [BffClient, BffClient];
    const target = biggest(await setup(host, roomId))[0]!.franchiseDefinitionId;
    expect((await claim(host, roomId, target)).status).toBe(200);
    const captainView = await setup(host, roomId);
    const code = captainView.myTeam!.joinCode!;
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const wrong = await command(mate, roomId, 'team.requestJoin', {
      franchiseCode: 'AAAA-AAAA-AAAA',
    });
    expect(wrong.status).toBe(404);
    const asked = await command(mate, roomId, 'team.requestJoin', { franchiseCode: code });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const requestId = asked.body.data!.requestId as string;
    // A code is a request, not membership.
    expect((await setup(mate, roomId)).myTeam).toBeNull();
    expect((await setup(mate, roomId)).myRequest?.requestId).toBe(requestId);
    // Nobody but the captain may decide.
    const notCaptain = await command(outsider, roomId, 'team.decideJoin', {
      requestId,
      approve: true,
    });
    expect(notCaptain.status).toBe(403);
    expect((await setup(host, roomId)).myTeam!.requests.map((r) => r.requestId)).toEqual([
      requestId,
    ]);
    const approved = await command(host, roomId, 'team.decideJoin', { requestId, approve: true });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data).toEqual({ decision: 'approved' });

    const mateView = await setup(mate, roomId);
    expect(mateView.myTeam!.role).toBe('advisor');
    expect(mateView.myTeam!.capabilities.bid).toBe(false); // bidding rights: phase 11
    expect(mateView.myTeam!.joinCode).toBeNull(); // only captain and inviters see the code
    const teamStream = await api.admin.query<{ id: string }>(
      `SELECT id FROM app_private.room_streams WHERE room_id = $1 AND audience_kind = 'team'`,
      [roomId],
    );
    const streamId = teamStream.rows[0]!.id;
    expect((await snapshot(mate, roomId)).cursors.map((c) => c.streamId)).toContain(streamId);
    expect((await snapshot(outsider, roomId)).cursors.map((c) => c.streamId)).not.toContain(
      streamId,
    );
    const replay = (c: BffClient) =>
      c.request('GET', `/v1/rooms/${roomId}/events?streamId=${streamId}&afterSeq=0`);
    expect((await replay(mate)).status).toBe(200);
    expect((await replay(outsider)).status).toBe(404); // concealed
  });

  it('only the host closes franchise selection, and only with two teams', async () => {
    const { roomId, host, guests } = await auctionRoom('au_close', 1);
    const teams = biggest(await setup(host, roomId));
    expect((await command(host, roomId, 'auction.franchiseSelection.close', {})).status).toBe(409);
    await claim(host, roomId, teams[0]!.franchiseDefinitionId);
    await claim(guests[0]!, roomId, teams[1]!.franchiseDefinitionId);
    expect((await command(guests[0]!, roomId, 'auction.franchiseSelection.close', {})).status).toBe(
      403,
    );
    const closed = await command(host, roomId, 'auction.franchiseSelection.close', {});
    expect(closed.body.data).toEqual({ phase: 'RETENTION' });
    expect((await claim(host, roomId, teams[2]!.franchiseDefinitionId)).status).toBe(409);
  });
});

describe('retentions (rules §8, real IPL charge model)', () => {
  async function retentionRoom(tag: string) {
    const r = await auctionRoom(tag, 1);
    const teams = biggest(await setup(r.host, r.roomId));
    await claim(r.host, r.roomId, teams[0]!.franchiseDefinitionId);
    await claim(r.guests[0]!, r.roomId, teams[1]!.franchiseDefinitionId);
    await command(r.host, r.roomId, 'auction.franchiseSelection.close', {});
    return r;
  }

  it('validates, prices and locks a package; purses are deterministic and conserved', async () => {
    const { roomId, host, guests, configVersion } = await retentionRoom('au_ret');
    const mine = (await setup(host, roomId)).myTeam!;
    const rival = (await setup(guests[0]!, roomId)).myTeam!;
    const capped = mine.eligible.filter((p) => p.cappedStatus === 'capped');
    const uncapped = mine.eligible.filter((p) => p.cappedStatus === 'uncapped');
    expect(capped.length).toBeGreaterThanOrEqual(2);
    for (const p of mine.eligible) expect(p.portraitUrl).toBeTruthy(); // ADR-017

    // Someone else's player (foreign identity) is refused.
    const foreign = await command(host, roomId, 'auction.retention.propose', {
      playersAndAllocations: [{ playerId: rival.eligible[0]!.playerId, salaryRupees: '0' }],
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error!.code).toBe('RETENTION_INVALID');
    expect(JSON.stringify(foreign.body.error!.details)).toContain('FOREIGN_IDENTITY');
    // Advisors cannot propose; only the captain or a delegate.
    const picks = [
      { playerId: capped[0]!.playerId, salaryRupees: String(15n * CRORE) },
      { playerId: capped[1]!.playerId, salaryRupees: '0' },
      ...(uncapped[0] ? [{ playerId: uncapped[0].playerId, salaryRupees: '0' }] : []),
    ];
    const proposed = await command(host, roomId, 'auction.retention.propose', {
      playersAndAllocations: picks,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    const pkg = (await setup(host, roomId)).myTeam!.package!;
    // Two capped at the slabs (18 + 14 = 32 cr ≥ 15 cr negotiated) plus 4 cr per uncapped.
    const expected = 32n * CRORE + (uncapped[0] ? 4n * CRORE : 0n);
    expect(pkg.totalChargeRupees).toBe(String(expected));
    expect(pkg.lines.reduce((s, l) => s + BigInt(l.allocatedRupees), 0n)).toBe(expected);
    expect(pkg.remainingPurseRupees).toBe(String(120n * CRORE - expected));
    expect(pkg.rtmCards.total).toBe(6 - picks.length);
    // A rival cannot see our draft; the public view shows a draft but no players.
    const rivalView = await setup(guests[0]!, roomId);
    expect(JSON.stringify(rivalView)).not.toContain(capped[0]!.playerId);

    const stale = await command(host, roomId, 'auction.retention.lock', {
      packageId: pkg.packageId,
      version: '999',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error!.code).toBe('VERSION_CONFLICT');
    const locked = await command(host, roomId, 'auction.retention.lock', {
      packageId: pkg.packageId,
      version: pkg.version,
    });
    expect(locked.status, JSON.stringify(locked.body)).toBe(200);
    expect(locked.body.data).toMatchObject({
      cost: String(expected),
      purse: String(120n * CRORE - expected),
    });

    const row = await api.admin.query<{
      initial: string;
      remaining: string;
      charge: string;
      sum: string;
    }>(
      `SELECT f.initial_purse::text AS initial, f.remaining_purse::text AS remaining,
              f.retention_charge::text AS charge,
              (SELECT sum(charged_price)::text FROM app_private.auction_acquisitions a WHERE a.auction_franchise_id = f.id) AS sum
         FROM app_private.auction_franchises f WHERE f.id = $1`,
      [mine.teamId],
    );
    expect(row.rows[0]).toEqual({
      initial: String(120n * CRORE),
      remaining: String(120n * CRORE - expected),
      charge: String(expected),
      sum: String(expected),
    });
    const retained = await api.admin.query(
      `SELECT 1 FROM app_private.auction_pool WHERE room_id = $1 AND status = 'retained'`,
      [roomId],
    );
    expect(retained.rowCount).toBe(picks.length);
    // Public purse projection.
    const publicTeam = (await setup(guests[0]!, roomId)).teams.find(
      (t) => t.teamId === mine.teamId,
    )!;
    expect(publicTeam).toMatchObject({
      retention: 'locked',
      retainedCount: picks.length,
      remainingPurseRupees: String(120n * CRORE - expected),
    });
    // The squad view (S22).
    const squad = await guests[0]!.request(
      'GET',
      `/v1/rooms/${roomId}/franchises/${mine.teamId}/squad`,
    );
    const dto = SquadDTOSchema.parse(squad.body.data);
    expect(dto.rosterCount).toBe(picks.length);
    expect(dto.deficits).toEqual([`Need ${18 - picks.length} more players`]);

    // Starting needs every team locked first.
    for (const c of [host, guests[0]!]) {
      await c.mutate('POST', `/v1/rooms/${roomId}/ready`, { ready: true, configVersion });
    }
    const early = await host.mutate('POST', `/v1/rooms/${roomId}/start`, { configVersion });
    expect(early.body.error!.code).toBe('NOT_READY');
    expect(early.body.error!.details).toMatchObject({ reason: 'SETUP_INCOMPLETE' });

    // The rival keeps nobody: an empty package still has to be locked.
    await command(guests[0]!, roomId, 'auction.retention.propose', { playersAndAllocations: [] });
    const rivalPkg = (await setup(guests[0]!, roomId)).myTeam!.package!;
    expect(rivalPkg.rtmCards.total).toBe(6);
    const rivalLock = await command(guests[0]!, roomId, 'auction.retention.lock', {
      packageId: rivalPkg.packageId,
      version: rivalPkg.version,
    });
    expect(rivalLock.status).toBe(200);
    expect((await setup(host, roomId)).phase).toBe('AUCTION_LOBBY');
    const events = await api.admin.query<{ type: string }>(
      `SELECT e.type FROM app_private.room_events e JOIN app_private.room_streams s ON s.id = e.stream_id
        WHERE e.room_id = $1 AND s.audience_kind = 'public' AND e.type LIKE 'auction.%' ORDER BY e.seq`,
      [roomId],
    );
    expect(events.rows.map((e) => e.type)).toEqual([
      'auction.setupPhaseChanged',
      'auction.retentionLocked',
      'auction.retentionLocked',
      'auction.setupPhaseChanged',
    ]);
    // With every roster locked, the host starts the live auction (phase 10).
    for (const c of [host, guests[0]!]) {
      await c.mutate('POST', `/v1/rooms/${roomId}/ready`, { ready: true, configVersion });
    }
    const start = await host.mutate('POST', `/v1/rooms/${roomId}/start`, { configVersion });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const started = await snapshot(host, roomId);
    expect(started.room.lifecycle).toBe('RUNNING');
    expect((started.game as unknown as { kind: string }).kind).toBe('auction-live');
  });

  it('enforces the retention caps and the purse needed to fill a squad', async () => {
    const { roomId, host } = await retentionRoom('au_caps');
    const mine = (await setup(host, roomId)).myTeam!;
    const capped = mine.eligible.filter((p) => p.cappedStatus === 'capped');
    if (capped.length >= 6) {
      const tooMany = await command(host, roomId, 'auction.retention.propose', {
        playersAndAllocations: capped
          .slice(0, 6)
          .map((p) => ({ playerId: p.playerId, salaryRupees: '0' })),
      });
      expect(JSON.stringify(tooMany.body.error!.details)).toContain('TOO_MANY_CAPPED');
    }
    const overspend = await command(host, roomId, 'auction.retention.propose', {
      playersAndAllocations: [
        { playerId: capped[0]!.playerId, salaryRupees: String(119n * CRORE) },
      ],
    });
    expect(overspend.status).toBe(422);
    expect(JSON.stringify(overspend.body.error!.details)).toContain('PURSE_INVALID');
  });

  it('the purse conservation trigger refuses a direct purse edit', async () => {
    const { roomId, host } = await retentionRoom('au_purse');
    const teamId = (await setup(host, roomId)).myTeam!.teamId;
    await expect(
      api.admin.query(
        `UPDATE app_private.auction_franchises SET remaining_purse = remaining_purse - 1 WHERE id = $1`,
        [teamId],
      ),
    ).rejects.toThrow(/purse not conserved/);
  });
});

describe('fresh reset format', () => {
  it('skips retentions: no packages, no RTM cards, straight to the auction lobby', async () => {
    const { roomId, host, guests } = await auctionRoom('au_fresh', 1, { format: 'fresh' });
    const teams = biggest(await setup(host, roomId));
    await claim(host, roomId, teams[0]!.franchiseDefinitionId);
    await claim(guests[0]!, roomId, teams[1]!.franchiseDefinitionId);
    const closed = await command(host, roomId, 'auction.franchiseSelection.close', {});
    expect(closed.body.data).toEqual({ phase: 'AUCTION_LOBBY' });
    const s = await setup(host, roomId);
    expect(s.myTeam!.eligible).toEqual([]);
    const propose = await command(host, roomId, 'auction.retention.propose', {
      playersAndAllocations: [],
    });
    expect(propose.status).toBe(409);
  });
});
