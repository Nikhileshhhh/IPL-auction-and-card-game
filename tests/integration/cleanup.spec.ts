import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { auditRoomDeletion } from '../../apps/server/src/modules/cleanup/audit';
import { runCleanupPass, scanRooms } from '../../apps/server/src/modules/cleanup';
import type { MediaStorage } from '../../apps/server/src/modules/media/storage';
import {
  ACCESS_CODE,
  adminSignIn,
  createTestApi,
  makeAdmin,
  onboardMember,
  type BffClient,
  type TestApi,
} from '../support/api';
import { auctionHelpers } from '../support/auction';
import { cardHelpers, publishDemoPack } from '../support/cards';

/**
 * Recoverable room deletion (DB/realtime §7 steps 4–5, ADR-030): once results
 * expire (or a room is aborted or abandoned) the room is frozen, its Storage
 * prefix emptied and verified, then the root row deleted so every temporary
 * row cascades. Profiles, friendships, receipts and summaries stay.
 */

let api: TestApi;
let png: string;
beforeAll(async () => {
  api = await createTestApi('stumps_it_cleanup');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
  png = (
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 120, b: 90 } },
    })
      .png()
      .toBuffer()
  ).toString('base64');
}, 120_000);
afterAll(async () => api?.close());

const cards = cardHelpers(() => api);
const auction = auctionHelpers(() => api);
const storage = () => api.deps.media as MediaStorage;
const pass = (s: MediaStorage = storage()) => runCleanupPass(api.pool, s);
const audit = (roomId: string) => auditRoomDeletion(api.admin, storage(), roomId);

async function upload(client: BffClient, roomId: string) {
  return client.mutate<{ assetId: string }>('POST', `/v1/rooms/${roomId}/assets`, {
    imageBase64: png,
  });
}

/** End a started room by a unanimous vote (the window elapsed in the database). */
async function endByVote(clients: BffClient[], roomId: string) {
  const vote = await auction.command(clients[0]!, roomId, 'vote.start', {});
  expect(vote.status, JSON.stringify(vote.body)).toBe(200);
  const voteId = (vote.body.data as { voteId: string }).voteId;
  for (const c of clients) await auction.command(c, roomId, 'vote.cast', { voteId, choice: 'end' });
  await api.admin.query(
    `UPDATE app_private.end_votes SET starts_at = starts_at - interval '16 s', expires_at = expires_at - interval '16 s' WHERE id = $1`,
    [voteId],
  );
  await api.admin.query(
    `UPDATE app_private.deadline_jobs SET due_at = now() - interval '1 s' WHERE room_id = $1 AND kind = 'room.vote_resolve'`,
    [roomId],
  );
  for (let i = 0; i < 10; i += 1) {
    await auction.duePass();
    const row = await api.admin.query<{ lifecycle: string }>(
      'SELECT lifecycle FROM app_private.rooms WHERE id = $1',
      [roomId],
    );
    if (row.rows[0]?.lifecycle === 'RESULTS') return;
  }
  throw new Error('room did not reach RESULTS');
}

/** Results expired: the cleanup task falls due now. */
async function expireResults(roomId: string) {
  await api.admin.query(
    `UPDATE app_private.room_results SET created_at = now() - interval '200 s', expires_at = now() - interval '1 s' WHERE room_id = $1`,
    [roomId],
  );
  await api.admin.query(
    `UPDATE app_private.rooms SET result_expires_at = now() - interval '1 s' WHERE id = $1`,
    [roomId],
  );
  await api.admin.query(
    `UPDATE app_private.cleanup_tasks SET next_attempt_at = now() - interval '1 s', locked_until = NULL WHERE room_id = $1`,
    [roomId],
  );
}

const awardBatch = async (roomId: string) =>
  (
    await api.admin.query<{ award_batch: string }>(
      'SELECT award_batch FROM app_private.rooms WHERE id = $1',
      [roomId],
    )
  ).rows[0]!.award_batch;

describe('results expiry deletes the whole room', () => {
  it('a card match: every temporary row and object goes; profiles, friends and medals stay', async () => {
    const { roomId, players } = await cards.startedMatch('cl_card');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    // A friendship and a qualifying, medal-awarding finish.
    const users = await api.admin.query<{ user_id: string }>(
      'SELECT user_id FROM app_private.room_members WHERE room_id = $1 ORDER BY id',
      [roomId],
    );
    const [u1, u2] = users.rows.map((r) => r.user_id) as [string, string];
    const hostUser = (
      await api.admin.query<{ host_user_id: string }>(
        'SELECT host_user_id FROM app_private.rooms WHERE id = $1',
        [roomId],
      )
    ).rows[0]!.host_user_id;
    const friend = await host.mutate('POST', '/v1/friends/requests', {
      targetUserId: hostUser === u1 ? u2 : u1,
    });
    expect(friend.status, JSON.stringify(friend.body)).toBe(200);
    expect((await upload(host, roomId)).status).toBe(200);
    expect(await storage().list(`rooms/${roomId}`)).toHaveLength(3);
    await api.admin.query(
      `UPDATE app_private.room_members SET participation_ms = 3600000 WHERE room_id = $1`,
      [roomId],
    );
    await api.admin.query(
      `UPDATE app_private.rooms SET started_at = now() - interval '1 hour' WHERE id = $1`,
      [roomId],
    );
    await api.admin.query(
      `UPDATE app_private.card_games SET completed_contests = 9 WHERE room_id = $1`,
      [roomId],
    );
    await endByVote([host, guest], roomId);
    const batch = await awardBatch(roomId);
    const receiptsBefore = await api.admin.query(
      'SELECT user_id, medal FROM app_private.achievement_receipts WHERE award_batch = $1 ORDER BY user_id',
      [batch],
    );
    expect(receiptsBefore.rowCount).toBe(2);
    const summariesBefore = await api.admin.query(
      'SELECT * FROM app_private.achievement_summaries WHERE user_id = ANY($1::uuid[]) ORDER BY user_id',
      [[u1, u2]],
    );
    const friendsBefore = await api.admin.query(
      'SELECT id FROM app_private.friendships WHERE low_user_id = ANY($1::uuid[])',
      [[u1, u2]],
    );
    expect(friendsBefore.rowCount).toBe(1);

    // Queued with the results; nothing happens before they expire.
    const task = await api.admin.query<{ reason: string; next_attempt_at: Date }>(
      'SELECT reason, next_attempt_at FROM app_private.cleanup_tasks WHERE room_id = $1',
      [roomId],
    );
    expect(task.rows[0]?.reason).toBe('results');
    expect((await pass()).purged).toBe(0);
    expect((await auction.publicEvents(roomId, 'room.expiring')).length).toBe(1);

    await expireResults(roomId);
    // The room no longer counts towards anyone's two active rooms.
    expect(
      (await host.request<{ items: unknown[] }>('GET', '/v1/me/rooms')).body.data!.items,
    ).toEqual([]);
    expect((await pass()).purged).toBe(1);

    const proof = await audit(roomId);
    expect(proof, JSON.stringify(proof)).toMatchObject({ clean: true, remaining: {}, objects: [] });
    expect(
      (
        await api.admin.query(
          'SELECT user_id, medal FROM app_private.achievement_receipts WHERE award_batch = $1 ORDER BY user_id',
          [batch],
        )
      ).rows,
    ).toEqual(receiptsBefore.rows);
    expect(
      (
        await api.admin.query(
          'SELECT * FROM app_private.achievement_summaries WHERE user_id = ANY($1::uuid[]) ORDER BY user_id',
          [[u1, u2]],
        )
      ).rows,
    ).toEqual(summariesBefore.rows);
    expect(
      (
        await api.admin.query(
          'SELECT id FROM app_private.friendships WHERE low_user_id = ANY($1::uuid[])',
          [[u1, u2]],
        )
      ).rows,
    ).toEqual(friendsBefore.rows);
    expect(
      (
        await api.admin.query(
          'SELECT 1 FROM app_private.profiles WHERE user_id = ANY($1::uuid[])',
          [[u1, u2]],
        )
      ).rowCount,
    ).toBe(2);
    // Afterwards the room is simply absent: no transcript, no 500.
    expect((await host.request('GET', `/v1/rooms/${roomId}/results`)).status).toBe(404);
    // Running cleanup again changes nothing.
    expect(await pass()).toMatchObject({ purged: 0, failed: 0 });
  });

  it('an auction with every team table and a room image deletes completely', async () => {
    const { roomId, host, guest } = await auction.startedAuction('cl_auc');
    expect((await auction.bid(host, roomId)).status).toBe(200);
    expect((await upload(guest, roomId)).status).toBe(200);
    await endByVote([host, guest], roomId);
    await expireResults(roomId);
    expect((await pass()).purged).toBe(1);
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });
});

describe('recoverable and concurrent cleanup', () => {
  it('a Storage failure keeps an inaccessible PURGING room and retries with backoff', async () => {
    const { roomId, players } = await cards.startedMatch('cl_fail');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    await upload(host, roomId);
    await endByVote([host, guest], roomId);
    await expireResults(roomId);
    const before = await auction.snapshot(host, roomId);
    const failing: MediaStorage = {
      put: (k, b, t) => storage().put(k, b, t),
      get: (k) => storage().get(k),
      list: (p) => storage().list(p),
      remove: () => Promise.reject(new Error('storage unavailable')),
    };
    expect((await pass(failing)).failed).toBe(1);
    const task = (
      await api.admin.query<{
        stage: string;
        attempts: number;
        last_error_code: string;
        due_in: number;
      }>(
        `SELECT stage, attempts, last_error_code,
                extract(epoch FROM (next_attempt_at - now()))::int AS due_in
           FROM app_private.cleanup_tasks WHERE room_id = $1`,
        [roomId],
      )
    ).rows[0]!;
    expect(task).toMatchObject({
      stage: 'assets',
      attempts: 1,
      last_error_code: 'STORAGE_REMOVE_FAILED',
    });
    expect(task.due_in).toBeGreaterThan(50);
    expect(task.due_in).toBeLessThanOrEqual(60);
    // The manifest survives the failure; the room is closed to everyone.
    expect(await storage().list(`rooms/${roomId}`)).toHaveLength(3);
    expect((await host.request('GET', `/v1/rooms/${roomId}/snapshot`)).status).toBe(410);
    expect((await host.request('GET', `/v1/rooms/${roomId}/results`)).status).toBe(410);
    // Any write is refused (the command goes straight to the API, no snapshot first).
    const write = await host.mutate<unknown>('POST', `/v1/rooms/${roomId}/commands`, {
      type: 'vote.start',
      commandId: randomUUID(),
      roomId,
      expectedVersion: before.room.stateVersion,
      controlEpoch: before.me.controlEpoch,
      payload: {},
    });
    expect(write.body.error?.code).toBe('ROOM_GONE');
    // Not due yet: a pass leaves it alone. Once due, it completes.
    expect((await pass()).purged).toBe(0);
    await api.admin.query(
      `UPDATE app_private.cleanup_tasks SET next_attempt_at = now() - interval '1 s' WHERE room_id = $1`,
      [roomId],
    );
    expect((await pass()).purged).toBe(1);
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });

  it('two cleaners at once: one deletes, the other skips', async () => {
    const { roomId, players } = await cards.startedMatch('cl_two');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    await upload(host, roomId);
    await endByVote([host, guest], roomId);
    await expireResults(roomId);
    const outcomes = await Promise.all([pass(), pass(), pass()]);
    expect(outcomes.reduce((n, o) => n + o.purged, 0)).toBeGreaterThanOrEqual(1);
    expect(outcomes.reduce((n, o) => n + o.failed, 0)).toBe(0);
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });

  it('a crash after the objects are gone but before the rows: the retry finishes', async () => {
    const { roomId, players } = await cards.startedMatch('cl_crash');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    await upload(host, roomId);
    await endByVote([host, guest], roomId);
    await expireResults(roomId);
    let listings = 0;
    const crashing: MediaStorage = {
      put: (k, b, t) => storage().put(k, b, t),
      get: (k) => storage().get(k),
      remove: (keys) => storage().remove(keys),
      // The second listing (the "prove it is empty" step) never returns.
      list: (p) => (++listings === 2 ? Promise.reject(new Error('crash')) : storage().list(p)),
    };
    expect((await pass(crashing)).failed).toBe(1);
    expect(await storage().list(`rooms/${roomId}`)).toEqual([]); // objects already removed
    expect(
      (await api.admin.query('SELECT 1 FROM app_private.rooms WHERE id = $1', [roomId])).rowCount,
    ).toBe(1); // rows not yet
    await api.admin.query(
      `UPDATE app_private.cleanup_tasks SET next_attempt_at = now() - interval '1 s' WHERE room_id = $1`,
      [roomId],
    );
    expect((await pass()).purged).toBe(1); // already-missing objects count as removed
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });

  it('an upload in flight at expiry: new uploads refused, the lease waited out, the late object removed', async () => {
    const { roomId, players } = await cards.startedMatch('cl_flight');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    await endByVote([host, guest], roomId);
    // An upload registered its manifest row and lease but has not written yet.
    const lateKey = `rooms/${roomId}/late-upload/320.webp`;
    await api.admin.query(
      `INSERT INTO app_private.room_assets (room_id, bucket, object_key, purpose, status, upload_expires_at)
       VALUES ($1, 'room-media', $2, 'room_image', 'uploading', now() + interval '60 s')`,
      [roomId, lateKey],
    );
    expect((await upload(host, roomId)).body.error?.code).toBe('STATE_CONFLICT'); // finished room
    await expireResults(roomId);
    expect((await pass()).waiting).toBe(1); // frozen; waiting for the upload lease
    expect(
      (
        await api.admin.query<{ lifecycle: string }>(
          'SELECT lifecycle FROM app_private.rooms WHERE id = $1',
          [roomId],
        )
      ).rows[0]!.lifecycle,
    ).toBe('PURGING');
    // The delayed write lands after the freeze…
    await storage().put(lateKey, Buffer.from('late'), 'image/webp');
    await api.admin.query(
      `UPDATE app_private.cleanup_tasks SET next_attempt_at = now() - interval '1 s' WHERE room_id = $1`,
      [roomId],
    );
    // …and is still removed.
    expect((await pass()).purged).toBe(1);
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });
});

describe('abandoned rooms and the restore sweep', () => {
  it('a running room every human left 30 minutes ago is aborted without medals and deleted', async () => {
    const { roomId } = await cards.startedMatch('cl_gone');
    await api.admin.query(
      `UPDATE app_private.rooms SET last_activity_at = now() - interval '31 minutes' WHERE id = $1`,
      [roomId],
    );
    await api.admin.query(
      `UPDATE app_private.room_members SET last_seen_at = now() - interval '31 minutes' WHERE room_id = $1`,
      [roomId],
    );
    const batch = await awardBatch(roomId);
    expect((await scanRooms(api.pool, storage())).abandoned).toBeGreaterThanOrEqual(1);
    expect(
      (
        await api.admin.query<{ lifecycle: string }>(
          'SELECT lifecycle FROM app_private.rooms WHERE id = $1',
          [roomId],
        )
      ).rows[0]!.lifecycle,
    ).toBe('ABORTED');
    expect((await pass()).purged).toBeGreaterThanOrEqual(1);
    expect(await audit(roomId)).toMatchObject({ clean: true });
    expect(
      (
        await api.admin.query(
          'SELECT 1 FROM app_private.achievement_receipts WHERE award_batch = $1',
          [batch],
        )
      ).rowCount,
    ).toBe(0);
  });

  it('after a restore, expired rooms without a task and orphan objects are swept', async () => {
    const { roomId, players } = await cards.startedMatch('cl_restore');
    const [host, guest] = players.map((p) => p.client) as [BffClient, BffClient];
    await upload(host, roomId);
    await endByVote([host, guest], roomId);
    await expireResults(roomId);
    // As restored from a backup taken before the task existed.
    await api.admin.query('DELETE FROM app_private.cleanup_tasks WHERE room_id = $1', [roomId]);
    const orphan = `rooms/00000000-0000-4000-8000-${Date.now().toString().slice(-12)}/x/320.webp`;
    await storage().put(orphan, Buffer.from('orphan'), 'image/webp');
    const scan = await scanRooms(api.pool, storage());
    expect(scan.queued).toBeGreaterThanOrEqual(1);
    expect(scan.orphanPrefixes).toBeGreaterThanOrEqual(1);
    expect(await storage().get(orphan)).toBeNull();
    expect((await pass()).purged).toBeGreaterThanOrEqual(1);
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });

  it('an empty lobby with a room image goes through cleanup instead of a bare delete', async () => {
    const h = await onboardMember(api, 'cl_lobby');
    const created = await h.client.mutate<{ lobby: { roomId: string } }>('POST', '/v1/rooms', {
      gameType: 'card',
      name: 'Lobby with art',
      settings: { maxPlayers: 2, totalCards: 8, selectionSeconds: 10 },
    });
    const roomId = created.body.data!.lobby.roomId;
    expect((await upload(h.client, roomId)).status).toBe(200);
    expect((await h.client.mutate('POST', `/v1/rooms/${roomId}/leave`, {})).status).toBe(200);
    expect(
      (
        await api.admin.query<{ reason: string }>(
          'SELECT reason FROM app_private.cleanup_tasks WHERE room_id = $1',
          [roomId],
        )
      ).rows[0]?.reason,
    ).toBe('lobby');
    const outcome = await pass();
    expect(outcome.purged, JSON.stringify(outcome)).toBeGreaterThanOrEqual(1);
    expect(await audit(roomId)).toMatchObject({ clean: true });
  });
});

describe('operations queue', () => {
  it('admins see safe fields, retry only finished rooms, and abort with step-up', async () => {
    const a = await onboardMember(api, 'cl_admin');
    await makeAdmin(api, a.userId);
    const { client: admin } = await adminSignIn(api, a.email, a.password);
    const opts = { admin: true } as const;

    const running = await cards.startedMatch('cl_ops');
    expect(
      (await admin.request('POST', `/v1/admin/cleanup/${running.roomId}/retry`, {}, opts)).body
        .error?.code,
    ).toBe('STATE_CONFLICT');
    // A member is not an administrator.
    expect(
      (await running.players[0]!.client.request('GET', '/v1/admin/cleanup', undefined, opts))
        .status,
    ).toBeGreaterThanOrEqual(401);

    const aborted = await admin.request(
      'POST',
      `/v1/admin/rooms/${running.roomId}/abort`,
      { reason: 'integrity check' },
      opts,
    );
    expect(aborted.status, JSON.stringify(aborted.body)).toBe(200);
    const queue = await admin.request<{
      tasks: { roomId: string; reason: string; stage: string }[];
    }>('GET', '/v1/admin/cleanup', undefined, opts);
    expect(queue.status).toBe(200);
    expect(queue.body.data!.tasks).toContainEqual(
      expect.objectContaining({ roomId: running.roomId, reason: 'aborted', stage: 'freeze' }),
    );
    expect(JSON.stringify(queue.body.data)).not.toMatch(/Arena|display|chat/i);
    const retried = await admin.request(
      'POST',
      `/v1/admin/cleanup/${running.roomId}/retry`,
      {},
      opts,
    );
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect((await pass()).purged).toBeGreaterThanOrEqual(1);
    expect(await audit(running.roomId)).toMatchObject({ clean: true });
    const audits = await api.admin.query<{ action: string; safe_diff: unknown }>(
      `SELECT action, safe_diff FROM app_private.admin_audit WHERE action IN ('room.abort', 'cleanup.retry')`,
    );
    expect(audits.rows.map((r) => r.action).sort()).toEqual(['cleanup.retry', 'room.abort']);
    expect(JSON.stringify(audits.rows)).not.toContain(running.roomId);
  });
});
