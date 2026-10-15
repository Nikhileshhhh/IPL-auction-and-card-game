import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

/**
 * Live auction (phase 10, ADR-025): lots, bids, anti-sniping, RTM stages,
 * passes, pause/skip and the end.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_auction_live');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const {
  snapshot,
  live,
  command,
  duePass,
  expireLot,
  nextLot,
  startedAuction,
  bid,
  publicEvents,
  acquisitions,
} = auctionHelpers(() => api);

describe('live bidding (ADR-025)', () => {
  it('starts with a committed seed, sells to the last bidder and deducts the purse once', async () => {
    const { roomId, host, guest, guestTeam, view } = await startedAuction('al_sell');
    expect(view.status).toBe('running');
    expect(view.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(view.auditSeed).toBeNull();
    expect(view.lot!.lotNumber).toBe(1);
    expect(view.lot!.stage).toBe('bidding');
    expect(view.lot!.ownLegalNextBidRupees).toBe(view.lot!.basePriceRupees);
    expect(view.lot!.player.portraitUrl).toBeTruthy();
    expect(view.myAllowedActions).toEqual(expect.arrayContaining(['auction.bid', 'auction.skip']));

    const first = await bid(host, roomId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data!.acceptedAmountRupees).toBe(view.lot!.basePriceRupees);
    // The leader cannot raise itself.
    const self = await bid(host, roomId);
    expect(self.body.error!.code).toBe('ALREADY_LEADING');
    const second = await bid(guest, roomId);
    expect(second.status).toBe(200);
    const price = second.body.data!.acceptedAmountRupees as string;
    expect(BigInt(price)).toBeGreaterThan(BigInt(view.lot!.basePriceRupees));

    // A stale version is never auto-raised; the reply carries the new legal amount.
    const stale = await command(host, roomId, 'auction.bid', {
      nominationId: view.lot!.id,
      nominationVersion: '1',
      amountRupees: view.lot!.basePriceRupees,
    });
    expect(stale.body.error!.code).toBe('STALE_BID');
    expect(stale.body.error!.details).toMatchObject({ nominationVersion: '2' });

    const purseBefore = (await live(host, roomId)).teams.find((t) => t.teamId === guestTeam)!;
    await expireLot(roomId);
    await duePass(); // a second pass after the sale changes nothing
    const sold = await acquisitions(roomId);
    expect(sold).toEqual([
      {
        player_id: view.lot!.player.playerId,
        auction_franchise_id: guestTeam,
        kind: 'auction',
        charged_price: price,
      },
    ]);
    const after = await live(host, roomId);
    expect(after.lot).toBeNull();
    expect(after.nextLotAt).not.toBeNull();
    const guestAfter = after.teams.find((t) => t.teamId === guestTeam)!;
    expect(BigInt(guestAfter.remainingPurseRupees)).toBe(
      BigInt(purseBefore.remainingPurseRupees) - BigInt(price),
    );
    expect(guestAfter.rosterCount).toBe(1);
    expect(after.history[0]).toMatchObject({
      outcome: 'sold',
      teamId: guestTeam,
      priceRupees: price,
    });
    // The gap ends and lot 2 opens.
    await nextLot(roomId);
    expect((await live(host, roomId)).lot!.lotNumber).toBe(2);
    const types = (await publicEvents(roomId))
      .map((e) => e.type)
      .filter((t) => t !== 'auction.setupPhaseChanged');
    expect(types.slice(0, 6)).toEqual([
      'auction.playerNominated',
      'auction.biddingOpened',
      'auction.bidAccepted',
      'auction.bidAccepted',
      'auction.playerSold',
      'auction.playerNominated',
    ]);
  });

  it('a bid at or after the deadline is late; a late-window bid extends the clock to 8 s', async () => {
    const { roomId, host, guest } = await startedAuction('al_clock');
    await api.admin.query(
      `UPDATE app_private.auction_nominations SET deadline = now() + interval '2 seconds'
        WHERE room_id = $1 AND status = 'open'`,
      [roomId],
    );
    const accepted = await bid(host, roomId);
    expect(accepted.status).toBe(200);
    const deadline = new Date(accepted.body.data!.deadline as string).getTime();
    const db = (await api.admin.query<{ now: Date }>('SELECT now()')).rows[0]!.now.getTime();
    expect(deadline - db).toBeGreaterThan(6_000);
    expect((await publicEvents(roomId)).map((e) => e.type)).toContain('auction.timerChanged');

    await api.admin.query(
      `UPDATE app_private.auction_nominations SET deadline = now() - interval '1 millisecond'
        WHERE room_id = $1 AND status = 'open'`,
      [roomId],
    );
    const late = await bid(guest, roomId);
    expect(late.body.error!.code).toBe('LATE_BID');
  });

  it(
    'an unsold pass is followed by one second pass, then the auction finalizes',
    { timeout: 180_000 },
    async () => {
      const { roomId, host } = await startedAuction('al_pass');
      const total = (await live(host, roomId)).poolProgress.total;
      const seen: number[] = [];
      for (let i = 0; i < total * 5; i += 1) {
        const s = await live(host, roomId);
        if (s.status === 'finished') break;
        if (s.lot) {
          seen.push(s.lot.pass);
          await expireLot(roomId);
        } else await nextLot(roomId);
      }
      const end = await live(host, roomId);
      expect(end.status).toBe('finished');
      expect(end.finishedReason).toBe('pool_complete');
      expect(seen.filter((p) => p === 1).length).toBe(total);
      expect(seen.filter((p) => p === 2).length).toBeGreaterThan(0);
      // Every player came up once in pass 1 and, unsold, once more in pass 2 (lots
      // nobody could legally buy close at once, without a clock).
      const nominated = (await publicEvents(roomId, 'auction.playerNominated')).map(
        (e) => e.payload.pass,
      );
      expect(nominated.filter((p) => p === 1).length).toBe(total);
      expect(nominated.filter((p) => p === 2).length).toBe(total);
      expect(end.history.every((h) => h.outcome === 'unsold')).toBe(true);
      expect(end.poolProgress).toMatchObject({ sold: 0, unsold: total, remaining: 0 });
      expect(end.auditSeed).toMatch(/^[0-9a-f]{64}$/);
      expect(end.myAllowedActions).toEqual([]);
      expect((await snapshot(host, roomId)).room.lifecycle).toBe('FINALIZING');
      const final = await publicEvents(roomId, 'game.finalizing');
      expect(final.at(-1)!.payload).toMatchObject({
        stage: 'evaluation_pending',
        reason: 'pool_complete',
      });
      // Only the squad evaluation is left to run (phase 14).
      const jobs = await api.admin.query<{ kind: string }>(
        `SELECT kind FROM app_private.deadline_jobs WHERE room_id = $1 AND kind LIKE 'auction.%'`,
        [roomId],
      );
      expect(jobs.rows.map((j) => j.kind)).toEqual(['auction.evaluate']);
    },
  );

  it('two due passes racing on one expired lot sell it exactly once', async () => {
    const { roomId, host, guest } = await startedAuction('al_race');
    await bid(host, roomId);
    await api.admin.query(
      `UPDATE app_private.auction_nominations SET deadline = now() - interval '1 second'
        WHERE room_id = $1 AND status = 'open'`,
      [roomId],
    );
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'auction.bidding_deadline'`,
      [roomId],
    );
    await Promise.all([duePass(), duePass(), duePass()]);
    expect((await acquisitions(roomId)).length).toBe(1);
    // A bid after the sale is refused as late.
    const sold = (await live(guest, roomId)).history[0]!;
    const late = await command(guest, roomId, 'auction.bid', {
      nominationId: sold.nominationId,
      nominationVersion: '1',
      amountRupees: sold.priceRupees!,
    });
    expect(late.body.error!.code).toBe('LATE_BID');
  });
});

describe('host controls', () => {
  it('skip before the first bid only; pause only between lots; resume opens the next lot', async () => {
    const { roomId, host, guest } = await startedAuction('al_host');
    const first = (await live(host, roomId)).lot!;
    // Not the host.
    expect((await command(guest, roomId, 'auction.skip', { nominationId: first.id })).status).toBe(
      403,
    );
    // Pause is refused during a lot.
    const during = await command(host, roomId, 'auction.pause', {});
    expect(during.body.error!.code).toBe('PAUSE_NOT_ALLOWED');
    const skipped = await command(host, roomId, 'auction.skip', { nominationId: first.id });
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    expect((await live(host, roomId)).history[0]).toMatchObject({ outcome: 'skipped' });

    // In the gap: pause, and the next-lot job does nothing while paused.
    const paused = await command(host, roomId, 'auction.pause', {});
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    await nextLot(roomId);
    const p = await live(host, roomId);
    expect(p.lot).toBeNull();
    expect(p.pausedUntil).not.toBeNull();
    expect(p.pausesLeft).toBe(2);
    expect(p.myAllowedActions).toContain('auction.resume');
    const resumed = await command(host, roomId, 'auction.resume', {});
    expect(resumed.status).toBe(200);
    const lot2 = (await live(host, roomId)).lot!;
    expect(lot2.lotNumber).toBe(2);
    // After a bid the lot cannot be skipped.
    await bid(guest, roomId);
    const late = await command(host, roomId, 'auction.skip', { nominationId: lot2.id });
    expect(late.body.error!.code).toBe('STATE_CONFLICT');

    // A pause expires on its own.
    await expireLot(roomId);
    await command(host, roomId, 'auction.pause', {});
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'auction.pause_expiry'`,
      [roomId],
    );
    await duePass();
    const back = await live(host, roomId);
    expect(back.pausedUntil).toBeNull();
    expect(back.lot!.lotNumber).toBe(3);
    expect((await publicEvents(roomId)).map((e) => e.type)).toContain('auction.resumed');
  });
});

describe('right to match (2025 regulations)', () => {
  /**
   * Advance to a lot whose player last played for `rtmTeam`'s franchise, with
   * the other team holding the only bid when bidding closes.
   */
  async function rtmLot(
    ctx: Awaited<ReturnType<typeof startedAuction>>,
    rtmClient: BffClient,
    bidder: BffClient,
  ) {
    const rtmTeamId = (await live(rtmClient, ctx.roomId)).myTeamId!;
    for (let i = 0; i < 80; i += 1) {
      const s = await live(rtmClient, ctx.roomId);
      if (!s.lot) {
        await nextLot(ctx.roomId);
        continue;
      }
      const franchise = s.teams.find((t) => t.teamId === rtmTeamId)!.franchiseDefinitionId;
      if (
        s.lot.player.previousFranchiseId === franchise &&
        s.lot.player.cappedStatus !== 'unknown'
      ) {
        expect((await bid(bidder, ctx.roomId)).status).toBe(200);
        await expireLot(ctx.roomId);
        const after = await live(rtmClient, ctx.roomId);
        expect(after.lot?.stage).toBe('rtm_intent');
        expect(after.lot!.rtmFranchiseId).toBe(rtmTeamId);
        return after.lot!;
      }
      await expireLot(ctx.roomId);
    }
    throw new Error('no RTM lot found');
  }

  it('intent timeout and decline both sell to the high bidder', async () => {
    const ctx = await startedAuction('al_rtm_a', 'retention');
    const lot = await rtmLot(ctx, ctx.host, ctx.guest);
    await expireLot(ctx.roomId); // intent timeout = decline
    expect((await acquisitions(ctx.roomId)).at(-1)).toMatchObject({
      player_id: lot.player.playerId,
      auction_franchise_id: ctx.guestTeam,
      kind: 'auction',
      charged_price: lot.highBidRupees,
    });

    const lot2 = await rtmLot(ctx, ctx.host, ctx.guest);
    // Only the RTM team decides.
    const wrong = await command(ctx.guest, ctx.roomId, 'auction.rtm.intent', {
      nominationId: lot2.id,
      invoke: true,
    });
    expect(wrong.status).toBe(403);
    const declined = await command(ctx.host, ctx.roomId, 'auction.rtm.intent', {
      nominationId: lot2.id,
      invoke: false,
    });
    expect(declined.body.data).toEqual({ stage: 'settled' });
    expect((await acquisitions(ctx.roomId)).at(-1)).toMatchObject({
      player_id: lot2.player.playerId,
      auction_franchise_id: ctx.guestTeam,
    });
  });

  it('invoke → final raise → match buys the player as RTM at the raised price and uses a card', async () => {
    const ctx = await startedAuction('al_rtm_b', 'retention');
    const before = (await live(ctx.host, ctx.roomId)).teams.find((t) => t.teamId === ctx.hostTeam)!;
    const lot = await rtmLot(ctx, ctx.host, ctx.guest);
    const invoked = await command(ctx.host, ctx.roomId, 'auction.rtm.intent', {
      nominationId: lot.id,
      invoke: true,
    });
    expect(invoked.body.data).toEqual({ stage: 'rtm_raise' });
    const raiseView = await live(ctx.guest, ctx.roomId);
    expect(raiseView.lot!.stage).toBe('rtm_raise');
    expect(raiseView.myAllowedActions).toContain('auction.rtm.finalOffer');
    const standing = BigInt(lot.highBidRupees!);
    // Whole lakhs only, never below the standing bid.
    const odd = await command(ctx.guest, ctx.roomId, 'auction.rtm.finalOffer', {
      nominationId: lot.id,
      amountRupees: (standing + 50_000n).toString(),
    });
    expect(odd.body.error!.code).toBe('VALIDATION_FAILED');
    const low = await command(ctx.guest, ctx.roomId, 'auction.rtm.finalOffer', {
      nominationId: lot.id,
      amountRupees: (standing - 100_000n).toString(),
    });
    expect(low.body.error!.code).toBe('VALIDATION_FAILED');
    const raised = standing + 3_000_000n; // + ₹30 lakh
    const offer = await command(ctx.guest, ctx.roomId, 'auction.rtm.finalOffer', {
      nominationId: lot.id,
      amountRupees: raised.toString(),
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(200);
    expect((await live(ctx.host, ctx.roomId)).lot!.rtmFinalBidRupees).toBe(raised.toString());
    const matched = await command(ctx.host, ctx.roomId, 'auction.rtm.match', {
      nominationId: lot.id,
      match: true,
    });
    expect(matched.body.data).toEqual({ acquisition: 'rtm', status: 'sold' });
    expect((await acquisitions(ctx.roomId)).at(-1)).toMatchObject({
      player_id: lot.player.playerId,
      auction_franchise_id: ctx.hostTeam,
      kind: 'rtm',
      charged_price: raised.toString(),
    });
    const after = (await live(ctx.host, ctx.roomId)).teams.find((t) => t.teamId === ctx.hostTeam)!;
    expect(after.rtmCards.total).toBe(before.rtmCards.total - 1);
    expect(BigInt(after.remainingPurseRupees)).toBe(BigInt(before.remainingPurseRupees) - raised);
    expect((await live(ctx.host, ctx.roomId)).history[0]).toMatchObject({ outcome: 'rtm' });
  });

  it('a declined match sells at the binding final offer; a raise timeout holds', async () => {
    const ctx = await startedAuction('al_rtm_c', 'retention');
    const lot = await rtmLot(ctx, ctx.host, ctx.guest);
    await command(ctx.host, ctx.roomId, 'auction.rtm.intent', {
      nominationId: lot.id,
      invoke: true,
    });
    const raised = BigInt(lot.highBidRupees!) + 1_000_000n;
    await command(ctx.guest, ctx.roomId, 'auction.rtm.finalOffer', {
      nominationId: lot.id,
      amountRupees: raised.toString(),
    });
    const declined = await command(ctx.host, ctx.roomId, 'auction.rtm.match', {
      nominationId: lot.id,
      match: false,
    });
    expect(declined.body.data).toEqual({ acquisition: 'auction', status: 'sold' });
    expect((await acquisitions(ctx.roomId)).at(-1)).toMatchObject({
      auction_franchise_id: ctx.guestTeam,
      charged_price: raised.toString(),
    });

    const lot2 = await rtmLot(ctx, ctx.host, ctx.guest);
    await command(ctx.host, ctx.roomId, 'auction.rtm.intent', {
      nominationId: lot2.id,
      invoke: true,
    });
    await expireLot(ctx.roomId); // the raise times out: hold at the standing bid
    const matchView = await live(ctx.host, ctx.roomId);
    expect(matchView.lot!.stage).toBe('rtm_match');
    expect(matchView.lot!.rtmFinalBidRupees).toBe(lot2.highBidRupees);
    await expireLot(ctx.roomId); // the match times out: declined
    expect((await acquisitions(ctx.roomId)).at(-1)).toMatchObject({
      player_id: lot2.player.playerId,
      auction_franchise_id: ctx.guestTeam,
      kind: 'auction',
      charged_price: lot2.highBidRupees,
    });
  });

  it('a fresh-format room never opens RTM', async () => {
    const ctx = await startedAuction('al_rtm_fresh', 'fresh');
    const s = await live(ctx.host, ctx.roomId);
    expect(s.teams.every((t) => t.rtmCards.total === 0)).toBe(true);
    await bid(ctx.guest, ctx.roomId);
    await expireLot(ctx.roomId);
    expect((await acquisitions(ctx.roomId)).length).toBe(1);
  });
});
