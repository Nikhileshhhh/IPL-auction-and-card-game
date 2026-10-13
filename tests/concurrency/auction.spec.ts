import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_CODE, createTestApi, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_cc_auction');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, live, duePass, startedAuction } = auctionHelpers(() => api);

const bids = async (roomId: string) =>
  (
    await api.admin.query<{ bid_version: string; amount: string }>(
      `SELECT bid_version::text, amount::text FROM app_private.auction_bids WHERE room_id = $1
        ORDER BY bid_version`,
      [roomId],
    )
  ).rows;

describe('accepted bids are serial under the room lock (rules §8.2)', () => {
  it('hundreds of parallel bids on one version: exactly one is accepted', async () => {
    const { roomId, host, guest } = await startedAuction(`cc_bids_${randomUUID().slice(0, 6)}`);
    const views = await Promise.all([host, guest].map((c) => snapshot(c, roomId)));
    const lot = (await live(host, roomId)).lot!;
    const send = (i: number) => {
      const client = i % 2 === 0 ? host : guest;
      const snap = views[i % 2]!;
      return client.mutate('POST', `/v1/rooms/${roomId}/commands`, {
        type: 'auction.bid',
        commandId: randomUUID(),
        roomId,
        expectedVersion: snap.room.stateVersion,
        controlEpoch: snap.me.controlEpoch,
        payload: {
          nominationId: lot.id,
          nominationVersion: lot.bidVersion,
          amountRupees: lot.basePriceRupees,
        },
      });
    };
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => send(i)));
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(['STALE_BID', 'VERSION_CONFLICT', 'ALREADY_LEADING', 'RATE_LIMITED']).toContain(
        r.body.error!.code,
      );
    }
    expect(await bids(roomId)).toEqual([{ bid_version: '1', amount: lot.basePriceRupees }]);
  });

  it('a bid racing its own deadline: either accepted before the close, or late with the lot sold once', async () => {
    const { roomId, host, guest } = await startedAuction(`cc_dl_${randomUUID().slice(0, 6)}`);
    const first = (await live(host, roomId)).lot!;
    const snap = await snapshot(host, roomId);
    await host.mutate('POST', `/v1/rooms/${roomId}/commands`, {
      type: 'auction.bid',
      commandId: randomUUID(),
      roomId,
      expectedVersion: snap.room.stateVersion,
      controlEpoch: snap.me.controlEpoch,
      payload: {
        nominationId: first.id,
        nominationVersion: first.bidVersion,
        amountRupees: first.basePriceRupees,
      },
    });
    const lot = (await live(guest, roomId)).lot!;
    const gsnap = await snapshot(guest, roomId);
    await api.admin.query(
      `UPDATE app_private.auction_nominations SET deadline = now() WHERE id = $1`,
      [lot.id],
    );
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() WHERE room_id = $1
          AND kind = 'auction.bidding_deadline'`,
      [roomId],
    );
    const [late] = await Promise.all([
      guest.mutate('POST', `/v1/rooms/${roomId}/commands`, {
        type: 'auction.bid',
        commandId: randomUUID(),
        roomId,
        expectedVersion: gsnap.room.stateVersion,
        controlEpoch: gsnap.me.controlEpoch,
        payload: {
          nominationId: lot.id,
          nominationVersion: lot.bidVersion,
          amountRupees: lot.ownLegalNextBidRupees!,
        },
      }),
      duePass(),
    ]);
    // The deadline has passed by the time either takes the room lock: a bid
    // exactly at the deadline is late, and the lot sells once to the leader.
    expect(late.status).not.toBe(200);
    expect(['LATE_BID', 'VERSION_CONFLICT']).toContain(late.body.error!.code);
    await duePass();
    const sold = await api.admin.query<{ auction_franchise_id: string }>(
      `SELECT auction_franchise_id FROM app_private.auction_acquisitions WHERE nomination_id = $1`,
      [lot.id],
    );
    expect(sold.rowCount).toBe(1);
    expect(sold.rows[0]!.auction_franchise_id).toBe(lot.highFranchiseId);
  });
});
