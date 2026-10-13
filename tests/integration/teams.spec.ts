import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADVISOR_CAPABILITIES,
  ShortlistViewSchema,
  TeamViewSchema,
  type TeamCapabilities,
  type TeamView,
} from '@stumps/contracts';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

/**
 * Team collaboration (phase 11, ADR-026): join approval, capability
 * delegation and revocation, captain handover by consent, code rotation and
 * friend auto-join, the private shortlist, late joiners and tab fencing.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_teams');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, live, command, startedAuction, expireLot } = auctionHelpers(() => api);

const bidsOn = async (nominationId: string) =>
  (
    await api.admin.query('SELECT 1 FROM app_private.auction_bids WHERE nomination_id = $1', [
      nominationId,
    ])
  ).rowCount;

const BIDDER: TeamCapabilities = { ...ADVISOR_CAPABILITIES, bid: true };

async function team(client: BffClient, roomId: string): Promise<TeamView> {
  const res = await client.request<TeamView>('GET', `/v1/rooms/${roomId}/team`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return TeamViewSchema.parse(res.body.data);
}

/** `mate` asks to join `captain`'s team with its code; the captain approves. */
async function joinTeam(
  roomId: string,
  captain: BffClient,
  mate: BffClient,
  role: 'advisor' | 'bidder' | 'cocaptain' = 'advisor',
  capabilities: TeamCapabilities = ADVISOR_CAPABILITIES,
) {
  const code = (await team(captain, roomId)).joinCode!;
  const asked = await command(mate, roomId, 'team.requestJoin', { franchiseCode: code });
  expect(asked.status, JSON.stringify(asked.body)).toBe(200);
  const approved = await command(captain, roomId, 'team.decideJoin', {
    requestId: asked.body.data!.requestId,
    approve: true,
    role,
    capabilities,
  });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return (await snapshot(mate, roomId)).me.memberId;
}

const memberRow = async (memberId: string) =>
  (
    await api.admin.query<{ role: string; can_bid: boolean; eligible_at_start: boolean }>(
      'SELECT role, can_bid, eligible_at_start FROM app_private.franchise_members WHERE member_id = $1',
      [memberId],
    )
  ).rows[0];

describe('two humans run one franchise', () => {
  it('captain and a bidding collaborator bid the same amount at once: one is accepted', async () => {
    const ctx = await startedAuction('tm_same', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        await joinTeam(roomId, host, mates[0]!, 'bidder', BIDDER);
      },
    });
    const [mate] = ctx.mates as [BffClient];
    const lot = (await live(mate, ctx.roomId)).lot!;
    expect(lot.ownLegalNextBidRupees).toBe(lot.basePriceRupees);
    const views = await Promise.all([ctx.host, mate].map((c) => snapshot(c, ctx.roomId)));
    const send = (c: BffClient, i: number) =>
      c.mutate('POST', `/v1/rooms/${ctx.roomId}/commands`, {
        type: 'auction.bid',
        commandId: randomUUID(),
        roomId: ctx.roomId,
        expectedVersion: views[i]!.room.stateVersion,
        controlEpoch: views[i]!.me.controlEpoch,
        payload: {
          nominationId: lot.id,
          nominationVersion: lot.bidVersion,
          amountRupees: lot.basePriceRupees,
        },
      });
    const results = await Promise.all([send(ctx.host, 0), send(mate, 1)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const loser = results.find((r) => r.status !== 200)!;
    expect(['STALE_BID', 'ALREADY_LEADING', 'VERSION_CONFLICT']).toContain(loser.body.error!.code);
    // The franchise holds the bid either way, and it is one competitive position.
    expect((await live(ctx.guest, ctx.roomId)).lot!.highFranchiseId).toBe(ctx.hostTeam);
    expect((await live(mate, ctx.roomId)).lot!.ownRejectionReason).toBe('ALREADY_LEADING');
    expect((await live(ctx.host, ctx.roomId)).teams).toHaveLength(2);
  });

  it('a bid right revoked before the bid is handled is refused under the room lock', async () => {
    let mateId = '';
    const ctx = await startedAuction('tm_revoke', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        mateId = await joinTeam(roomId, host, mates[0]!, 'bidder', BIDDER);
      },
    });
    const [mate] = ctx.mates as [BffClient];
    // The collaborator prepares the bid against the snapshot it holds…
    const snap = await snapshot(mate, ctx.roomId);
    const lot = (await live(mate, ctx.roomId)).lot!;
    // …the captain revokes the right first…
    const revoked = await command(ctx.host, ctx.roomId, 'team.permissions', {
      memberId: mateId,
      role: 'advisor',
      capabilities: ADVISOR_CAPABILITIES,
    });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    // …and the queued bid finds no right when it is handled.
    const late = await mate.mutate('POST', `/v1/rooms/${ctx.roomId}/commands`, {
      type: 'auction.bid',
      commandId: randomUUID(),
      roomId: ctx.roomId,
      expectedVersion: snap.room.stateVersion,
      controlEpoch: snap.me.controlEpoch,
      payload: {
        nominationId: lot.id,
        nominationVersion: lot.bidVersion,
        amountRupees: lot.basePriceRupees,
      },
    });
    expect(late.status).toBe(403);
    expect((await live(mate, ctx.roomId)).lot!.ownRejectionReason).toBe('NO_BID_RIGHT');
    expect((await memberRow(mateId))!.can_bid).toBe(false);
  });
});

describe('capabilities and captaincy', () => {
  it('only the captain delegates; one co-captain; never a second captain', async () => {
    let ids: string[] = [];
    const ctx = await startedAuction('tm_perm', 'fresh', {
      mates: 2,
      beforeStart: async ({ roomId, host, mates }) => {
        ids = [await joinTeam(roomId, host, mates[0]!), await joinTeam(roomId, host, mates[1]!)];
      },
    });
    const [a, b] = ctx.mates as [BffClient, BffClient];
    const view = await team(ctx.host, ctx.roomId);
    expect(view.members.map((m) => m.role)).toEqual(['captain', 'advisor', 'advisor']);
    expect(view.members.every((m) => m.eligibleAtStart && !m.lateJoiner)).toBe(true);
    // A teammate cannot delegate, and the rival captain cannot touch this team.
    const notCaptain = await command(a, ctx.roomId, 'team.permissions', {
      memberId: ids[1],
      role: 'bidder',
      capabilities: BIDDER,
    });
    expect(notCaptain.status).toBe(403);
    const rival = await command(ctx.guest, ctx.roomId, 'team.permissions', {
      memberId: ids[1],
      role: 'bidder',
      capabilities: BIDDER,
    });
    expect(rival.status).toBe(404);
    const coA = await command(ctx.host, ctx.roomId, 'team.permissions', {
      memberId: ids[0],
      role: 'cocaptain',
      capabilities: { ...BIDDER, rtm: true },
    });
    expect(coA.body.data).toEqual({ version: '1' });
    const coB = await command(ctx.host, ctx.roomId, 'team.permissions', {
      memberId: ids[1],
      role: 'cocaptain',
      capabilities: BIDDER,
    });
    expect(coB.body.error!.details).toMatchObject({ reason: 'COCAPTAIN_TAKEN' });
    // The captain role can only move by consent.
    const asCaptain = await command(ctx.host, ctx.roomId, 'team.permissions', {
      memberId: ids[1],
      role: 'captain',
      capabilities: BIDDER,
    });
    expect(asCaptain.status).toBe(400); // `captain` is not a role anyone can be given
    expect((await team(b, ctx.roomId)).myCapabilities).toEqual(ADVISOR_CAPABILITIES);
    const events = await api.admin.query<{ type: string }>(
      `SELECT e.type FROM app_private.room_events e JOIN app_private.room_streams s ON s.id = e.stream_id
        WHERE e.room_id = $1 AND s.audience_kind = 'team' AND e.type = 'team.permissionsChanged'`,
      [ctx.roomId],
    );
    expect(events.rowCount).toBe(1);
  });

  it('captain handover needs the named teammate to accept within a minute; one captain after', async () => {
    let ids: string[] = [];
    const ctx = await startedAuction('tm_hand', 'fresh', {
      mates: 2,
      beforeStart: async ({ roomId, host, mates }) => {
        ids = [await joinTeam(roomId, host, mates[0]!), await joinTeam(roomId, host, mates[1]!)];
      },
    });
    const [a, b] = ctx.mates as [BffClient, BffClient];
    const hostId = (await snapshot(ctx.host, ctx.roomId)).me.memberId;
    const offer = await command(ctx.host, ctx.roomId, 'team.captain.propose', { memberId: ids[0] });
    expect(offer.status, JSON.stringify(offer.body)).toBe(200);
    const handoverId = (offer.body.data!.pendingHandover as { handoverId: string }).handoverId;
    // Only the named teammate may accept.
    expect((await command(b, ctx.roomId, 'team.captain.accept', { handoverId })).status).toBe(404);
    expect((await team(a, ctx.roomId)).myAllowedActions).toContain('team.captain.accept');
    // An expired offer cannot be taken.
    await api.admin.query(
      `UPDATE app_private.team_handovers SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [handoverId],
    );
    const expired = await command(a, ctx.roomId, 'team.captain.accept', { handoverId });
    expect(expired.body.error!.details).toMatchObject({ reason: 'HANDOVER_CLOSED' });
    // A fresh offer replaces any earlier one.
    const first = await command(ctx.host, ctx.roomId, 'team.captain.propose', { memberId: ids[1] });
    const second = await command(ctx.host, ctx.roomId, 'team.captain.propose', {
      memberId: ids[0],
    });
    const replaced = await command(b, ctx.roomId, 'team.captain.accept', {
      handoverId: (first.body.data!.pendingHandover as { handoverId: string }).handoverId,
    });
    expect(replaced.status).toBe(409);
    const accepted = await command(a, ctx.roomId, 'team.captain.accept', {
      handoverId: (second.body.data!.pendingHandover as { handoverId: string }).handoverId,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data).toMatchObject({ captainId: ids[0] });
    const rows = await api.admin.query<{ member_id: string; role: string }>(
      `SELECT member_id, role FROM app_private.franchise_members WHERE auction_franchise_id = $1`,
      [ctx.hostTeam],
    );
    const captains = rows.rows.filter((r) => r.role === 'captain');
    expect(captains).toEqual([{ member_id: ids[0], role: 'captain' }]);
    expect(rows.rows.find((r) => r.member_id === hostId)!.role).toBe('cocaptain');
    const pointer = await api.admin.query<{ captain_member_id: string; control_epoch: string }>(
      'SELECT captain_member_id, control_epoch::text FROM app_private.auction_franchises WHERE id = $1',
      [ctx.hostTeam],
    );
    expect(pointer.rows[0]!.captain_member_id).toBe(ids[0]);
    expect(pointer.rows[0]!.control_epoch).toBe(accepted.body.data!.epoch);
    // The new captain now delegates; the old one no longer can.
    expect((await team(a, ctx.roomId)).myRole).toBe('captain');
    const oldCaptain = await command(ctx.host, ctx.roomId, 'team.permissions', {
      memberId: ids[1],
      role: 'bidder',
      capabilities: BIDDER,
    });
    expect(oldCaptain.status).toBe(403);
    // The new captain bids with full rights.
    expect((await live(a, ctx.roomId)).lot!.ownLegalNextBidRupees).not.toBeNull();
  });
});

describe('invitations', () => {
  it('rotating the code revokes the old code and pending requests; auto-join admits friends only', async () => {
    const ctx = await startedAuction('tm_code', 'fresh', {
      mates: 2,
      beforeStart: async ({ roomId, host, mates }) => {
        const [x, y] = mates as [BffClient, BffClient];
        const oldCode = (await team(host, roomId)).joinCode!;
        const pending = await command(x, roomId, 'team.requestJoin', { franchiseCode: oldCode });
        expect(pending.body.data).toMatchObject({ pending: true });
        // A stranger cannot be put on the auto-join list.
        const yUser = (
          await api.admin.query<{ user_id: string }>(
            'SELECT user_id FROM app_private.room_members WHERE id = $1',
            [(await snapshot(y, roomId)).me.memberId],
          )
        ).rows[0]!.user_id;
        const hostUser = (
          await api.admin.query<{ user_id: string }>(
            'SELECT user_id FROM app_private.room_members WHERE id = $1',
            [(await snapshot(host, roomId)).me.memberId],
          )
        ).rows[0]!.user_id;
        const stranger = await command(host, roomId, 'team.invite.rotate', {
          autoJoinUserIds: [yUser],
        });
        expect(stranger.body.error!.details).toMatchObject({ reason: 'NOT_FRIENDS' });
        const [low, high] = [hostUser, yUser].sort();
        await api.admin.query(
          `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status)
           VALUES ($1, $2, $1, 'accepted')`,
          [low, high],
        );
        expect((await team(host, roomId)).autoJoin!.map((f) => [f.userId, f.enabled])).toEqual([
          [yUser, false],
        ]);
        const rotated = await command(host, roomId, 'team.invite.rotate', {
          autoJoinUserIds: [yUser],
        });
        expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
        const newCode = rotated.body.data!.newCode as string;
        expect(newCode).not.toBe(oldCode);
        expect((await team(host, roomId)).requests).toEqual([]); // revoked
        const stale = await command(x, roomId, 'team.requestJoin', { franchiseCode: oldCode });
        expect(stale.status).toBe(404);
        // The friend on the list joins at once, as an advisor.
        const auto = await command(y, roomId, 'team.requestJoin', { franchiseCode: newCode });
        expect(auto.body.data).toMatchObject({ pending: false });
        expect((await team(y, roomId)).myRole).toBe('advisor');
        // Everyone else still needs approval.
        const again = await command(x, roomId, 'team.requestJoin', { franchiseCode: newCode });
        expect(again.body.data).toMatchObject({ pending: true });
      },
    });
    expect(ctx.roomId).toBeTruthy();
  });

  it('a late joiner is an advisor without this game’s medal and cannot be promoted', async () => {
    const ctx = await startedAuction('tm_late', 'fresh', { mates: 1 });
    const [late] = ctx.mates as [BffClient];
    const lateId = await joinTeam(ctx.roomId, ctx.host, late, 'bidder', BIDDER);
    expect(await memberRow(lateId)).toMatchObject({
      role: 'advisor',
      can_bid: false,
      eligible_at_start: false,
    });
    const view = await team(ctx.host, ctx.roomId);
    expect(view.members.find((m) => m.memberId === lateId)).toMatchObject({
      lateJoiner: true,
      eligibleAtStart: false,
    });
    expect(view.members.find((m) => m.role === 'captain')).toMatchObject({
      eligibleAtStart: true,
      lateJoiner: false,
    });
    const promote = await command(ctx.host, ctx.roomId, 'team.permissions', {
      memberId: lateId,
      role: 'bidder',
      capabilities: BIDDER,
    });
    expect(promote.body.error!.details).toMatchObject({ reason: 'LATE_JOINER' });
    const captaincy = await command(ctx.host, ctx.roomId, 'team.captain.propose', {
      memberId: lateId,
    });
    expect(captaincy.body.error!.details).toMatchObject({ reason: 'LATE_JOINER' });
    expect((await live(late, ctx.roomId)).lot!.ownRejectionReason).toBe('NO_BID_RIGHT');
  });
});

describe('the private shortlist', () => {
  it('only the team sees it; ceilings need the limits right; votes are advisory', async () => {
    const ctx = await startedAuction('tm_list', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        await joinTeam(roomId, host, mates[0]!);
      },
    });
    const [mate] = ctx.mates as [BffClient];
    const lot = (await live(ctx.host, ctx.roomId)).lot!;
    const target = lot.player.playerId;
    // The advisor can add a target but not a ceiling.
    const ceiling = await command(mate, ctx.roomId, 'team.shortlist.upsert', {
      playerId: target,
      priority: 80,
      maxPrice: '50000000',
    });
    expect(ceiling.status).toBe(403);
    const added = await command(mate, ctx.roomId, 'team.shortlist.upsert', {
      playerId: target,
      priority: 80,
      note: 'Opens the batting',
    });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const capped = await command(ctx.host, ctx.roomId, 'team.shortlist.upsert', {
      playerId: target,
      priority: 90,
      maxPrice: '50000000',
    });
    expect(capped.body.data!.entry).toMatchObject({
      priority: 90,
      note: 'Opens the batting',
      maxPriceRupees: '50000000',
    });
    await command(mate, ctx.roomId, 'team.shortlist.vote', { playerId: target, value: 1 });
    await command(ctx.host, ctx.roomId, 'team.shortlist.vote', { playerId: target, value: -1 });
    await command(ctx.host, ctx.roomId, 'team.shortlist.vote', { playerId: target, value: 1 });
    const res = await mate.request(
      'GET',
      `/v1/rooms/${ctx.roomId}/franchises/${ctx.hostTeam}/shortlist`,
    );
    const view = ShortlistViewSchema.parse(res.body.data);
    expect(view.entries).toEqual([
      expect.objectContaining({ playerId: target, tally: { up: 2, down: 0 }, myVote: 1 }),
    ]);
    expect(view.canEdit).toBe(true);
    expect(view.canSetLimits).toBe(false);
    expect(view.pool.length).toBeGreaterThan(50);
    // The live lot shows the target to this team only.
    expect((await live(mate, ctx.roomId)).lot!.myTarget).toMatchObject({
      priority: 90,
      maxPriceRupees: '50000000',
    });
    expect((await live(ctx.guest, ctx.roomId)).lot!.myTarget).toBeNull();
    // Another team (and the rival captain) cannot read it; nor can its events be replayed.
    const rival = await ctx.guest.request(
      'GET',
      `/v1/rooms/${ctx.roomId}/franchises/${ctx.hostTeam}/shortlist`,
    );
    expect(rival.status).toBe(404);
    expect(
      (await command(ctx.guest, ctx.roomId, 'team.shortlist.vote', { playerId: target, value: 1 }))
        .status,
    ).toBe(404);
    const stream = await api.admin.query<{ id: string }>(
      `SELECT id FROM app_private.room_streams WHERE room_id = $1 AND audience_kind = 'team'
          AND audience_id = $2`,
      [ctx.roomId, ctx.hostTeam],
    );
    const replay = await ctx.guest.request(
      'GET',
      `/v1/rooms/${ctx.roomId}/events?streamId=${stream.rows[0]!.id}&afterSeq=0`,
    );
    expect(replay.status).toBe(404);
    // A shortlist never buys: the lot still needs a live bid.
    await expireLot(ctx.roomId);
    expect((await live(ctx.host, ctx.roomId)).history[0]!.outcome).toBe('unsold');
    // Removing a target.
    expect(
      (await command(mate, ctx.roomId, 'team.shortlist.remove', { playerId: target })).body.data,
    ).toEqual({ removed: true });
  });
});

describe('tab fencing', () => {
  it('a takeover in another tab fences commands from the old one', async () => {
    const ctx = await startedAuction('tm_tab');
    const old = await snapshot(ctx.host, ctx.roomId);
    // Another tab takes control (the socket takeover bumps the member's epoch).
    await api.admin.query(
      `UPDATE app_private.room_members SET control_epoch = control_epoch + 1 WHERE id = $1`,
      [old.me.memberId],
    );
    const lot = (await live(ctx.host, ctx.roomId)).lot!;
    const stale = await ctx.host.mutate('POST', `/v1/rooms/${ctx.roomId}/commands`, {
      type: 'auction.bid',
      commandId: randomUUID(),
      roomId: ctx.roomId,
      expectedVersion: old.room.stateVersion,
      controlEpoch: old.me.controlEpoch,
      payload: {
        nominationId: lot.id,
        nominationVersion: lot.bidVersion,
        amountRupees: lot.basePriceRupees,
      },
    });
    expect(stale.body.error!.code).toBe('CONTROL_EPOCH_STALE');
    expect(await bidsOn(lot.id)).toBe(0);
  });
});
