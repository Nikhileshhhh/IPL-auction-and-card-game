import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminOverviewSchema,
  AdminRoomsSchema,
  AdminUserSchema,
  AuctionPlayerDetailSchema,
  UiPreferencesSchema,
  type AdminOverview,
  type AdminRooms,
  type AdminUser,
  type AuctionPlayerDetail,
  type UiPreferences,
} from '@stumps/contracts';
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
import { publishDemoPack } from '../support/cards';

/**
 * Phase 16 (ADR-031): noncritical UI preferences, the S33 operations read
 * models, member restrictions with step-up, announcements and the S21
 * auction player detail. None of them changes gameplay.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_operations');
  await api.setAccessCode(ACCESS_CODE);
  await publishDemoPack(api);
}, 120_000);
afterAll(async () => api?.close());

const auction = auctionHelpers(() => api);
const opts = { admin: true } as const;

async function signedInAdmin(tag: string) {
  const a = await onboardMember(api, tag);
  await makeAdmin(api, a.userId);
  const { client } = await adminSignIn(api, a.email, a.password);
  return { client, userId: a.userId };
}

/** Make the admin's last step-up older than the 5-minute window. */
async function expireStepUp(userId: string) {
  await api.admin.query(
    `UPDATE app_private.app_sessions SET step_up_at = now() - interval '10 minutes'
      WHERE user_id = $1 AND scope = 'admin'`,
    [userId],
  );
}

describe('UI preferences', () => {
  it('defaults, partial updates, validation and isolation between members', async () => {
    const a = await onboardMember(api, 'op_pref_a');
    const b = await onboardMember(api, 'op_pref_b');
    const first = await a.client.request<UiPreferences>('GET', '/v1/me/preferences');
    expect(first.status).toBe(200);
    expect(UiPreferencesSchema.parse(first.body.data)).toEqual({
      motion: 'system',
      soundEffects: false,
      lowData: false,
    });

    const patched = await a.client.request<UiPreferences>('PATCH', '/v1/me/preferences', {
      motion: 'reduce',
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data).toEqual({ motion: 'reduce', soundEffects: false, lowData: false });
    const again = await a.client.request<UiPreferences>('PATCH', '/v1/me/preferences', {
      soundEffects: true,
      lowData: true,
    });
    // The earlier choice is kept when another field changes.
    expect(again.body.data).toEqual({ motion: 'reduce', soundEffects: true, lowData: true });

    for (const bad of [{}, { motion: 'fast' }, { soundEffects: 'yes' }, { volume: 3 }]) {
      const res = await a.client.request('PATCH', '/v1/me/preferences', bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await b.client.request('GET', '/v1/me/preferences')).body.data).toEqual({
      motion: 'system',
      soundEffects: false,
      lowData: false,
    });

    // Signed-out callers get nothing.
    const anon = api.client('203.0.113.250');
    expect((await anon.request('GET', '/v1/me/preferences')).status).toBeGreaterThanOrEqual(401);
  });
});

describe('S33 operations', () => {
  it('overview and rooms are measured, safe and admin-only', async () => {
    const { client: admin } = await signedInAdmin('op_admin');
    const room = await auction.startedAuction('op_rooms');

    const overview = await admin.request<AdminOverview>(
      'GET',
      '/v1/admin/overview',
      undefined,
      opts,
    );
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    const o = AdminOverviewSchema.parse(overview.body.data);
    expect(o.health.database).toBe(true);
    expect(o.health.migration).toBe('130_ui_preferences');
    expect(o.rooms.RUNNING).toBeGreaterThanOrEqual(1);

    const rooms = await admin.request<AdminRooms>('GET', '/v1/admin/rooms', undefined, opts);
    expect(rooms.status).toBe(200);
    const r = AdminRoomsSchema.parse(rooms.body.data);
    const row = r.rooms.find((x) => x.roomId === room.roomId);
    expect(row).toMatchObject({ gameType: 'auction', lifecycle: 'RUNNING', members: 2 });
    // No room name, code, member name or game state in the operations views.
    const text = JSON.stringify([overview.body.data, rooms.body.data]);
    expect(text).not.toContain('Auction night');
    expect(text).not.toMatch(/op_rooms_[hg]/);

    // Members are not administrators.
    for (const path of ['/v1/admin/overview', '/v1/admin/rooms']) {
      expect((await room.host.request('GET', path, undefined, opts)).status).toBeGreaterThanOrEqual(
        401,
      );
    }
  });

  it('restrictions need step-up, end sessions, are audited and spare admins', async () => {
    const { client: admin, userId: adminId } = await signedInAdmin('op_restrict');
    const member = await onboardMember(api, 'op_target');
    const found = await admin.request<AdminUser>(
      'GET',
      '/v1/admin/users?username=OP_TARGET',
      undefined,
      opts,
    );
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(AdminUserSchema.parse(found.body.data)).toMatchObject({
      userId: member.userId,
      suspendedUntil: null,
      isAdmin: false,
    });
    expect(JSON.stringify(found.body.data)).not.toContain('@example.test');
    expect(
      (await admin.request('GET', '/v1/admin/users?username=nobody_here', undefined, opts)).status,
    ).toBe(404);
    expect((await admin.request('GET', '/v1/admin/users?username=a', undefined, opts)).status).toBe(
      400,
    );

    const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const body = { suspendedUntil: until, reason: 'repeated abuse in chat' };
    // Without a fresh step-up the restriction is refused.
    await expireStepUp(adminId);
    const refused = await admin.request(
      'POST',
      `/v1/admin/users/${member.userId}/restrictions`,
      body,
      opts,
    );
    expect(refused.body.error?.code).toBe('STEP_UP_REQUIRED');
    // An integrity abort needs the same fresh step-up (ADR-030).
    const room = await auction.startedAuction('op_abort');
    const abort = await admin.request(
      'POST',
      `/v1/admin/rooms/${room.roomId}/abort`,
      { reason: 'integrity check' },
      opts,
    );
    expect(abort.body.error?.code).toBe('STEP_UP_REQUIRED');
    expect(
      (
        await api.admin.query<{ lifecycle: string }>(
          'SELECT lifecycle FROM app_private.rooms WHERE id = $1',
          [room.roomId],
        )
      ).rows[0]?.lifecycle,
    ).toBe('RUNNING');

    await api.admin.query(
      `UPDATE app_private.app_sessions SET step_up_at = now() WHERE user_id = $1 AND scope = 'admin'`,
      [adminId],
    );
    const suspended = await admin.request<AdminUser>(
      'POST',
      `/v1/admin/users/${member.userId}/restrictions`,
      body,
      opts,
    );
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body.data!.suspendedUntil).not.toBeNull();
    // The member's session is over at once.
    const after = await member.client.request('GET', '/v1/me');
    expect(after.status).toBeGreaterThanOrEqual(401);

    // Validation: past times, more than a year, short reasons.
    for (const bad of [
      { suspendedUntil: new Date(Date.now() - 1000).toISOString(), reason: 'too late now' },
      {
        suspendedUntil: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString(),
        reason: 'far too long',
      },
      { suspendedUntil: until, reason: 'no' },
    ]) {
      const res = await admin.request(
        'POST',
        `/v1/admin/users/${member.userId}/restrictions`,
        bad,
        opts,
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // Nobody restricts themselves or another administrator.
    expect(
      (
        await admin.request(
          'POST',
          `/v1/admin/users/${adminId}/restrictions`,
          { suspendedUntil: until, reason: 'testing myself' },
          opts,
        )
      ).body.error?.code,
    ).toBe('FORBIDDEN');
    const other = await onboardMember(api, 'op_other_admin');
    await makeAdmin(api, other.userId);
    expect(
      (
        await admin.request(
          'POST',
          `/v1/admin/users/${other.userId}/restrictions`,
          { suspendedUntil: until, reason: 'testing another' },
          opts,
        )
      ).body.error?.code,
    ).toBe('FORBIDDEN');

    const lifted = await admin.request<AdminUser>(
      'POST',
      `/v1/admin/users/${member.userId}/restrictions`,
      { suspendedUntil: null, reason: 'appeal accepted' },
      opts,
    );
    expect(lifted.body.data!.suspendedUntil).toBeNull();
    const audits = await api.admin.query<{ action: string; safe_diff: unknown }>(
      `SELECT action, safe_diff FROM app_private.admin_audit
        WHERE actor_id = $1 AND action LIKE 'user.%' ORDER BY occurred_at`,
      [adminId],
    );
    expect(audits.rows.map((a) => a.action)).toEqual(['user.suspend', 'user.unsuspend']);
    // The reason text never reaches the audit log.
    expect(JSON.stringify(audits.rows)).not.toContain('abuse');
  });

  it('announcements reach members during their window and can be archived', async () => {
    const { client: admin } = await signedInAdmin('op_announce');
    const member = await onboardMember(api, 'op_reader');
    const created = await admin.request<{ id: string }>(
      'POST',
      '/v1/admin/announcements',
      {
        title: 'Auction night <b>Friday</b>',
        body: 'Mega auction at 8 pm.',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      opts,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.data!.id;
    const seen = await member.client.request<{ items: { id: string; title: string }[] }>(
      'GET',
      '/v1/announcements',
    );
    // Stored and returned verbatim; the web renders it as text.
    expect(seen.body.data!.items).toContainEqual(
      expect.objectContaining({ id, title: 'Auction night <b>Friday</b>' }),
    );
    expect(
      (
        await admin.request(
          'POST',
          '/v1/admin/announcements',
          {
            title: 'Backwards',
            body: 'Ends before it starts.',
            startsAt: new Date(Date.now() + 3600_000).toISOString(),
            endsAt: new Date(Date.now()).toISOString(),
          },
          opts,
        )
      ).status,
    ).toBe(400);
    expect(
      (await member.client.request('POST', '/v1/admin/announcements', {}, opts)).status,
    ).toBeGreaterThanOrEqual(401);

    const archived = await admin.request('POST', `/v1/admin/announcements/${id}/archive`, {}, opts);
    expect(archived.status).toBe(200);
    const after = await member.client.request<{ items: { id: string }[] }>(
      'GET',
      '/v1/announcements',
    );
    expect(after.body.data!.items.map((i) => i.id)).not.toContain(id);
    expect(
      (await admin.request('POST', `/v1/admin/announcements/${id}/archive`, {}, opts)).status,
    ).toBe(404);
  });
});

describe('S21 auction player detail', () => {
  it('members read the frozen player, ratings and source; outsiders cannot', async () => {
    const room = await auction.startedAuction('op_detail');
    const lot = room.view.lot!;
    const res = await room.guest.request<AuctionPlayerDetail>(
      'GET',
      `/v1/rooms/${room.roomId}/players/${lot.player.playerId}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = AuctionPlayerDetailSchema.parse(res.body.data);
    expect(d.player).toEqual(lot.player);
    expect(d.poolStatus).toBe('available');
    expect(d.ownerTeamId).toBeNull();
    expect(d.ratings.batting).toBeTypeOf('number');
    expect(d.player.portraitUrl).toMatch(/^\/(api\/media|original-assets)\//);

    const outsider: BffClient = (await onboardMember(api, 'op_outsider')).client;
    expect(
      (await outsider.request('GET', `/v1/rooms/${room.roomId}/players/${lot.player.playerId}`))
        .status,
    ).toBe(404);
    expect(
      (
        await room.guest.request(
          'GET',
          `/v1/rooms/${room.roomId}/players/00000000-0000-4000-8000-000000000000`,
        )
      ).status,
    ).toBe(404);
  });
});
