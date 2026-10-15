import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADVISOR_CAPABILITIES,
  ResultDTOSchema,
  type ResultDTO,
  type TeamView,
} from '@stumps/contracts';
import { withTransaction } from '../../apps/server/src/db/transaction';
import { finalizeCardMatch } from '../../apps/server/src/modules/achievements/card';
import { loadMatch } from '../../apps/server/src/modules/cards/store';
import { lockRoom } from '../../apps/server/src/rooms/room-tx';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { cardHelpers, publishDemoPack } from '../support/cards';

/**
 * Finalization and medals (rules §13, DB/realtime §7, ADR-029): receipts are
 * minted once however often the finalizer runs, counters follow only newly
 * inserted receipts, medals skip ineligible competitors without changing
 * ranks, and a franchise medal is credited once to each eligible teammate.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_finalize');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const cards = cardHelpers(() => api);
const auction = auctionHelpers(() => api);

async function receipts(roomId: string) {
  const res = await api.admin.query<{
    user_id: string;
    rank: number;
    medal: string | null;
    medal_place: number | null;
    scope: string;
    credited_role: string;
  }>(
    `SELECT a.user_id, a.rank, a.medal, a.medal_place, a.scope, a.credited_role
       FROM app_private.achievement_receipts a
       JOIN app_private.rooms r ON r.award_batch = a.award_batch
      WHERE r.id = $1 ORDER BY a.rank, a.user_id`,
    [roomId],
  );
  return res.rows;
}

async function summaries(userIds: string[]) {
  const res = await api.admin.query<{
    user_id: string;
    gold: string;
    silver: string;
    games: string;
    card_wins: string;
    auction_wins: string;
  }>(
    `SELECT user_id, gold::text, silver::text, games::text, card_wins::text, auction_wins::text
       FROM app_private.achievement_summaries WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
    [userIds],
  );
  return res.rows;
}

const userOf = async (memberId: string) =>
  (
    await api.admin.query<{ user_id: string }>(
      'SELECT user_id FROM app_private.room_members WHERE id = $1',
      [memberId],
    )
  ).rows[0]!.user_id;

describe('card finalization', () => {
  it('medals skip an absent competitor without changing ranks, and are minted exactly once', async () => {
    const { roomId, players } = await cards.startedMatch('fz_card', { totalCards: 12 });
    // Presence: the host was here the whole time, the guest never connected.
    await api.admin.query(
      `UPDATE app_private.room_members SET participation_ms = 86400000 WHERE id = $1`,
      [players[0]!.memberId],
    );
    let game = (await cards.snapshot(players[0]!.client, roomId)).game!;
    for (let i = 0; i < 200 && !game.result; i += 1) {
      const selector = cards.selectorOf(players, game);
      const res = await cards.command(selector.client, roomId, {
        comparisonId: game.comparisonId,
        metric: (['batting', 'bowling', 'runs'] as const)[i % 3],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      game = (await cards.snapshot(players[0]!.client, roomId)).game!;
    }
    expect(game.result).not.toBeNull();
    const contests = (
      await api.admin.query<{ completed_contests: number }>(
        'SELECT completed_contests FROM app_private.card_games WHERE room_id = $1',
        [roomId],
      )
    ).rows[0]!.completed_contests;
    expect(contests).toBeGreaterThanOrEqual(5);

    const dto = ResultDTOSchema.parse(
      (await players[0]!.client.request<ResultDTO>('GET', `/v1/rooms/${roomId}/results`)).body.data,
    );
    expect(dto.qualificationStatus).toBe('qualifying');
    expect(dto.rankings.map((r) => r.rank)).toEqual([1, 2]);
    const host = dto.rankings.find((r) => r.competitorId === players[0]!.memberId)!;
    const guest = dto.rankings.find((r) => r.competitorId === players[1]!.memberId)!;
    expect(host).toMatchObject({ eligible: true, medal: 'gold', medalPlacement: 1 });
    expect(guest).toMatchObject({ eligible: false, medal: null });
    const hostUser = await userOf(players[0]!.memberId);
    const guestUser = await userOf(players[1]!.memberId);
    expect(await receipts(roomId)).toEqual([
      expect.objectContaining({
        user_id: hostUser,
        medal: 'gold',
        medal_place: 1,
        scope: 'personal',
      }),
    ]);
    expect(dto.ownCredits).toEqual([
      expect.objectContaining({ medal: 'gold', scope: 'personal', qualifies: true }),
    ]);
    const before = await summaries([hostUser, guestUser]);
    expect(before.find((s) => s.user_id === hostUser)).toMatchObject({
      gold: '1',
      games: '1',
      card_wins: host.rank === 1 ? '1' : '0',
    });

    // The finalizer retried ten times, even after its results row disappeared,
    // never mints a second receipt or moves a counter.
    const retry = () =>
      withTransaction(api.pool, async (tx) => {
        const room = await lockRoom(tx, roomId);
        const match = await loadMatch(tx, roomId);
        return finalizeCardMatch(tx, room, match!.state, game.auditSeed!, new Date());
      });
    for (let i = 0; i < 10; i += 1) await retry();
    await api.admin.query('DELETE FROM app_private.room_results WHERE room_id = $1', [roomId]);
    await retry();
    expect(await receipts(roomId)).toHaveLength(1);
    expect(await summaries([hostUser, guestUser])).toEqual(before);

    // A finalizer that fails after inserting receipts rolls everything back.
    const { roomId: other, players: others } = await cards.startedMatch('fz_crash', {
      totalCards: 12,
    });
    await api.admin.query(
      `UPDATE app_private.room_members SET participation_ms = 86400000 WHERE room_id = $1`,
      [other],
    );
    await api.admin.query(
      `UPDATE app_private.card_games SET completed_contests = 9 WHERE room_id = $1`,
      [other],
    );
    const crash = withTransaction(api.pool, async (tx) => {
      const room = await lockRoom(tx, other);
      const match = await loadMatch(tx, other);
      const { finishMatch } = await import('@stumps/game-engines');
      const ended = finishMatch(match!.state, 'vote');
      await finalizeCardMatch(tx, room, ended.state, '', new Date());
      throw new Error('crash after receipts');
    });
    await expect(crash).rejects.toThrow('crash after receipts');
    expect(await receipts(other)).toEqual([]);
    expect((await cards.snapshot(others[0]!.client, other)).room.lifecycle).toBe('RUNNING');
  });

  it('results are for members only and expire with a 410', async () => {
    const { roomId, players } = await cards.startedMatch('fz_ttl');
    const vote = await auction.command(players[0]!.client, roomId, 'vote.start', {});
    const voteId = (vote.body.data as { voteId: string }).voteId;
    for (const p of players)
      await auction.command(p.client, roomId, 'vote.cast', { voteId, choice: 'end' });
    await api.admin.query(
      `UPDATE app_private.end_votes SET starts_at = starts_at - interval '16 s', expires_at = expires_at - interval '16 s' WHERE id = $1`,
      [voteId],
    );
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 s' WHERE room_id = $1 AND kind = 'room.vote_resolve'`,
      [roomId],
    );
    await auction.duePass();
    const outsider = (await cards.startedMatch('fz_out')).players[0]!.client;
    expect((await outsider.request('GET', `/v1/rooms/${roomId}/results`)).status).toBe(404);
    expect((await players[1]!.client.request('GET', `/v1/rooms/${roomId}/results`)).status).toBe(
      200,
    );
    await api.admin.query(
      `UPDATE app_private.room_results SET created_at = now() - interval '200 s', expires_at = now() - interval '1 s' WHERE room_id = $1`,
      [roomId],
    );
    const expired = await players[1]!.client.request('GET', `/v1/rooms/${roomId}/results`);
    expect(expired.status).toBe(410);
    expect((expired.body as { error: { code: string } }).error.code).toBe('RESULTS_EXPIRED');
    expect((await cards.snapshot(players[0]!.client, roomId)).results?.status).toBe('expired');
  });
});

/** Give each team a legal 18-player squad from the unsold pool, paid at base price. */
async function stockLegalSquads(roomId: string, teams: string[]) {
  const pool = (
    await api.admin.query<{
      player_id: string;
      role: string;
      bowl_type: string | null;
      overseas: boolean;
      base_price: string;
    }>(
      `SELECT player_id, role, bowl_type, overseas, base_price::text FROM app_private.auction_pool
        WHERE room_id = $1 AND status = 'available' AND player_id NOT IN (
          SELECT player_id FROM app_private.auction_nominations WHERE room_id = $1 AND status = 'open')
        ORDER BY order_index`,
      [roomId],
    )
  ).rows;
  const taken = new Set<string>();
  const pick = (pred: (p: (typeof pool)[number]) => boolean, n: number, squad: typeof pool) => {
    for (const p of pool) {
      if (squad.length >= 18 || n <= 0) break;
      if (taken.has(p.player_id) || !pred(p)) continue;
      if (p.overseas && squad.filter((s) => s.overseas).length >= 4) continue;
      taken.add(p.player_id);
      squad.push(p);
      n -= 1;
    }
  };
  const client = await api.pool.connect();
  try {
    await client.query('BEGIN');
    for (const team of teams) {
      const squad: typeof pool = [];
      pick((p) => p.role === 'wicketkeeper', 2, squad);
      pick(
        (p) => p.role !== 'batter' && p.role !== 'wicketkeeper' && p.bowl_type === 'pace',
        4,
        squad,
      );
      pick(
        (p) => p.role !== 'batter' && p.role !== 'wicketkeeper' && p.bowl_type === 'spin',
        3,
        squad,
      );
      pick((p) => p.role === 'batter' || p.role === 'all_rounder', 7, squad);
      pick(() => true, 18, squad);
      expect(squad).toHaveLength(18);
      let spent = 0n;
      for (const p of squad) {
        spent += BigInt(p.base_price);
        await client.query(
          `INSERT INTO app_private.auction_acquisitions (room_id, player_id, auction_franchise_id, kind, charged_price)
           VALUES ($1, $2, $3, 'auction', $4)`,
          [roomId, p.player_id, team, p.base_price],
        );
        await client.query(
          `UPDATE app_private.auction_pool SET status = 'sold' WHERE room_id = $1 AND player_id = $2`,
          [roomId, p.player_id],
        );
      }
      await client.query(
        'UPDATE app_private.auction_franchises SET remaining_purse = remaining_purse - $2 WHERE id = $1',
        [team, spent.toString()],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('auction finalization', () => {
  it('ranks legal squads by exact score; each eligible teammate gets one team medal; a late advisor none', async () => {
    let late: BffClient | null = null;
    const ctx = await auction.startedAuction('fz_auc', 'fresh', {
      mates: 3,
      beforeStart: async ({ roomId, host, mates }) => {
        const code = (await host.request<TeamView>('GET', `/v1/rooms/${roomId}/team`)).body.data!
          .joinCode;
        for (const m of mates.slice(0, 2)) {
          const asked = await auction.command(m, roomId, 'team.requestJoin', {
            franchiseCode: code,
          });
          await auction.command(host, roomId, 'team.decideJoin', {
            requestId: asked.body.data!.requestId,
            approve: true,
            role: 'advisor',
            capabilities: ADVISOR_CAPABILITIES,
          });
        }
        late = mates[2]!;
      },
    });
    // The third mate is approved onto the host's team only after the start (the
    // team is otherwise full): an advisor who can watch but earns no medal.
    const lateId = (await auction.snapshot(late!, ctx.roomId)).me.memberId;
    await api.admin.query(
      `INSERT INTO app_private.franchise_members (room_id, auction_franchise_id, member_id, role, eligible_at_start, approved_at)
       VALUES ($1, $2, $3, 'advisor', false, now())`,
      [ctx.roomId, ctx.hostTeam, lateId],
    );

    // Five settled lots make the game qualifying.
    for (let i = 0; i < 5; i += 1) {
      await auction.expireLot(ctx.roomId);
      await auction.nextLot(ctx.roomId);
    }
    await stockLegalSquads(ctx.roomId, [ctx.hostTeam, ctx.guestTeam]);
    // An hour of play, everyone present throughout (the test's faked vote time
    // must not exceed the time actually played).
    await api.admin.query(
      `UPDATE app_private.room_members SET participation_ms = 3600000 WHERE room_id = $1`,
      [ctx.roomId],
    );
    await api.admin.query(
      `UPDATE app_private.rooms SET started_at = started_at - interval '1 hour' WHERE id = $1`,
      [ctx.roomId],
    );
    const vote = await auction.command(ctx.host, ctx.roomId, 'vote.start', {});
    const voteId = (vote.body.data as { voteId: string }).voteId;
    for (const c of [ctx.host, ctx.guest]) {
      expect(
        (await auction.command(c, ctx.roomId, 'vote.cast', { voteId, choice: 'end' })).status,
      ).toBe(200);
    }
    await api.admin.query(
      `UPDATE app_private.end_votes SET starts_at = starts_at - interval '16 s', expires_at = expires_at - interval '16 s' WHERE id = $1`,
      [voteId],
    );
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 s' WHERE room_id = $1 AND kind = 'room.vote_resolve'`,
      [ctx.roomId],
    );
    await auction.duePass();
    for (let i = 0; i < 20; i += 1) {
      if ((await auction.snapshot(ctx.host, ctx.roomId)).room.lifecycle === 'RESULTS') break;
      await auction.duePass();
    }
    const dto = ResultDTOSchema.parse(
      (await ctx.host.request<ResultDTO>('GET', `/v1/rooms/${ctx.roomId}/results`)).body.data,
    );
    expect(dto.qualificationStatus).toBe('qualifying');
    expect(dto.evaluatorVersion).toBe('squad-eval-v1');
    expect(dto.rankings.map((r) => [r.rank, r.eligible])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(dto.rankings.map((r) => r.medal)).toEqual(['gold', 'silver']); // no fictitious bronze
    for (const report of dto.publicScoreReports!) {
      expect(report.legal).toBe(true);
      expect(report.xi).toHaveLength(11);
      expect(report.xi.every((p) => p.portraitUrl)).toBe(true); // ADR-017
      expect(report.total).toBeGreaterThan(0);
    }
    const hostRank = dto.rankings.find((r) => r.competitorId === ctx.hostTeam)!;
    expect(hostRank.members!.map((m) => [m.credited, m.reason]).sort()).toEqual(
      [
        [false, 'late_join'],
        [true, null],
        [true, null],
        [true, null],
      ].sort(),
    );
    const minted = await receipts(ctx.roomId);
    expect(minted).toHaveLength(4); // 3 host teammates + the guest captain; never the late advisor
    expect(new Set(minted.map((r) => r.user_id)).size).toBe(4);
    expect(minted.every((r) => r.scope === 'franchise')).toBe(true);
    const hostTeamMedal = hostRank.medal;
    expect(minted.filter((r) => r.medal === hostTeamMedal)).toHaveLength(
      hostTeamMedal === 'gold' ? 3 : 3,
    );

    // Retried evaluation and finalization change nothing.
    await api.admin.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, 'auction.evaluate', NULL, 0, now()) ON CONFLICT DO NOTHING`,
      [ctx.roomId],
    );
    await auction.duePass();
    await auction.duePass();
    expect(await receipts(ctx.roomId)).toEqual(minted);
  });
});
