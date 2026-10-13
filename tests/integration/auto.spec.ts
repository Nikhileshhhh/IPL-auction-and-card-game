import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADVISOR_CAPABILITIES,
  AutoViewSchema,
  type AutoStrategyInput,
  type TeamCapabilities,
  type TeamView,
} from '@stumps/contracts';
import { CoordinatorLease } from '../../apps/server/src/jobs/deadlines';
import { recoverAfterOutage } from '../../apps/server/src/jobs/recovery';
import {
  markDisconnected,
  sweepStaleConnections,
} from '../../apps/server/src/realtime/rooms-socket';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

/**
 * Reconnect, failover and safe automation (phase 12, ADR-027). Presence is
 * simulated with connection rows; timers are made due and run by the real
 * due pass.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_auto');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, live, command, startedAuction, expireLot, nextLot, duePass, bid } =
  auctionHelpers(() => api);

const deps = () => ({ pool: api.pool, rooms: api.deps.rooms.deps });
const memberId = async (c: BffClient, roomId: string) => (await snapshot(c, roomId)).me.memberId;

/** A live tab for a member (what a Socket.IO subscription records). */
async function connect(roomId: string, member: string) {
  const socketId = `test-${randomUUID()}`;
  await api.admin.query(
    `INSERT INTO app_private.room_connections (room_id, member_id, socket_id, instance_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
    [roomId, member, socketId, randomUUID()],
  );
  return socketId;
}

/** The 30-second grace passes for the team's absence check, then the due pass runs. */
async function graceElapses(roomId: string) {
  await api.admin.query(
    `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
      WHERE room_id = $1 AND kind = 'auction.team_absence'`,
    [roomId],
  );
  await duePass();
}

/** Run any automated attempts that are scheduled. */
async function botsRun(roomId: string) {
  await api.admin.query(
    `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
      WHERE room_id = $1 AND kind IN ('auction.auto_bid', 'auction.auto_rtm')`,
    [roomId],
  );
  await duePass();
}

const strategy = (over: Partial<AutoStrategyInput> = {}): AutoStrategyInput => ({
  enabled: true,
  targetLimits: [],
  roleLimits: {},
  totalAutoCapRupees: '500000000',
  maxAutoPurchases: 5,
  minReserveRupees: '0',
  allowRTM: false,
  rtmCeilingRupees: null,
  ...over,
});

async function configure(c: BffClient, roomId: string, s: AutoStrategyInput, version = '0') {
  return command(c, roomId, 'team.auto.configure', { strategy: s, version });
}

async function view(c: BffClient, roomId: string, teamId: string) {
  const res = await c.request('GET', `/v1/rooms/${roomId}/franchises/${teamId}/strategy`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return AutoViewSchema.parse(res.body.data);
}

const controlOf = async (c: BffClient, roomId: string, teamId: string) =>
  (await live(c, roomId)).teams.find((t) => t.teamId === teamId)!.control;

async function autoBids(roomId: string) {
  return (
    await api.admin.query<{ amount: string; auction_franchise_id: string }>(
      `SELECT amount::text, auction_franchise_id FROM app_private.auction_bids
        WHERE room_id = $1 AND actor_type = 'auto' ORDER BY accepted_at, bid_version`,
      [roomId],
    )
  ).rows;
}

async function joinTeam(
  roomId: string,
  captain: BffClient,
  mate: BffClient,
  role: 'advisor' | 'bidder' | 'cocaptain',
  capabilities: TeamCapabilities,
) {
  const code = (await captain.request<TeamView>('GET', `/v1/rooms/${roomId}/team`)).body.data!
    .joinCode;
  const asked = await command(mate, roomId, 'team.requestJoin', { franchiseCode: code });
  await command(captain, roomId, 'team.decideJoin', {
    requestId: asked.body.data!.requestId,
    approve: true,
    role,
    capabilities,
  });
}

describe('automated limits are private and versioned', () => {
  it('only the captain or a limits manager configures; other teams cannot read them', async () => {
    const ctx = await startedAuction('au_cfg', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        await joinTeam(roomId, host, mates[0]!, 'advisor', ADVISOR_CAPABILITIES);
      },
    });
    const [mate] = ctx.mates as [BffClient];
    expect((await configure(mate, ctx.roomId, strategy())).status).toBe(403);
    const first = await configure(ctx.host, ctx.roomId, strategy());
    expect(first.body.data).toEqual({ strategyVersion: '1' });
    const stale = await configure(ctx.host, ctx.roomId, strategy({ maxAutoPurchases: 2 }));
    expect(stale.body.error!.code).toBe('VERSION_CONFLICT');
    expect(
      (await configure(ctx.host, ctx.roomId, strategy({ maxAutoPurchases: 2 }), '1')).body.data,
    ).toEqual({ strategyVersion: '2' });
    const mine = await view(mate, ctx.roomId, ctx.hostTeam);
    expect(mine.strategy).toMatchObject({ version: '2', maxAutoPurchases: 2, enabled: true });
    expect(mine.control.mode).toBe('MANUAL');
    expect(mine.canConfigure).toBe(false); // advisor
    const rival = await ctx.guest.request(
      'GET',
      `/v1/rooms/${ctx.roomId}/franchises/${ctx.hostTeam}/strategy`,
    );
    expect(rival.status).toBe(404);
  });
});

describe('failover when every authorised bidder is away', () => {
  it('an offline captain alone does not start the bot while another bidder is connected', async () => {
    let mateId = '';
    const ctx = await startedAuction('au_stay', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        await joinTeam(roomId, host, mates[0]!, 'bidder', { ...ADVISOR_CAPABILITIES, bid: true });
        mateId = await memberId(mates[0]!, roomId);
      },
    });
    await configure(ctx.host, ctx.roomId, strategy());
    const hostTab = await connect(ctx.roomId, await memberId(ctx.host, ctx.roomId));
    await connect(ctx.roomId, mateId);
    await markDisconnected(deps(), hostTab);
    await graceElapses(ctx.roomId);
    expect(await controlOf(ctx.guest, ctx.roomId, ctx.hostTeam)).toBe('MANUAL');
  });

  it('a connected co-captain takes control; when they go too and there is no strategy, the team observes', async () => {
    let coId = '';
    const ctx = await startedAuction('au_co', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        await joinTeam(roomId, host, mates[0]!, 'cocaptain', ADVISOR_CAPABILITIES);
        coId = await memberId(mates[0]!, roomId);
      },
    });
    const [co] = ctx.mates as [BffClient];
    const hostTab = await connect(ctx.roomId, await memberId(ctx.host, ctx.roomId));
    const coTab = await connect(ctx.roomId, coId);
    await markDisconnected(deps(), hostTab);
    await graceElapses(ctx.roomId);
    expect(await controlOf(ctx.guest, ctx.roomId, ctx.hostTeam)).toBe('FAILOVER');
    // The co-captain (without the bid right) may bid while holding control.
    expect((await live(co, ctx.roomId)).lot!.ownLegalNextBidRupees).not.toBeNull();
    expect((await bid(co, ctx.roomId)).status).toBe(200);
    await markDisconnected(deps(), coTab);
    await graceElapses(ctx.roomId);
    expect(await controlOf(ctx.guest, ctx.roomId, ctx.hostTeam)).toBe('OBSERVE');
    expect((await live(ctx.host, ctx.roomId)).lot!.ownRejectionReason).toBe('TEAM_NOT_MANUAL');
    expect((await view(ctx.host, ctx.roomId, ctx.hostTeam)).control).toMatchObject({
      mode: 'OBSERVE',
      reasonCode: 'NO_STRATEGY',
    });
    // Nothing is bid for an observing team.
    await botsRun(ctx.roomId);
    expect(await autoBids(ctx.roomId)).toEqual([]);
  });
});

describe('the bot', () => {
  it('bids only up to a named target’s ceiling, and people cannot bid until they resume', async () => {
    const ctx = await startedAuction('au_bot');
    const lot = (await live(ctx.host, ctx.roomId)).lot!;
    await configure(
      ctx.host,
      ctx.roomId,
      strategy({
        targetLimits: [{ playerId: lot.player.playerId, ceilingRupees: lot.basePriceRupees }],
      }),
    );
    const tab = await connect(ctx.roomId, await memberId(ctx.host, ctx.roomId));
    await markDisconnected(deps(), tab);
    await graceElapses(ctx.roomId);
    expect(await controlOf(ctx.guest, ctx.roomId, ctx.hostTeam)).toBe('AUTO');
    // A person on an automatic team is fenced.
    const human = await command(ctx.host, ctx.roomId, 'auction.bid', {
      nominationId: lot.id,
      nominationVersion: lot.bidVersion,
      amountRupees: lot.basePriceRupees,
    });
    expect(human.body.error!.details).toMatchObject({ reason: 'TEAM_NOT_MANUAL' });
    await botsRun(ctx.roomId);
    expect(await autoBids(ctx.roomId)).toEqual([
      { amount: lot.basePriceRupees, auction_franchise_id: ctx.hostTeam },
    ]);
    expect((await live(ctx.guest, ctx.roomId)).lotBids[0]).toMatchObject({ kind: 'normal' });
    // The rival goes above the ceiling: the bot passes and says why.
    expect((await bid(ctx.guest, ctx.roomId)).status).toBe(200);
    await botsRun(ctx.roomId);
    expect(await autoBids(ctx.roomId)).toHaveLength(1);
    const v = await view(ctx.host, ctx.roomId, ctx.hostTeam);
    expect(v.decisions[0]).toMatchObject({
      reasonCode: 'OVER_CEILING',
      decision: { action: 'PASS', playerName: lot.player.name },
      ceiling: lot.basePriceRupees,
    });
    expect(v.decisions[1]).toMatchObject({ reasonCode: 'BID', decision: { action: 'BID' } });
    expect(v.canTakeover).toBe(true);
  });

  it('never exceeds the total automated cap; purchases count once at the sale', async () => {
    const ctx = await startedAuction('au_cap');
    const first = (await live(ctx.host, ctx.roomId)).lot!;
    const roles = {
      batter: '200000000',
      bowler: '200000000',
      all_rounder: '200000000',
      wicketkeeper: '200000000',
    };
    await configure(
      ctx.host,
      ctx.roomId,
      strategy({ roleLimits: roles, totalAutoCapRupees: first.basePriceRupees }),
    );
    const tab = await connect(ctx.roomId, await memberId(ctx.host, ctx.roomId));
    await markDisconnected(deps(), tab);
    await graceElapses(ctx.roomId);
    await botsRun(ctx.roomId);
    await expireLot(ctx.roomId);
    const after = await view(ctx.host, ctx.roomId, ctx.hostTeam);
    expect(after.strategy).toMatchObject({
      spentAutoRupees: first.basePriceRupees,
      purchasesAuto: 1,
    });
    expect(after.autoPurchases).toEqual([
      expect.objectContaining({
        playerId: first.player.playerId,
        priceRupees: first.basePriceRupees,
      }),
    ]);
    // The cap is used up: on the next lot the bot passes with CAP_REACHED.
    await nextLot(ctx.roomId);
    await botsRun(ctx.roomId);
    expect(await autoBids(ctx.roomId)).toHaveLength(1);
    expect((await view(ctx.host, ctx.roomId, ctx.hostTeam)).decisions[0]).toMatchObject({
      reasonCode: 'CAP_REACHED',
    });
  });
});

describe('resuming manual control', () => {
  it('is fenced by the control epoch and cancels pending automated attempts', async () => {
    const ctx = await startedAuction('au_resume');
    const roles = {
      batter: '200000000',
      bowler: '200000000',
      all_rounder: '200000000',
      wicketkeeper: '200000000',
    };
    await configure(ctx.host, ctx.roomId, strategy({ roleLimits: roles }));
    const tab = await connect(ctx.roomId, await memberId(ctx.host, ctx.roomId));
    await markDisconnected(deps(), tab);
    await graceElapses(ctx.roomId);
    const auto = await view(ctx.host, ctx.roomId, ctx.hostTeam);
    expect(auto.control.mode).toBe('AUTO');
    // Changing limits while automatic is refused.
    const blocked = await configure(ctx.host, ctx.roomId, strategy(), auto.strategy!.version);
    expect(blocked.body.error!.details).toMatchObject({ reason: 'TAKE_OVER_FIRST' });
    const stale = await command(ctx.host, ctx.roomId, 'team.auto.takeover', {
      currentEpoch: String(Number(auto.control.epoch) - 1),
    });
    expect(stale.body.error!.code).toBe('CONTROL_EPOCH_STALE');
    // A takeover only ever concerns the sender's own team: the rival's is already manual.
    const rivalEpoch = (await view(ctx.guest, ctx.roomId, ctx.guestTeam)).control.epoch;
    const rival = await command(ctx.guest, ctx.roomId, 'team.auto.takeover', {
      currentEpoch: rivalEpoch,
    });
    expect(rival.body.error!.details).toMatchObject({ reason: 'ALREADY_MANUAL' });
    expect(await controlOf(ctx.guest, ctx.roomId, ctx.hostTeam)).toBe('AUTO');
    // Reconnect race: the resume and a due bot attempt land together.
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'auction.auto_bid'`,
      [ctx.roomId],
    );
    const [resume] = await Promise.all([
      command(ctx.host, ctx.roomId, 'team.auto.takeover', { currentEpoch: auto.control.epoch }),
      duePass(),
    ]);
    expect(resume.status, JSON.stringify(resume.body)).toBe(200);
    expect(resume.body.data).toMatchObject({ manual: true });
    const jobs = await api.admin.query(
      `SELECT 1 FROM app_private.deadline_jobs WHERE room_id = $1 AND kind LIKE 'auction.auto_%'`,
      [ctx.roomId],
    );
    expect(jobs.rowCount).toBe(0);
    // Whatever the bot committed before the resume stays; nothing more is automated.
    const before = (await autoBids(ctx.roomId)).length;
    expect(before).toBeLessThanOrEqual(1);
    await botsRun(ctx.roomId);
    expect(await autoBids(ctx.roomId)).toHaveLength(before);
    expect(await controlOf(ctx.guest, ctx.roomId, ctx.hostTeam)).toBe('MANUAL');
    const lot = (await live(ctx.host, ctx.roomId)).lot!;
    expect(lot.ownRejectionReason === null || lot.ownRejectionReason === 'ALREADY_LEADING').toBe(
      true,
    );
  });
});

describe('presence and outages', () => {
  it('a suspended phone’s stale tab is swept: participation credits one grace, and failover is armed', async () => {
    const ctx = await startedAuction('au_mobile');
    const me = await memberId(ctx.host, ctx.roomId);
    const socketId = `phone-${randomUUID()}`;
    const t = (await api.admin.query<{ now: Date }>('SELECT now()')).rows[0]!.now.getTime();
    await api.admin.query(
      `INSERT INTO app_private.room_connections (room_id, member_id, socket_id, instance_id, last_heartbeat_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ctx.roomId, me, socketId, randomUUID(), new Date(t - 60_000), new Date(t - 45_000)],
    );
    await api.admin.query(
      `UPDATE app_private.room_members SET participation_opened_at = $2, participation_ms = 0 WHERE id = $1`,
      [me, new Date(t - 300_000)],
    );
    expect(await sweepStaleConnections(deps())).toBeGreaterThanOrEqual(1);
    const row = (
      await api.admin.query<{ participation_ms: string; participation_opened_at: Date | null }>(
        'SELECT participation_ms::text, participation_opened_at FROM app_private.room_members WHERE id = $1',
        [me],
      )
    ).rows[0]!;
    // Opened 5 min before; last heartbeat 1 min before; credited until heartbeat + 30 s.
    expect(Number(row.participation_ms)).toBe(270_000);
    expect(row.participation_opened_at).toBeNull();
    const armed = await api.admin.query(
      `SELECT 1 FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'auction.team_absence'`,
      [ctx.roomId],
    );
    expect(armed.rowCount).toBe(1);
  });

  it('a server crash pauses an overdue lot behind a 10-second countdown instead of selling it', async () => {
    const ctx = await startedAuction('au_crash');
    await bid(ctx.host, ctx.roomId);
    // The old process stopped heartbeating 20 s ago, 15 s after the lot was due… with 5 s left.
    const t = (await api.admin.query<{ now: Date }>('SELECT now()')).rows[0]!.now.getTime();
    const lastHealthy = new Date(t - 20_000);
    await api.admin.query(
      `INSERT INTO app_private.runtime_leases (name, owner_id, generation, heartbeat_at, expires_at)
       VALUES ('coordinator', $1, 7, $2, $3)
       ON CONFLICT (name) DO UPDATE SET owner_id = EXCLUDED.owner_id, heartbeat_at = EXCLUDED.heartbeat_at,
         expires_at = EXCLUDED.expires_at`,
      [randomUUID(), lastHealthy, new Date(t - 10_000)],
    );
    await api.admin.query(
      `UPDATE app_private.auction_nominations SET deadline = $2 WHERE room_id = $1 AND status = 'open'`,
      [ctx.roomId, new Date(t - 15_000)],
    );
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = $2 WHERE room_id = $1 AND kind = 'auction.bidding_deadline'`,
      [ctx.roomId, new Date(t - 15_000)],
    );
    // A new process takes the lease over and finds the gap.
    const lease = new CoordinatorLease(api.pool, randomUUID());
    expect(await lease.tryAcquire()).toBe(true);
    expect(lease.takeoverGap!.gapMs).toBeGreaterThan(5_000);
    const recovered = await recoverAfterOutage(api.pool, lease.takeoverGap!.lastHealthy);
    expect(recovered.map((r) => r.roomId)).toContain(ctx.roomId);
    await lease.release();

    const snap = await snapshot(ctx.guest, ctx.roomId);
    expect(snap.recoveryUntil).not.toBeNull();
    const lot = (await live(ctx.guest, ctx.roomId)).lot!;
    expect(lot.status).toBe('open');
    // It kept the 5 s it had at the last healthy heartbeat, after the 10 s countdown.
    const left = new Date(lot.deadline!).getTime() - new Date(snap.serverNow).getTime();
    expect(left).toBeGreaterThan(13_000);
    expect(left).toBeLessThanOrEqual(15_500);
    // Nothing is sold and nobody can act during the countdown.
    await duePass();
    expect((await live(ctx.guest, ctx.roomId)).lot!.status).toBe('open');
    const paused = await bid(ctx.guest, ctx.roomId);
    expect(paused.body.error!.code).toBe('GAME_PAUSED');
    // After the countdown play resumes normally.
    await api.admin.query(
      `UPDATE app_private.rooms SET recovery_until = now() - interval '1 second' WHERE id = $1`,
      [ctx.roomId],
    );
    expect((await bid(ctx.guest, ctx.roomId)).status).toBe(200);
  });

  it('a member removed from a team can no longer replay its private stream', async () => {
    let mateId = '';
    const ctx = await startedAuction('au_revoke', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        await joinTeam(roomId, host, mates[0]!, 'advisor', ADVISOR_CAPABILITIES);
        mateId = await memberId(mates[0]!, roomId);
      },
    });
    const [mate] = ctx.mates as [BffClient];
    const stream = (
      await api.admin.query<{ id: string }>(
        `SELECT id FROM app_private.room_streams WHERE room_id = $1 AND audience_kind = 'team' AND audience_id = $2`,
        [ctx.roomId, ctx.hostTeam],
      )
    ).rows[0]!.id;
    const replay = () =>
      mate.request('GET', `/v1/rooms/${ctx.roomId}/events?streamId=${stream}&afterSeq=0`);
    expect((await replay()).status).toBe(200);
    await api.admin.query('DELETE FROM app_private.franchise_members WHERE member_id = $1', [
      mateId,
    ]);
    expect((await replay()).status).toBe(404);
    expect((await snapshot(mate, ctx.roomId)).cursors.map((c) => c.streamId)).not.toContain(stream);
  });
});
