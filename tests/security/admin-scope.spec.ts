import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_CODE,
  adminSignIn,
  createTestApi,
  makeAdmin,
  onboardMember,
  type TestApi,
} from '../support/api';
import { cardHelpers, publishDemoPack } from '../support/cards';

/**
 * E69 (master plan §10): an administrator cannot change a live match. There
 * is no endpoint that awards, edits a bid, sets a score or mints a medal;
 * the only intervention is an audited integrity abort, which awards nothing.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_sec_admin_scope');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const cards = cardHelpers(() => api);

type Op = { method: string; path: string; rights: string };
const ops = (
  JSON.parse(
    readFileSync(
      new URL('../../packages/contracts/schema/http-operations.json', import.meta.url),
      'utf8',
    ),
  ) as { operations: Op[] }
).operations;

/** Every administrative write the product has, and nothing else. */
const ADMIN_WRITES = [
  'POST /v1/admin/auth/login',
  'POST /v1/admin/auth/mfa',
  'POST /v1/admin/auth/logout',
  'POST /v1/admin/auth/mfa/factors',
  'POST /v1/admin/auth/mfa/challenge',
  'POST /v1/admin/auth/mfa/enroll',
  'PUT /v1/admin/access',
  'POST /v1/admin/users/:id/restrictions',
  'POST /v1/admin/announcements',
  'POST /v1/admin/announcements/:id/archive',
  'POST /v1/admin/catalog/imports',
  'POST /v1/admin/catalog/player-sheet',
  'PATCH /v1/admin/catalog/players/:id',
  'POST /v1/admin/catalog/:id/publish',
  'POST /v1/admin/catalog/versions/:id/archive',
  'POST /v1/admin/catalog/media',
  'POST /v1/admin/catalog/versions/:id/discard',
  'POST /v1/admin/catalog/media/:id/review',
  'POST /v1/admin/cleanup/:roomId/retry',
  'POST /v1/admin/rooms/:id/abort',
].sort();

describe('E69 administrators cannot change outcomes', () => {
  it('the admin write surface is exactly the allow-list (no award, bid, score or medal edits)', () => {
    const writes = ops
      .filter((o) => o.path.startsWith('/v1/admin') && o.method !== 'GET')
      .map((o) => `${o.method} ${o.path}`)
      .sort();
    expect(writes).toEqual(ADMIN_WRITES);
    for (const w of writes) {
      expect(w).not.toMatch(/result|medal|achievement|award|score|bid|winner|standing/i);
    }
    // Every catalogued admin write is actually served, and nothing outcome-shaped is.
    for (const w of ADMIN_WRITES) {
      // hasRoute matches route definitions, so the `:param` form is the right input.
      const [method, url] = w.split(' ') as [string, string];
      expect(api.app.hasRoute({ method: method as 'POST', url }), w).toBe(true);
    }
    for (const url of [
      '/v1/admin/rooms/:id/results',
      '/v1/admin/rooms/:id/winner',
      '/v1/admin/achievements',
      '/v1/admin/rooms/:id/bids',
      '/v1/admin/rooms/:id/commands',
      '/v1/admin/users/:id/medals',
    ]) {
      for (const method of ['POST', 'PATCH', 'PUT'] as const) {
        expect(api.app.hasRoute({ method, url }), `${method} ${url}`).toBe(false);
      }
    }
  });

  it('an admin session cannot act in a room, and an integrity abort awards nothing', async () => {
    const a = await onboardMember(api, 'scope_admin');
    await makeAdmin(api, a.userId);
    const { client: admin } = await adminSignIn(api, a.email, a.password);
    const { roomId } = await cards.startedMatch('scope_room');

    // The admin session has no member rights in the room.
    const command = await admin.request(
      'POST',
      `/v1/rooms/${roomId}/commands`,
      {
        type: 'vote.start',
        commandId: randomUUID(),
        roomId,
        expectedVersion: '0',
        controlEpoch: '0',
        payload: {},
      },
      { admin: true, rawHeaders: { 'idempotency-key': randomUUID() } },
    );
    expect(command.status).toBeGreaterThanOrEqual(401);
    expect(
      (await admin.request('GET', `/v1/rooms/${roomId}/snapshot`, undefined, { admin: true }))
        .status,
    ).toBeGreaterThanOrEqual(401);

    const aborted = await admin.request(
      'POST',
      `/v1/admin/rooms/${roomId}/abort`,
      { reason: 'integrity check' },
      { admin: true },
    );
    expect(aborted.status, JSON.stringify(aborted.body)).toBe(200);
    const room = await api.admin.query<{ lifecycle: string; award_batch: string | null }>(
      'SELECT lifecycle, award_batch FROM app_private.rooms WHERE id = $1',
      [roomId],
    );
    expect(room.rows[0]?.lifecycle).toBe('ABORTED');
    const receipts = await api.admin.query(
      'SELECT 1 FROM app_private.achievement_receipts WHERE award_batch = $1',
      [room.rows[0]?.award_batch ?? randomUUID()],
    );
    expect(receipts.rowCount).toBe(0);
    expect(
      (await api.admin.query('SELECT 1 FROM app_private.room_results WHERE room_id = $1', [roomId]))
        .rowCount,
    ).toBe(0);
  });
});
