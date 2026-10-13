import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AcceptInviteRequestSchema,
  AvatarUploadSchema,
  BlockRequestSchema,
  FriendRequestSchema,
  ProfilePatchSchema,
  RoomInviteRequestSchema,
  Uuid,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import { authenticateMember } from '../../modules/auth/service';
import { MAX_UPLOAD_BYTES } from '../../modules/media/pipeline';
import { joinRoom } from '../../modules/rooms/service';
import { consumeRate } from '../../modules/security/rate-limit';
import {
  acceptFriend,
  blockMember,
  friendsView,
  inviteToRoom,
  markInviteAccepted,
  removeFriend,
  requestFriend,
  unblockMember,
  usableInvite,
} from '../../modules/social/friends';
import { markRead, notificationsView } from '../../modules/social/notifications';
import {
  achievementsOf,
  profileByUsername,
  searchMembers,
  updateProfile,
  uploadAvatar,
} from '../../modules/social/profiles';
import type { RuntimeDeps } from '../../runtime';

/**
 * Social routes (S29–S31, DB/realtime §7, ADR-028). Every view is filtered by
 * privacy and blocks on the server; nothing relies on hidden UI. E-mail is
 * never returned or searched.
 */

// A 2 MiB image as base64 inside JSON.
const AVATAR_BODY_LIMIT = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4096;
const SEARCH_RATE = { kind: 'member_search', limit: 10, windowSeconds: 60 };
const IdParam = (request: FastifyRequest, key: string) => {
  const parsed = Uuid.safeParse((request.params as Record<string, string>)[key]);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'Not found.');
  return parsed.data;
};

export async function socialRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  async function member(request: FastifyRequest) {
    const ingress = requireIngress(request);
    const ctx = await authenticateMember(deps, ingress);
    if (!ctx.profile.onboarded) {
      throw new AppError('FORBIDDEN', 'Finish setting up your profile first.', {
        reason: 'ONBOARDING_REQUIRED',
      });
    }
    return { ...ctx, clientIp: ingress.clientIp };
  }
  const ok = <T>(data: T, request: FastifyRequest) => success(data, request.id, new Date());

  // ---------------------------------------------------------------- profiles
  app.get('/profiles/:username', async (request) => {
    const ctx = await member(request);
    const username = z
      .string()
      .min(1)
      .max(40)
      .parse((request.params as { username: string }).username);
    return ok(await profileByUsername(deps.pool, ctx.userId, username), request);
  });

  app.get('/profiles/:id/achievements', async (request) => {
    const ctx = await member(request);
    return ok(await achievementsOf(deps.pool, ctx.userId, IdParam(request, 'id')), request);
  });

  app.patch('/profiles/me/settings', async (request) => {
    const ctx = await member(request);
    const body = parseBody(ProfilePatchSchema, request.body);
    return ok(await updateProfile(deps.pool, ctx.userId, body), request);
  });

  app.post('/profiles/me/avatar', { bodyLimit: AVATAR_BODY_LIMIT }, async (request) => {
    const ctx = await member(request);
    const body = parseBody(AvatarUploadSchema, request.body);
    return ok(await uploadAvatar(deps.pool, deps.media, ctx.userId, body.imageBase64), request);
  });

  app.get('/members/search', async (request) => {
    const ctx = await member(request);
    await consumeRate(deps.pool, deps.secrets.lookupKey, SEARCH_RATE, ctx.userId);
    const q = String((request.query as { q?: string }).q ?? '').slice(0, 40);
    return ok(await searchMembers(deps.pool, ctx.userId, q), request);
  });

  // ----------------------------------------------------------------- friends
  app.get('/friends', async (request) => {
    const ctx = await member(request);
    return ok(await friendsView(deps.pool, ctx.userId), request);
  });

  app.post('/friends/requests', async (request) => {
    const ctx = await member(request);
    const body = parseBody(FriendRequestSchema, request.body);
    return ok(await requestFriend(deps.pool, ctx.userId, body.targetUserId), request);
  });

  app.post('/friends/:id/accept', async (request) => {
    const ctx = await member(request);
    return ok(await acceptFriend(deps.pool, ctx.userId, IdParam(request, 'id')), request);
  });

  app.delete('/friends/:id', async (request) => {
    const ctx = await member(request);
    return ok(await removeFriend(deps.pool, ctx.userId, IdParam(request, 'id')), request);
  });

  app.post('/blocks', async (request) => {
    const ctx = await member(request);
    const body = parseBody(BlockRequestSchema, request.body);
    return ok(await blockMember(deps.pool, ctx.userId, body.targetUserId), request);
  });

  app.get('/blocks', async (request) => {
    const ctx = await member(request);
    return ok({ blocked: (await friendsView(deps.pool, ctx.userId)).blocked }, request);
  });

  app.delete('/blocks/:id', async (request) => {
    const ctx = await member(request);
    return ok(await unblockMember(deps.pool, ctx.userId, IdParam(request, 'id')), request);
  });

  // ---------------------------------------------------------- notifications
  app.get('/notifications', async (request) => {
    const ctx = await member(request);
    return ok(await notificationsView(deps.pool, ctx.userId), request);
  });

  app.patch('/notifications/:id', async (request) => {
    const ctx = await member(request);
    parseBody(z.object({ read: z.literal(true) }).strict(), request.body);
    return ok(await markRead(deps.pool, ctx.userId, IdParam(request, 'id')), request);
  });

  // ------------------------------------------------------------ room invites
  app.post('/rooms/:id/invites', async (request) => {
    const ctx = await member(request);
    const body = parseBody(RoomInviteRequestSchema, request.body);
    return ok(
      await inviteToRoom(deps.pool, ctx.userId, IdParam(request, 'id'), body.friendUserId),
      request,
    );
  });

  /** Joins through the ordinary join path by room id: the room password is still required. */
  app.post('/rooms/invites/:inviteId/accept', async (request) => {
    const ctx = await member(request);
    const inviteId = IdParam(request, 'inviteId');
    const body = parseBody(AcceptInviteRequestSchema, request.body ?? {});
    const invite = await usableInvite(deps.pool, ctx.userId, inviteId);
    const raw = request.headers['idempotency-key'];
    const key = Uuid.safeParse(typeof raw === 'string' ? raw.toLowerCase() : '');
    if (!key.success) {
      throw new AppError('VALIDATION_FAILED', 'An Idempotency-Key UUID header is required.');
    }
    const lobby = await joinRoom(
      deps.rooms.deps,
      ctx,
      {
        roomId: invite.room_id,
        password: body.password,
        gameType: invite.game_type,
        clientIp: ctx.clientIp,
      },
      key.data,
    );
    await markInviteAccepted(deps.pool, inviteId);
    return ok({ lobby }, request);
  });
}
