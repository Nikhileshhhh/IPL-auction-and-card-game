import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_CODE, createTestApi, type BffClient, type TestApi } from '../support/api';
import { cardHelpers, publishDemoPack } from '../support/cards';

/**
 * End-game votes under concurrency (rules §12, E54): one open vote per room,
 * one immutable ballot per elector, and a vote can never race a game that a
 * due deadline has already finished.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_cc_voting');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, startedMatch } = cardHelpers(() => api);

async function send(client: BffClient, roomId: string, type: string, payload: object) {
  const snap = await snapshot(client, roomId);
  return {
    snap,
    fire: () =>
      client.mutate<Record<string, unknown>>('POST', `/v1/rooms/${roomId}/commands`, {
        type,
        commandId: randomUUID(),
        roomId,
        expectedVersion: snap.room.stateVersion,
        controlEpoch: snap.me.controlEpoch,
        payload,
      }),
  };
}

describe('votes are serial under the room lock', () => {
  it('parallel starts open exactly one vote', async () => {
    const { roomId, players } = await startedMatch(`cc_vs_${randomUUID().slice(0, 6)}`);
    const { fire } = await send(players[0]!.client, roomId, 'vote.start', {});
    const results = await Promise.all(Array.from({ length: 20 }, fire));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status !== 200)
        .every((r) => r.body.error?.code === 'VOTE_IN_PROGRESS'),
    ).toBe(true);
    const open = await api.admin.query(
      `SELECT 1 FROM app_private.end_votes WHERE room_id = $1 AND status = 'open'`,
      [roomId],
    );
    expect(open.rowCount).toBe(1);
  });

  it('a storm of ballots from one elector records exactly one immutable choice', async () => {
    const { roomId, players } = await startedMatch(`cc_vb_${randomUUID().slice(0, 6)}`);
    const started = await (await send(players[0]!.client, roomId, 'vote.start', {})).fire();
    const voteId = (started.body.data as { voteId: string }).voteId;
    const end = await send(players[1]!.client, roomId, 'vote.cast', { voteId, choice: 'end' });
    const cont = await send(players[1]!.client, roomId, 'vote.cast', {
      voteId,
      choice: 'continue',
    });
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => (i % 2 ? cont.fire() : end.fire())),
    );
    const ok = results.filter((r) => r.status === 200);
    const choices = new Set(
      ok.map((r) => (r.body.data as { receipt: { choice: string } }).receipt.choice),
    );
    expect(choices.size).toBe(1); // every success is the same recorded choice
    const refused = results.filter((r) => r.status !== 200);
    expect(refused.every((r) => r.body.error?.code === 'VOTE_ALREADY_CAST')).toBe(true);
    const stored = await api.admin.query<{ choice: string }>(
      `SELECT choice FROM app_private.vote_electorate WHERE vote_id = $1 AND choice IS NOT NULL`,
      [voteId],
    );
    expect(stored.rows.map((r) => r.choice)).toEqual([...choices]);
  });

  it('a due ending settles first: a vote cannot be opened on a finished match', async () => {
    const { roomId, players } = await startedMatch(`cc_vn_${randomUUID().slice(0, 6)}`);
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'card.hard_limit'`,
      [roomId],
    );
    const { fire } = await send(players[0]!.client, roomId, 'vote.start', {});
    const results = await Promise.all(Array.from({ length: 5 }, fire));
    expect(results.every((r) => r.body.error?.code === 'ALREADY_COMPLETED')).toBe(true);
    const votes = await api.admin.query('SELECT 1 FROM app_private.end_votes WHERE room_id = $1', [
      roomId,
    ]);
    expect(votes.rowCount).toBe(0);
    expect((await snapshot(players[0]!.client, roomId)).room.lifecycle).toBe('RESULTS');
  });
});
