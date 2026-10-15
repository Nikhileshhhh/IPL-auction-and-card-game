import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CARD_EVENT_PAYLOADS,
  PermittedCardSnapshotSchema,
  ResultDTOSchema,
  type ResultDTO,
} from '@stumps/contracts';
import { seedCommitment } from '@stumps/game-engines';
import { runDuePass } from '../../apps/server/src/jobs/deadlines';
import { ACCESS_CODE, createTestApi, type TestApi } from '../support/api';
import { cardHelpers, publishDemoPack } from '../support/cards';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_cards');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const { snapshot, startedMatch, command, selectorOf, publicEvents } = cardHelpers(() => api);

describe('card match start (rules §4, DB spec §10)', () => {
  it('deals evenly, opens the first comparison and commits the seed without revealing it', async () => {
    const { roomId, players } = await startedMatch('cs_start');
    const snap = await snapshot(players[0]!.client, roomId);
    expect(snap.room.lifecycle).toBe('RUNNING');
    const game = PermittedCardSnapshotSchema.parse(snap.game);
    expect(game.totalCards).toBe(8);
    expect(game.seats.map((s) => s.deckCount)).toEqual([3, 3]); // 4 each, top card revealed
    expect(game.visibleCards).toHaveLength(2);
    for (const v of game.visibleCards) {
      expect(v.card.players[0]!.portraitUrl).toBeTruthy(); // ADR-017: photo on every card
    }
    expect(game.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(game.auditSeed).toBeNull();
    expect(game.deadline).not.toBeNull();
    const selector = selectorOf(players, game);
    const other = players.find((p) => p !== selector)!;
    expect((await snapshot(selector.client, roomId)).game!.myAllowedActions).toContain(
      'card.selectCategory',
    );
    expect((await snapshot(other.client, roomId)).game!.myAllowedActions).not.toContain(
      'card.selectCategory',
    );

    // Each player sees only their own deck, in play order (ADR-021 §5a);
    // no event and no other player's snapshot exposes it, nor the seed.
    const decks = await api.admin.query<{ id: string; owner: string }>(
      `SELECT id, owner_member_id AS owner FROM app_private.card_instances
        WHERE room_id = $1 AND location = 'DECK' ORDER BY owner_member_id, ordinal`,
      [roomId],
    );
    expect(decks.rowCount).toBe(6);
    const sealed = await api.admin.query<{ seed_ciphertext: Buffer }>(
      'SELECT seed_ciphertext FROM app_private.rooms WHERE id = $1',
      [roomId],
    );
    const seedHex = api.secrets.encryptor.decrypt(
      sealed.rows[0]!.seed_ciphertext.toString('utf8'),
      `card-seed:${roomId}`,
    );
    const eventText = JSON.stringify(await publicEvents(roomId));
    for (const { id } of decks.rows) expect(eventText).not.toContain(id);
    for (const p of players) {
      const view = await snapshot(p.client, roomId);
      const own = decks.rows.filter((d) => d.owner === p.memberId).map((d) => d.id);
      const others = decks.rows.filter((d) => d.owner !== p.memberId).map((d) => d.id);
      expect(view.game!.myDeck.map((c) => c.instanceId)).toEqual(own);
      for (const c of view.game!.myDeck) expect(c.players[0]!.portraitUrl).toBeTruthy();
      const text = JSON.stringify(view);
      for (const id of others) expect(text).not.toContain(id);
      expect(text).not.toContain(seedHex);
    }

    const events = (await publicEvents(roomId)).filter((e) => !e.type.startsWith('room.'));
    expect(events.map((e) => e.type)).toEqual(['game.started', 'card.roundOpened']);
    expect(events[0]!.payload).toMatchObject({ seedCommitment: game.seedCommitment });
  });
});

describe('card commands (DB/realtime §8.2)', () => {
  it('only the selector may choose, only for the open comparison, at the current version', async () => {
    const { roomId, players } = await startedMatch('cs_cmd');
    const game = (await snapshot(players[0]!.client, roomId)).game!;
    const selector = selectorOf(players, game);
    const other = players.find((p) => p !== selector)!;

    const notMine = await command(other.client, roomId, {
      comparisonId: game.comparisonId,
      metric: 'batting',
    });
    expect(notMine.status).toBe(403);
    expect(notMine.body.error!.code).toBe('SELECTOR_ONLY');

    const stale = await command(selector.client, roomId, {
      comparisonId: randomUUID(),
      metric: 'batting',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error!.code).toBe('STALE_COMPARISON');

    const behind = await command(
      selector.client,
      roomId,
      { comparisonId: game.comparisonId, metric: 'batting' },
      { expectedVersion: '0' },
    );
    expect(behind.status).toBe(409);
    expect(behind.body.error!.code).toBe('VERSION_CONFLICT');

    const bad = await command(selector.client, roomId, {
      comparisonId: game.comparisonId,
      metric: 'luck',
    });
    expect(bad.status).toBe(400);

    // A retried command is applied once and answered from its receipt.
    const commandId = randomUUID();
    const version = (await snapshot(selector.client, roomId)).room.stateVersion;
    const first = await command(
      selector.client,
      roomId,
      { comparisonId: game.comparisonId, metric: 'batting' },
      { commandId, expectedVersion: version },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const retry = await command(
      selector.client,
      roomId,
      { comparisonId: game.comparisonId, metric: 'batting' },
      { commandId, expectedVersion: version },
    );
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);
    const resolved = await api.admin.query(
      `SELECT 1 FROM app_private.card_comparisons WHERE room_id = $1 AND status <> 'open'`,
      [roomId],
    );
    expect(resolved.rowCount).toBe(1);

    const after = (await snapshot(selector.client, roomId)).game!;
    expect(after.lastComparison).toMatchObject({
      comparisonId: game.comparisonId,
      metric: 'batting',
      byTimeout: false,
    });
    expect(
      after.seats.reduce((n, s) => n + s.deckCount, 0) + after.visibleCards.length + after.potCount,
    ).toBe(8);

    const ack = await command(
      other.client,
      roomId,
      { comparisonId: after.comparisonId ?? game.comparisonId },
      { type: 'card.revealAcknowledged' },
    );
    expect(ack.status).toBe(200);
  });

  it('decks are queues: the front card plays, won cards join the back in order', async () => {
    const { roomId, players } = await startedMatch('cs_queue');
    const game = (await snapshot(players[0]!.client, roomId)).game!;
    const selector = selectorOf(players, game);
    const before = new Map(
      await Promise.all(
        players.map(async (p) => [p.memberId, (await snapshot(p.client, roomId)).game!] as const),
      ),
    );
    const res = await command(selector.client, roomId, {
      comparisonId: game.comparisonId,
      metric: 'batting',
    });
    expect(res.status).toBe(200);
    const after = (await snapshot(selector.client, roomId)).game!;
    const last = after.lastComparison!;
    if (!last.winnerId) return; // a tie keeps the pot; covered by the engine tests
    const winner = players.find((p) => p.memberId === last.winnerId)!;
    const was = before.get(winner.memberId)!;
    const now = (await snapshot(winner.client, roomId)).game!;
    const played = game.visibleCards.map((v) => v.card.instanceId); // seat order
    // The rest of the old queue moves up; the revealed card is now in play;
    // the won cards (both revealed cards, in seat order) are at the back.
    const ids = [
      ...now.visibleCards
        .filter((v) => v.memberId === winner.memberId)
        .map((v) => v.card.instanceId),
      ...now.myDeck.map((c) => c.instanceId),
    ];
    expect(ids).toEqual([...was.myDeck.map((c) => c.instanceId), ...played]);
  });

  it('plays to the end; the seed is disclosed and matches the commitment', async () => {
    const { roomId, players } = await startedMatch('cs_full');
    let game = (await snapshot(players[0]!.client, roomId)).game!;
    for (let i = 0; i < 400 && !game.result; i += 1) {
      const selector = selectorOf(players, game);
      const res = await command(selector.client, roomId, {
        comparisonId: game.comparisonId,
        metric: (['batting', 'bowling', 'runs'] as const)[i % 3],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      game = (await snapshot(players[0]!.client, roomId)).game!;
      const total =
        game.seats.reduce((n, s) => n + s.deckCount, 0) + game.visibleCards.length + game.potCount;
      expect(total).toBe(8); // conservation at every step
    }
    expect(game.result).not.toBeNull();
    expect(game.result!.standings).toHaveLength(2);
    expect(game.myAllowedActions).toEqual([]);
    const snap = await snapshot(players[1]!.client, roomId);
    expect(snap.room.lifecycle).toBe('RESULTS');

    const meta = await api.admin.query<{ room_nonce: string; config_hash: string }>(
      'SELECT room_nonce, config_hash FROM app_private.card_games WHERE room_id = $1',
      [roomId],
    );
    const seed = Uint8Array.from(Buffer.from(game.auditSeed!, 'hex'));
    expect(seedCommitment(seed, meta.rows[0]!.room_nonce, meta.rows[0]!.config_hash)).toBe(
      game.seedCommitment,
    );
    const events = await publicEvents(roomId);
    expect(events.at(-1)!.type).toBe('game.completed');
    // Every card event matches its published payload schema.
    for (const e of events) {
      const schema = CARD_EVENT_PAYLOADS[e.type as keyof typeof CARD_EVENT_PAYLOADS];
      if (schema) expect(() => schema.parse(e.payload), e.type).not.toThrow();
    }
    PermittedCardSnapshotSchema.parse(game);
    // Phase 14: the result is final at once, with medals for eligible players.
    expect(snap.results).toMatchObject({ status: 'ready', progressPercent: 100 });
    const results = await players[0]!.client.request<ResultDTO>(
      'GET',
      `/v1/rooms/${roomId}/results`,
    );
    expect(results.status, JSON.stringify(results.body)).toBe(200);
    const dto = ResultDTOSchema.parse(results.body.data);
    expect(dto.rankings.map((r) => r.competitorId)).toEqual(game.result!.standings);
    expect(dto.seedAudit?.seed).toBe(game.auditSeed);
    expect((events.at(-1)!.payload as { resultsExpiresAt: string }).resultsExpiresAt).toBe(
      dto.resultsExpiresAt,
    );
    // Events carry the state version their own transition produced.
    const versions = events.map((e) => BigInt(e.state_version));
    expect(versions).toEqual([...versions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe('card deadlines (ADR-007)', () => {
  it('a missed selection is resolved by the public timeout policy', async () => {
    const { roomId, players } = await startedMatch('cs_timeout');
    const before = await snapshot(players[0]!.client, roomId);
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'card.selection_timeout'`,
      [roomId],
    );
    const processed = await runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined);
    expect(processed).toBeGreaterThanOrEqual(1);
    const after = await snapshot(players[0]!.client, roomId);
    expect(after.game!.lastComparison).toMatchObject({
      comparisonId: before.game!.comparisonId,
      byTimeout: true,
    });
    expect(BigInt(after.room.stateVersion)).toBe(BigInt(before.room.stateVersion) + 1n);
    const events = await publicEvents(roomId);
    const resolved = events.find((e) => e.type === 'card.comparisonResolved')!;
    expect(resolved.state_version).toBe(after.room.stateVersion);

    // The old job is gone; a new one exists for the new comparison only.
    const jobs = await api.admin.query<{ subject_id: string }>(
      `SELECT subject_id FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'card.selection_timeout'`,
      [roomId],
    );
    if (after.game!.comparisonId) {
      expect(jobs.rows.map((j) => j.subject_id)).toEqual([after.game!.comparisonId]);
    } else {
      expect(jobs.rowCount).toBe(0);
    }
  });

  it('a timeout due before a command is settled first; the late command is stale', async () => {
    const { roomId, players } = await startedMatch('cs_settle');
    const game = (await snapshot(players[0]!.client, roomId)).game!;
    const selector = selectorOf(players, game);
    const snap = await snapshot(selector.client, roomId);
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'card.selection_timeout'`,
      [roomId],
    );
    const late = await selector.client.mutate('POST', `/v1/rooms/${roomId}/commands`, {
      type: 'card.selectCategory',
      commandId: randomUUID(),
      roomId,
      expectedVersion: snap.room.stateVersion,
      controlEpoch: snap.me.controlEpoch,
      payload: { comparisonId: game.comparisonId, metric: 'batting' },
    });
    expect(late.status).toBe(409);
    expect(late.body.error!.code).toBe('STALE_COMPARISON');
    // The refused command rolled back, so the worker still applies the timeout once.
    await runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined);
    const after = (await snapshot(selector.client, roomId)).game!;
    expect(after.lastComparison).toMatchObject({
      comparisonId: game.comparisonId,
      byTimeout: true,
    });
  });

  const makeDue = (roomId: string, kind: string) =>
    api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = $2`,
      [roomId, kind],
    );
  const duePass = () => runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined);

  it('the soft time limit mid-chain waits for the contest, then ends at the boundary', async () => {
    const { roomId, players } = await startedMatch('cs_limit');
    await makeDue(roomId, 'card.match_limit');
    await duePass();
    let snap = await snapshot(players[0]!.client, roomId);
    expect(snap.room.lifecycle).toBe('RUNNING'); // the open contest may still be played
    expect(snap.game!.finishPending).toBe('time_limit');
    expect(snap.game!.comparisonId).not.toBeNull();
    const finalizing = (await publicEvents(roomId)).find((e) => e.type === 'game.finalizing');
    expect(finalizing?.payload).toMatchObject({ stage: 'finish_pending', reason: 'time_limit' });
    const grace = await api.admin.query(
      `SELECT 1 FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'card.finish_grace'`,
      [roomId],
    );
    expect(grace.rowCount).toBe(1);

    // Play the contest out (ties included); the match ends at the next boundary.
    for (let i = 0; i < 20 && !snap.game!.result; i += 1) {
      const selector = selectorOf(players, snap.game!);
      const res = await command(selector.client, roomId, {
        comparisonId: snap.game!.comparisonId,
        metric: 'batting',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      snap = await snapshot(players[0]!.client, roomId);
    }
    expect(snap.room.lifecycle).toBe('RESULTS');
    expect(snap.game!.result).toMatchObject({ reason: 'time_limit' });
    expect(snap.game!.finishPending).toBeNull();
    expect(snap.game!.seats.reduce((n, s) => n + s.deckCount, 0)).toBe(8);
    const jobs = await api.admin.query(
      `SELECT kind FROM app_private.deadline_jobs WHERE room_id = $1 AND kind LIKE 'card.%'`,
      [roomId],
    );
    expect(jobs.rowCount).toBe(0); // grace, hard limit and selection timers are cleared
  });

  it('an unsettled chain at grace expiry is restored to deck fronts, then ranked', async () => {
    const { roomId, players } = await startedMatch('cs_grace');
    await makeDue(roomId, 'card.match_limit');
    await duePass();
    await makeDue(roomId, 'card.finish_grace');
    await duePass();
    const snap = await snapshot(players[0]!.client, roomId);
    expect(snap.room.lifecycle).toBe('RESULTS');
    expect(snap.game!.result).toMatchObject({ reason: 'time_limit' });
    expect(snap.game!.seats.map((s) => s.deckCount)).toEqual([4, 4]);
    expect(snap.game!.visibleCards).toEqual([]);
    const cancelled = await api.admin.query(
      `SELECT 1 FROM app_private.card_comparisons WHERE room_id = $1 AND status = 'cancelled'`,
      [roomId],
    );
    expect(cancelled.rowCount).toBe(1);
    expect(snap.game!.auditSeed).toMatch(/^[0-9a-f]{64}$/); // disclosed only now
  });

  it('the hard ceiling always ends the match at once, restoring the open chain', async () => {
    const { roomId, players } = await startedMatch('cs_hard', { matchMinutes: null });
    const before = await snapshot(players[0]!.client, roomId);
    expect(before.game!.auditSeed).toBeNull();
    await makeDue(roomId, 'card.hard_limit');
    await duePass();
    const snap = await snapshot(players[0]!.client, roomId);
    expect(snap.room.lifecycle).toBe('RESULTS');
    expect(snap.game!.result).toMatchObject({ reason: 'time_limit' });
    expect(snap.game!.seats.map((s) => s.deckCount)).toEqual([4, 4]);
  });

  it('a stale grace job after the match ended is a no-op', async () => {
    const { roomId, players } = await startedMatch('cs_stale_grace');
    await makeDue(roomId, 'card.hard_limit');
    await duePass();
    const ended = await snapshot(players[0]!.client, roomId);
    await api.admin.query(
      `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
       VALUES ($1, 'card.finish_grace', NULL, 0, now() - interval '1 second')`,
      [roomId],
    );
    await duePass();
    const after = await snapshot(players[0]!.client, roomId);
    expect(after.room.stateVersion).toBe(ended.room.stateVersion);
    expect(after.game!.result).toEqual(ended.game!.result);
  });
});
