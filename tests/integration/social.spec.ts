import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { readPortrait } from '../../apps/server/src/modules/media/service';
import {
  FriendsViewSchema,
  NotificationsViewSchema,
  ProfileDTOSchema,
  type FriendsView,
  type NotificationsView,
  type ProfileDTO,
  type RoomLobbyDTO,
} from '@stumps/contracts';
import {
  ACCESS_CODE,
  createTestApi,
  onboardMember,
  type BffClient,
  type TestApi,
} from '../support/api';

/**
 * Profiles, friends, blocks, search, invitations and the inbox (phase 13,
 * ADR-028): privacy and blocks are enforced on the server, e-mail never
 * appears, and invitations never bypass the room password.
 */

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_social');
  await api.setAccessCode(ACCESS_CODE);
}, 120_000);
afterAll(async () => api?.close());

type User = Awaited<ReturnType<typeof onboardMember>> & { username: string };
async function user(name: string): Promise<User> {
  return { ...(await onboardMember(api, name)), username: name };
}

const profile = (c: BffClient, username: string) =>
  c.request<ProfileDTO>('GET', `/v1/profiles/${username}`);
const friends = async (c: BffClient) =>
  FriendsViewSchema.parse((await c.request<FriendsView>('GET', '/v1/friends')).body.data);
const inbox = async (c: BffClient) =>
  NotificationsViewSchema.parse(
    (await c.request<NotificationsView>('GET', '/v1/notifications')).body.data,
  );
const ask = (c: BffClient, targetUserId: string) =>
  c.request<{ status: string; friendshipId: string }>('POST', '/v1/friends/requests', {
    targetUserId,
  });

describe('profiles and privacy', () => {
  it('respects members / friends / private visibility and never exposes e-mail', async () => {
    const a = await user('so_alice');
    const b = await user('so_bob');
    const seen = await profile(b.client, a.username);
    expect(seen.status).toBe(200);
    const dto = ProfileDTOSchema.parse(seen.body.data);
    expect(dto).toMatchObject({ username: a.username, friendshipStatus: 'none' });
    expect(dto.achievementSummary.gold).toBe(0);
    expect(dto.permittedActivity).toBeNull(); // not a friend
    expect(JSON.stringify(seen.body)).not.toContain('@example.test');
    // Owner edits allowlisted fields only; counters cannot be sent.
    const counters = await a.client.request('PATCH', '/v1/profiles/me/settings', { gold: 9 });
    expect(counters.status).toBe(400);
    const patched = await a.client.request<ProfileDTO>('PATCH', '/v1/profiles/me/settings', {
      bio: 'Leg-spin fan',
      visibility: 'friends',
    });
    expect(patched.body.data).toMatchObject({ bio: 'Leg-spin fan', friendshipStatus: 'self' });
    expect((await profile(b.client, a.username)).status).toBe(404);
    // Becoming friends opens a friends-only profile; private closes it to everyone else.
    const req = await ask(b.client, a.userId);
    await a.client.request('POST', `/v1/friends/${req.body.data!.friendshipId}/accept`);
    expect((await profile(b.client, a.username)).body.data).toMatchObject({
      friendshipStatus: 'friends',
      permittedActivity: { inRoom: false },
    });
    await a.client.request('PATCH', '/v1/profiles/me/settings', { visibility: 'private' });
    expect((await profile(b.client, a.username)).status).toBe(404);
    expect((await profile(a.client, a.username)).status).toBe(200);
  });

  it('search needs 3 characters, matches usernames only, hides private and blocked members', async () => {
    const me = await user('so_seeker');
    const x = await user('so_findme');
    const y = await user('so_findhidden');
    await y.client.request('PATCH', '/v1/profiles/me/settings', { visibility: 'private' });
    const z = await user('so_findblock');
    await z.client.request('POST', '/v1/blocks', { targetUserId: me.userId });
    const search = (q: string) =>
      me.client.request<{ members: { username: string }[] }>(
        'GET',
        `/v1/members/search?q=${encodeURIComponent(q)}`,
      );
    expect((await search('so')).body.data!.members).toEqual([]);
    const found = (await search('so_find')).body.data!.members.map((m) => m.username);
    expect(found).toEqual([x.username]);
    // E-mail is never searchable.
    expect((await search('example.test')).body.data!.members).toEqual([]);
    expect((await search(x.email)).body.data!.members).toEqual([]);
  });

  it('avatars accept real images only and are stored without metadata', async () => {
    const a = await user('so_avatar');
    const jpeg = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const ok = await a.client.request<{ assetId: string; avatarUrl: string }>(
      'POST',
      '/v1/profiles/me/avatar',
      { imageBase64: jpeg.toString('base64') },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await api.admin.query<{
      object_key: string;
      purpose: string;
      owner_user_id: string;
    }>('SELECT object_key, purpose, owner_user_id FROM app_private.media_assets WHERE id = $1', [
      ok.body.data!.assetId,
    ]);
    expect(row.rows[0]).toMatchObject({ purpose: 'avatar', owner_user_id: a.userId });
    const stored = await api.deps.media.get(`${row.rows[0]!.object_key}/320.webp`);
    const meta = await sharp(stored!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect((await profile(a.client, a.username)).body.data!.avatarUrl).toBe(
      ok.body.data!.avatarUrl,
    );
    // Served to members through the media path while it is someone's avatar.
    const bytes = await readPortrait(api.pool, api.deps.media, ok.body.data!.assetId, 320);
    expect(bytes.length).toBeGreaterThan(0);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    for (const bad of [svg, Buffer.from('not an image at all, just text bytes')]) {
      const res = await a.client.request('POST', '/v1/profiles/me/avatar', {
        imageBase64: bad.toString('base64'),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe('friends and blocks', () => {
  it('requests are idempotent, only the recipient accepts, and both get notified', async () => {
    const a = await user('so_fa');
    const b = await user('so_fb');
    const first = await ask(a.client, b.userId);
    expect(first.body.data).toMatchObject({ status: 'requested' });
    const again = await ask(a.client, b.userId);
    expect(again.body.data!.friendshipId).toBe(first.body.data!.friendshipId);
    expect((await friends(b.client)).incoming.map((f) => f.username)).toEqual([a.username]);
    expect((await friends(a.client)).outgoing.map((f) => f.username)).toEqual([b.username]);
    const self = await a.client.request(
      'POST',
      `/v1/friends/${first.body.data!.friendshipId}/accept`,
    );
    expect((self.body as { error: { code: string } }).error.code).toBe('NOT_RECIPIENT');
    const accepted = await b.client.request(
      'POST',
      `/v1/friends/${first.body.data!.friendshipId}/accept`,
    );
    expect(accepted.body.data).toEqual({ status: 'friends' });
    expect((await inbox(b.client)).notifications.map((n) => n.type)).toContain('friend.requested');
    const aInbox = await inbox(a.client);
    expect(aInbox.notifications[0]).toMatchObject({ type: 'friend.accepted', read: false });
    expect(aInbox.unread).toBe(1);
    await a.client.request('PATCH', `/v1/notifications/${aInbox.notifications[0]!.id}`, {
      read: true,
    });
    expect((await inbox(a.client)).unread).toBe(0);
    // Someone else's notification is concealed.
    const foreign = await b.client.request(
      'PATCH',
      `/v1/notifications/${aInbox.notifications[0]!.id}`,
      { read: true },
    );
    expect(foreign.status).toBe(404);
    // Asking back when they already asked accepts.
    const c = await user('so_fc');
    await ask(c.client, a.userId);
    expect((await ask(a.client, c.userId)).body.data).toMatchObject({ status: 'friends' });
    // Removing is idempotent.
    const fid = (await friends(a.client)).friends.find(
      (f) => f.username === b.username,
    )!.friendshipId;
    expect((await a.client.request('DELETE', `/v1/friends/${fid}`)).body.data).toEqual({
      removed: true,
    });
    expect((await a.client.request('DELETE', `/v1/friends/${fid}`)).status).toBe(200);
    expect((await friends(b.client)).friends).toEqual([]);
  });

  it('at most 20 requests may wait at once', async () => {
    const a = await user('so_many');
    const targets = await Promise.all(Array.from({ length: 21 }, (_, i) => user(`so_t${i}`)));
    for (const t of targets.slice(0, 20)) expect((await ask(a.client, t.userId)).status).toBe(200);
    const extra = await ask(a.client, targets[20]!.userId);
    expect((extra.body as { error: { details: unknown } }).error.details).toMatchObject({
      reason: 'TOO_MANY_PENDING',
    });
  });

  it('a block removes the friendship and invites, conceals both ways, and unblocking restores nothing', async () => {
    const a = await user('so_ba');
    const b = await user('so_bb');
    const req = await ask(a.client, b.userId);
    await b.client.request('POST', `/v1/friends/${req.body.data!.friendshipId}/accept`);
    const created = await a.client.mutate<{ lobby: RoomLobbyDTO }>('POST', '/v1/rooms', {
      gameType: 'card',
      name: 'Friends only',
      settings: { maxPlayers: 4, totalCards: 16 },
    });
    const roomId = created.body.data!.lobby.roomId;
    expect(
      (await a.client.request('POST', `/v1/rooms/${roomId}/invites`, { friendUserId: b.userId }))
        .status,
    ).toBe(200);
    expect((await inbox(b.client)).invites).toHaveLength(1);
    await b.client.request('POST', '/v1/blocks', { targetUserId: a.userId });
    expect((await friends(a.client)).friends).toEqual([]);
    expect((await inbox(b.client)).invites).toEqual([]);
    expect((await profile(a.client, b.username)).status).toBe(404);
    // Concealed both ways; the blocker manages the block from the friends page.
    expect((await profile(b.client, a.username)).status).toBe(404);
    expect((await friends(b.client)).blocked.map((x) => x.username)).toEqual([a.username]);
    expect((await ask(a.client, b.userId)).status).toBe(404);
    expect(
      (await a.client.request('POST', `/v1/rooms/${roomId}/invites`, { friendUserId: b.userId }))
        .status,
    ).toBe(404);
    await b.client.request('DELETE', `/v1/blocks/${a.userId}`);
    expect((await friends(b.client)).friends).toEqual([]);
    expect((await profile(a.client, b.username)).status).toBe(200);
  });
});

describe('room invitations', () => {
  it('only friends are invited; the invite never carries the code and the password is still required', async () => {
    const a = await user('so_ia');
    const b = await user('so_ib');
    const stranger = await user('so_ic');
    const req = await ask(a.client, b.userId);
    await b.client.request('POST', `/v1/friends/${req.body.data!.friendshipId}/accept`);
    const created = await a.client.mutate<{ lobby: RoomLobbyDTO; roomCode: string }>(
      'POST',
      '/v1/rooms',
      {
        gameType: 'card',
        name: 'Locked room',
        password: 'a-room-password',
        settings: { maxPlayers: 4, totalCards: 16 },
      },
    );
    const { lobby, roomCode } = created.body.data!;
    expect(
      (
        await a.client.request('POST', `/v1/rooms/${lobby.roomId}/invites`, {
          friendUserId: stranger.userId,
        })
      ).status,
    ).toBe(404);
    const invite = await a.client.request<{ inviteId: string }>(
      'POST',
      `/v1/rooms/${lobby.roomId}/invites`,
      { friendUserId: b.userId },
    );
    expect(invite.status).toBe(200);
    const box = await inbox(b.client);
    expect(box.invites[0]).toMatchObject({
      roomName: 'Locked room',
      needsPassword: true,
      open: true,
      from: { username: a.username },
    });
    const everything = JSON.stringify(box);
    expect(everything).not.toContain(roomCode);
    expect(everything).not.toContain('a-room-password');
    const notice = await api.admin.query<{ safe_payload: unknown }>(
      `SELECT safe_payload FROM app_private.notifications WHERE user_id = $1 AND type = 'room.invited'`,
      [b.userId],
    );
    expect(JSON.stringify(notice.rows)).not.toContain(roomCode);
    // Someone else cannot use it; the recipient still needs the password.
    expect(
      (
        await stranger.client.mutate(
          'POST',
          `/v1/rooms/invites/${invite.body.data!.inviteId}/accept`,
          {},
        )
      ).status,
    ).toBe(404);
    const noPassword = await b.client.mutate(
      'POST',
      `/v1/rooms/invites/${invite.body.data!.inviteId}/accept`,
      {},
    );
    expect((noPassword.body as { error: { code: string } }).error.code).toBe('JOIN_FAILED');
    const joined = await b.client.mutate<{ lobby: RoomLobbyDTO }>(
      'POST',
      `/v1/rooms/invites/${invite.body.data!.inviteId}/accept`,
      { password: 'a-room-password' },
    );
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body.data!.lobby.members.map((m) => m.username)).toContain(b.username);
    expect((await inbox(b.client)).invites).toEqual([]);
  });
});
