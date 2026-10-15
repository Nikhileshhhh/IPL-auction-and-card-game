import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADVISOR_CAPABILITIES,
  ResultDTOSchema,
  type ResultDTO,
  type TeamView,
} from '@stumps/contracts';
import { moveGameplayClocks } from '../../apps/server/src/modules/voting/clocks';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { auctionHelpers } from '../support/auction';
import { cardHelpers, publishDemoPack } from '../support/cards';

/**
 * End-game voting (rules §12, ADR-029): host-started, exactly 15 s on the DB
 * clock, a frozen electorate (offline included), Yes ≥ ⌊N/2⌋+1 of N, every
 * gameplay clock frozen and restored with exactly its remaining time.
 * Time is advanced by moving the vote and the frozen clocks back together.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_voting');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const cards = cardHelpers(() => api);
const auction = auctionHelpers(() => api);
const { command, duePass, snapshot, live, bid, startedAuction } = auction;

type Ok = { voteId: string; expiresAt: string; threshold: number };
const startVote = (c: BffClient, roomId: string) => command(c, roomId, 'vote.start', {});
const cast = (c: BffClient, roomId: string, voteId: string, choice: 'end' | 'continue') =>
  command(c, roomId, 'vote.cast', { voteId, choice });

/** As if `ms` passed during the open vote: its clock and the frozen clocks move together. */
async function elapse(roomId: string, ms: number) {
  const by = `make_interval(secs => ${ms / 1000})`;
  await api.admin.query(
    `UPDATE app_private.end_votes SET starts_at = starts_at - ${by}, expires_at = expires_at - ${by}
      WHERE room_id = $1 AND status = 'open'`,
    [roomId],
  );
  await api.admin.query(
    `UPDATE app_private.deadline_jobs SET due_at = due_at - ${by}
      WHERE room_id = $1 AND kind = 'room.vote_resolve'`,
    [roomId],
  );
  await api.admin.query(
    `UPDATE app_private.rooms r
        SET saved_phase = jsonb_set(r.saved_phase, '{expiresAt}',
              to_jsonb(to_char(v.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
       FROM app_private.end_votes v
      WHERE r.id = $1 AND v.room_id = r.id AND v.status = 'open'`,
    [roomId],
  );
  await moveGameplayClocks(api.admin as never, roomId, -ms);
}

const errorCode = (res: { body: { error?: { code: string } } }) => res.body.error?.code;

describe('card votes', () => {
  it('a strict majority ends the match at once, ranked with every card accounted for', async () => {
    const { roomId, players } = await cards.startedMatch('vt_pass');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    expect(errorCode(await startVote(guest, roomId))).toBe('FORBIDDEN');
    const started = await startVote(host, roomId);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const vote = started.body.data as unknown as Ok;
    expect(vote.threshold).toBe(2);
    expect(errorCode(await startVote(host, roomId))).toBe('VOTE_IN_PROGRESS');

    const view = (await snapshot(guest, roomId)).openVote!;
    expect(view).toMatchObject({ electorateCount: 2, threshold: 2, canVote: true, status: 'open' });
    // Gameplay is frozen: no category can be chosen while the room votes.
    const game = (await cards.snapshot(host, roomId)).game!;
    const selector = cards.selectorOf(players, game);
    const frozen = await cards.command(selector.client, roomId, {
      comparisonId: game.comparisonId,
      metric: 'batting',
    });
    expect(errorCode(frozen)).toBe('GAME_PAUSED');
    expect((frozen.body.error!.details as { reason: string }).reason).toBe('VOTE');

    const first = await cast(host, roomId, vote.voteId, 'end');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await cast(host, roomId, vote.voteId, 'end');
    expect(again.body.data).toEqual(first.body.data); // identical retry, same receipt
    expect(errorCode(await cast(host, roomId, vote.voteId, 'continue'))).toBe('VOTE_ALREADY_CAST');
    expect((await snapshot(host, roomId)).openVote).toMatchObject({
      canVote: false,
      myRecordedChoice: 'end',
    });
    expect((await cast(guest, roomId, vote.voteId, 'end')).status).toBe(200);

    // Nothing resolves early, even with every ballot in.
    await duePass();
    expect((await snapshot(host, roomId)).room.lifecycle).toBe('RUNNING');
    await elapse(roomId, 15_000);
    await duePass();
    await duePass(); // a restart re-running the pass resolves nothing twice
    const snap = await snapshot(host, roomId);
    expect(snap.room.lifecycle).toBe('RESULTS');
    expect(snap.openVote).toBeNull();
    const resolved = await auction.publicEvents(roomId, 'vote.resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.payload).toMatchObject({ yes: 2, no: 0, abstain: 0, passed: true });
    const after = (await cards.snapshot(host, roomId)).game!;
    expect(after.result!.reason).toBe('vote');
    expect(after.seats.reduce((n, s) => n + s.deckCount, 0)).toBe(after.totalCards);
    const results = await host.request<ResultDTO>('GET', `/v1/rooms/${roomId}/results`);
    const dto = ResultDTOSchema.parse(results.body.data);
    expect(dto.completionReason).toBe('vote');
    expect(dto.qualificationStatus).toBe('practice'); // fewer than 5 decided contests
    expect(dto.rankings.every((r) => r.medal === null)).toBe(true);
    const receipts = await api.admin.query(
      `SELECT 1 FROM app_private.achievement_receipts a JOIN app_private.rooms r ON r.award_batch = a.award_batch
        WHERE r.id = $1`,
      [roomId],
    );
    expect(receipts.rowCount).toBe(0);
  });

  it('abstentions fail; each clock resumes with exactly its remaining time; cooldown and limit', async () => {
    const { roomId, players } = await cards.startedMatch('vt_fail');
    const [host] = players.map((p) => p.client) as [BffClient, BffClient];
    const vote = (await startVote(host, roomId)).body.data as unknown as Ok;
    expect((await cast(host, roomId, vote.voteId, 'end')).status).toBe(200); // 1 of 2: not enough
    await elapse(roomId, 15_000);
    await duePass();
    const row = (
      await api.admin.query<{
        status: string;
        saved_timers: { kind: string; remainingMs: number }[];
        resolved_at: Date;
      }>('SELECT status, saved_timers, resolved_at FROM app_private.end_votes WHERE id = $1', [
        vote.voteId,
      ])
    ).rows[0]!;
    expect(row.status).toBe('failed');
    const saved = row.saved_timers.find((t) => t.kind === 'card.selection_timeout')!.remainingMs;
    const deadline = (
      await api.admin.query<{ phase_deadline: Date }>(
        'SELECT phase_deadline FROM app_private.card_games WHERE room_id = $1',
        [roomId],
      )
    ).rows[0]!.phase_deadline;
    const restored = deadline.getTime() - row.resolved_at.getTime();
    expect(restored).toBeGreaterThanOrEqual(saved);
    expect(restored).toBeLessThanOrEqual(saved + 1); // ms rounding of the saved value
    const resolved = (await auction.publicEvents(roomId, 'vote.resolved'))[0]!.payload;
    expect(resolved).toMatchObject({ yes: 1, no: 0, abstain: 1, passed: false });
    expect((await snapshot(host, roomId)).room.lifecycle).toBe('RUNNING');

    expect(errorCode(await startVote(host, roomId))).toBe('VOTE_COOLDOWN');
    await api.admin.query(
      `UPDATE app_private.rooms SET last_vote_resolved_at = now() - interval '121 seconds' WHERE id = $1`,
      [roomId],
    );
    const second = (await startVote(host, roomId)).body.data as unknown as Ok;
    for (const p of players)
      expect((await cast(p.client, roomId, second.voteId, 'continue')).status).toBe(200);
    await elapse(roomId, 15_000);
    await duePass();
    expect((await auction.publicEvents(roomId, 'vote.resolved')).at(-1)!.payload).toMatchObject({
      no: 2,
      passed: false,
    });
    await api.admin.query(
      `UPDATE app_private.rooms SET vote_failures = 3, last_vote_resolved_at = now() - interval '1 hour' WHERE id = $1`,
      [roomId],
    );
    expect(errorCode(await startVote(host, roomId))).toBe('VOTE_LIMIT');
  });

  it('a ballot at the expiry is too late; the database refuses one after it', async () => {
    const { roomId, players } = await cards.startedMatch('vt_exp');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    const vote = (await startVote(host, roomId)).body.data as unknown as Ok;
    await elapse(roomId, 15_000); // now ≥ expiresAt: the due resolution runs before the ballot
    expect(errorCode(await cast(guest, roomId, vote.voteId, 'end'))).toBe('VOTE_EXPIRED');
    const failing = api.admin.query(
      `UPDATE app_private.vote_electorate e SET choice = 'end', cast_at = v.expires_at
         FROM app_private.end_votes v WHERE v.id = e.vote_id AND e.vote_id = $1`,
      [vote.voteId],
    );
    await expect(failing).rejects.toThrow(/after vote expiry|already cast/);
  });
});

describe('auction votes', () => {
  it('no sale while the room votes; failure restores the lot clock; a pass ends the auction', async () => {
    const { roomId, host, guest } = await startedAuction('vt_auc');
    expect((await bid(host, roomId)).status).toBe(200);
    const vote = (await startVote(host, roomId)).body.data as unknown as Ok;
    expect(vote.threshold).toBe(2); // two franchises
    expect(errorCode(await bid(guest, roomId))).toBe('GAME_PAUSED');
    // Even an overdue lot clock cannot sell during the vote.
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'auction.bidding_deadline'`,
      [roomId],
    );
    await duePass();
    expect(await auction.acquisitions(roomId)).toEqual([]);
    expect((await live(host, roomId)).lot).not.toBeNull();

    await elapse(roomId, 15_000);
    await duePass(); // nobody voted: fails
    expect((await auction.publicEvents(roomId, 'vote.resolved')).at(-1)!.payload).toMatchObject({
      passed: false,
      resumedPhase: 'Bidding',
    });
    expect(await auction.acquisitions(roomId)).toEqual([]);

    await api.admin.query(
      `UPDATE app_private.rooms SET last_vote_resolved_at = now() - interval '121 seconds' WHERE id = $1`,
      [roomId],
    );
    const second = (await startVote(host, roomId)).body.data as unknown as Ok;
    expect(second.threshold).toBe(2);
    for (const c of [host, guest])
      expect((await cast(c, roomId, second.voteId, 'end')).status).toBe(200);
    await elapse(roomId, 15_000);
    await duePass();
    expect((await snapshot(host, roomId)).room.lifecycle).toBe('FINALIZING');
    expect(await auction.acquisitions(roomId)).toEqual([]); // the open lot was cancelled, not sold
    await duePass(); // squad evaluation
    const snap = await snapshot(host, roomId);
    expect(snap.room.lifecycle).toBe('RESULTS');
    const dto = ResultDTOSchema.parse(
      (await host.request<ResultDTO>('GET', `/v1/rooms/${roomId}/results`)).body.data,
    );
    expect(dto).toMatchObject({ gameType: 'auction', completionReason: 'vote' });
    expect(dto.rankings).toHaveLength(2);
    expect(dto.rankings.every((r) => !r.eligible && r.medal === null)).toBe(true);
    expect(dto.publicScoreReports!.every((r) => r.deficits.length > 0)).toBe(true);
  });

  it('one franchise, one vote: the frozen representative only; co-captain for an absent captain', async () => {
    let mateId = '';
    const ctx = await startedAuction('vt_rep', 'fresh', {
      mates: 1,
      beforeStart: async ({ roomId, host, mates }) => {
        const code = (await host.request<TeamView>('GET', `/v1/rooms/${roomId}/team`)).body.data!
          .joinCode;
        const asked = await command(mates[0]!, roomId, 'team.requestJoin', { franchiseCode: code });
        await command(host, roomId, 'team.decideJoin', {
          requestId: asked.body.data!.requestId,
          approve: true,
          role: 'advisor',
          capabilities: ADVISOR_CAPABILITIES,
        });
        mateId = (await snapshot(mates[0]!, roomId)).me.memberId;
      },
    });
    const mate = ctx.mates[0]!;
    const hostId = (await snapshot(ctx.host, ctx.roomId)).me.memberId;
    const vote = (await startVote(ctx.host, ctx.roomId)).body.data as unknown as Ok;
    expect((await snapshot(mate, ctx.roomId)).openVote).toMatchObject({
      electorateCount: 2, // two franchises, however many people
      canVote: false,
      representativeMemberId: hostId,
    });
    expect(errorCode(await cast(mate, ctx.roomId, vote.voteId, 'end'))).toBe('FORBIDDEN');
    await elapse(ctx.roomId, 15_000);
    await duePass();

    // The designated co-captain represents a captain away beyond the grace.
    await api.admin.query(
      `UPDATE app_private.franchise_members SET role = 'cocaptain' WHERE member_id = $1`,
      [mateId],
    );
    await api.admin.query(
      `UPDATE app_private.room_members SET last_seen_at = now() - interval '2 minutes' WHERE id = $1`,
      [hostId],
    );
    await api.admin.query(`DELETE FROM app_private.room_connections WHERE member_id = $1`, [
      hostId,
    ]);
    await api.admin.query(
      `INSERT INTO app_private.room_connections (room_id, member_id, socket_id, instance_id, expires_at)
       VALUES ($1, $2, 'test-socket-cocaptain', gen_random_uuid(), now() + interval '1 minute')`,
      [ctx.roomId, mateId],
    );
    await api.admin.query(
      `UPDATE app_private.rooms SET last_vote_resolved_at = now() - interval '121 seconds' WHERE id = $1`,
      [ctx.roomId],
    );
    const next = (await startVote(ctx.host, ctx.roomId)).body.data as unknown as Ok;
    expect(errorCode(await cast(ctx.host, ctx.roomId, next.voteId, 'end'))).toBe('FORBIDDEN');
    expect((await cast(mate, ctx.roomId, next.voteId, 'end')).status).toBe(200);
  });
});
