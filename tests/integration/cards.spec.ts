import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARD_EVENT_PAYLOADS, PermittedCardSnapshotSchema } from '@stumps/contracts';
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

    // Neither the snapshot nor any event exposes undealt deck cards or the seed.
    const decks = await api.admin.query<{ id: string }>(
      `SELECT id FROM app_private.card_instances WHERE room_id = $1 AND location = 'DECK'`,
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
    const visible = JSON.stringify([snap, await publicEvents(roomId)]);
    for (const { id } of decks.rows) expect(visible).not.toContain(id);
    expect(visible).not.toContain(seedHex);

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

  it('plays to the end; the seed is disclosed and matches the commitment', async () => {
    const { roomId, players } = await startedMatch('cs_full');
    let game = (await snapshot(players[0]!.client, roomId)).game!;
    for (let i = 0; i < 400 && !game.result; i += 1) {
      const selector = selectorOf(players, game);
      const res = await command(selector.client, roomId, {
        comparisonId: game.comparisonId,
        metric: (['batting', 'bowling', 'fielding', 'form', 'experience', 'versatility'] as const)[
          i % 6
        ],
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
    expect(snap.room.lifecycle).toBe('FINALIZING');

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

  it('the match time limit restores the open chain and ranks by cards', async () => {
    const { roomId, players } = await startedMatch('cs_limit');
    await api.admin.query(
      `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 second'
        WHERE room_id = $1 AND kind = 'card.match_limit'`,
      [roomId],
    );
    await runDuePass(api.pool, api.deps.rooms.deadlines, () => undefined);
    const snap = await snapshot(players[0]!.client, roomId);
    expect(snap.room.lifecycle).toBe('FINALIZING');
    expect(snap.game!.result).toMatchObject({ reason: 'time_limit' });
    expect(snap.game!.seats.map((s) => s.deckCount)).toEqual([4, 4]);
    expect(snap.game!.visibleCards).toEqual([]);
    const cancelled = await api.admin.query(
      `SELECT 1 FROM app_private.card_comparisons WHERE room_id = $1 AND status = 'cancelled'`,
      [roomId],
    );
    expect(cancelled.rowCount).toBe(1);
  });
});
