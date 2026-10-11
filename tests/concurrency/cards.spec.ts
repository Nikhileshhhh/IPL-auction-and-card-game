import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDuePass } from '../../apps/server/src/jobs/deadlines';
import { ACCESS_CODE, createTestApi, type TestApi } from '../support/api';
import { cardHelpers, publishDemoPack } from '../support/cards';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_cc_cards');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, startedMatch, selectorOf } = cardHelpers(() => api);

const resolvedCount = async (roomId: string) =>
  (
    await api.admin.query(
      `SELECT 1 FROM app_private.card_comparisons WHERE room_id = $1 AND status <> 'open'`,
      [roomId],
    )
  ).rowCount;

describe('card transitions under the room lock (rules §7)', () => {
  it('two different category commands for one comparison: exactly one transition', async () => {
    const { roomId, players } = await startedMatch(`cc_dup_${randomUUID().slice(0, 6)}`);
    const snap = await snapshot(players[0]!.client, roomId);
    const selector = selectorOf(players, snap.game!);
    const mine = await snapshot(selector.client, roomId);
    const send = (metric: string) =>
      selector.client.mutate('POST', `/v1/rooms/${roomId}/commands`, {
        type: 'card.selectCategory',
        commandId: randomUUID(),
        roomId,
        expectedVersion: mine.room.stateVersion,
        controlEpoch: mine.me.controlEpoch,
        payload: { comparisonId: mine.game!.comparisonId, metric },
      });
    const results = await Promise.all([send('batting'), send('bowling'), send('form')]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(['STALE_COMPARISON', 'VERSION_CONFLICT']).toContain(r.body.error!.code);
    }
    expect(await resolvedCount(roomId)).toBe(1);
  });

  it('a command racing the timeout worker: the comparison resolves once', async () => {
    const { roomId, players } = await startedMatch(`cc_race_${randomUUID().slice(0, 6)}`);
    const snap = await snapshot(players[0]!.client, roomId);
    const selector = selectorOf(players, snap.game!);
    const mine = await snapshot(selector.client, roomId);
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'card.selection_timeout'`,
      [roomId],
    );
    const [cmd] = await Promise.all([
      selector.client.mutate('POST', `/v1/rooms/${roomId}/commands`, {
        type: 'card.selectCategory',
        commandId: randomUUID(),
        roomId,
        expectedVersion: mine.room.stateVersion,
        controlEpoch: mine.me.controlEpoch,
        payload: { comparisonId: mine.game!.comparisonId, metric: 'batting' },
      }),
      runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined),
    ]);
    // Whichever takes the room lock first, the already-due timeout is settled
    // before the command is considered, so the command finds a closed comparison.
    expect(cmd.status).toBe(409);
    expect(cmd.body.error!.code).toBe('STALE_COMPARISON');
    await runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined);
    const after = (await snapshot(selector.client, roomId)).game!;
    expect(after.lastComparison).toMatchObject({
      comparisonId: mine.game!.comparisonId,
      byTimeout: true,
    });
    expect(await resolvedCount(roomId)).toBe(1);
    const total =
      after.seats.reduce((n, s) => n + s.deckCount, 0) + after.visibleCards.length + after.potCount;
    expect(total).toBe(8);
  });
});
