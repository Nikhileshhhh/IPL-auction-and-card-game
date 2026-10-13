import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADVISOR_CAPABILITIES, type TeamView } from '@stumps/contracts';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { publishDemoPack } from '../support/cards';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_cc_teams');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, command, startedAuction } = auctionHelpers(() => api);

async function joinTeam(roomId: string, captain: BffClient, mate: BffClient) {
  const view = (await captain.request<TeamView>('GET', `/v1/rooms/${roomId}/team`)).body.data!;
  const asked = await command(mate, roomId, 'team.requestJoin', { franchiseCode: view.joinCode });
  await command(captain, roomId, 'team.decideJoin', {
    requestId: asked.body.data!.requestId,
    approve: true,
    role: 'advisor',
    capabilities: ADVISOR_CAPABILITIES,
  });
  return (await snapshot(mate, roomId)).me.memberId;
}

describe('captaincy under the room lock', () => {
  it('an accept racing a replacement offer leaves exactly one captain matching the pointer', async () => {
    for (let round = 0; round < 5; round += 1) {
      let ids: string[] = [];
      const ctx = await startedAuction(`cc_cap${round}`, 'fresh', {
        mates: 2,
        beforeStart: async ({ roomId, host, mates }) => {
          ids = [await joinTeam(roomId, host, mates[0]!), await joinTeam(roomId, host, mates[1]!)];
        },
      });
      const [a] = ctx.mates as [BffClient, BffClient];
      const offer = await command(ctx.host, ctx.roomId, 'team.captain.propose', {
        memberId: ids[0],
      });
      const handoverId = (offer.body.data!.pendingHandover as { handoverId: string }).handoverId;
      const [accept, replace] = await Promise.all([
        command(a, ctx.roomId, 'team.captain.accept', { handoverId }),
        command(ctx.host, ctx.roomId, 'team.captain.propose', { memberId: ids[1] }),
      ]);
      // Exactly one of them wins the lock in a meaningful way.
      expect([accept.status, replace.status].filter((s) => s === 200).length).toBeGreaterThan(0);
      const rows = await api.admin.query<{ member_id: string }>(
        `SELECT member_id FROM app_private.franchise_members
          WHERE auction_franchise_id = $1 AND role = 'captain'`,
        [ctx.hostTeam],
      );
      const pointer = await api.admin.query<{ captain_member_id: string }>(
        'SELECT captain_member_id FROM app_private.auction_franchises WHERE id = $1',
        [ctx.hostTeam],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.member_id).toBe(pointer.rows[0]!.captain_member_id);
      if (accept.status === 200) expect(pointer.rows[0]!.captain_member_id).toBe(ids[0]);
    }
  });
});
