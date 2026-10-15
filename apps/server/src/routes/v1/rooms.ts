import { readResults } from '../../modules/achievements/results';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ControlRequestSchema,
  CreateRoomRequestSchema,
  EventsQuerySchema,
  HostTransferRequestSchema,
  JoinRoomRequestSchema,
  KickRequestSchema,
  ReadyRequestSchema,
  SettingsPatchRequestSchema,
  StartRequestSchema,
  Uuid,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import { dbNow, withTransaction } from '../../db/transaction';
import { authenticateMember } from '../../modules/auth/service';
import {
  createRoom,
  joinRoom,
  kickMember,
  leaveRoom,
  proposeHostTransfer,
  setReady,
  startRoom,
  takeControl,
  updateSettings,
  type MemberContext,
} from '../../modules/rooms/service';
import { buildSnapshot, replay, requireMembership, streamAcl } from '../../rooms/projection';
import { readRoom } from '../../rooms/room-tx';
import { squadOf } from '../../modules/auctions/squad';
import { shortlistView, teamView } from '../../modules/teams';
import { autoView } from '../../modules/auctions';
import { channelView } from '../../modules/chat';
import type { RuntimeDeps } from '../../runtime';

const RoomParams = z.object({ id: z.uuid() });
const IdempotencyKey = z.uuid();

function roomIdOf(request: FastifyRequest): string {
  const parsed = RoomParams.safeParse(request.params);
  // Malformed IDs are indistinguishable from rooms the caller cannot see.
  if (!parsed.success) throw new AppError('NOT_FOUND', 'Room not found.');
  return parsed.data.id;
}

/** Mutations carry an `Idempotency-Key` UUID; retries reuse it (DB/realtime §8). */
function idempotencyKeyOf(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const parsed = IdempotencyKey.safeParse(typeof raw === 'string' ? raw.toLowerCase() : '');
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'An Idempotency-Key UUID header is required.');
  }
  return parsed.data;
}

export async function roomRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  const rooms = deps.rooms.deps;

  /** Room endpoints need a finished profile: names in lobbies are never placeholders. */
  async function member(request: FastifyRequest): Promise<MemberContext & { clientIp: string }> {
    const ingress = requireIngress(request);
    const ctx = await authenticateMember(deps, ingress);
    if (!ctx.profile.onboarded) {
      throw new AppError('FORBIDDEN', 'Finish setting up your profile first.', {
        reason: 'ONBOARDING_REQUIRED',
      });
    }
    return { userId: ctx.userId, profile: ctx.profile, clientIp: ingress.clientIp };
  }

  app.post('/rooms', async (request, reply) => {
    const ctx = await member(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(CreateRoomRequestSchema, request.body);
    const created = await createRoom(rooms, ctx, body, key);
    return reply.code(201).send(success(created, request.id, new Date()));
  });

  app.post('/rooms/join', async (request) => {
    const ctx = await member(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(JoinRoomRequestSchema, request.body);
    const lobby = await joinRoom(
      rooms,
      ctx,
      { code: body.code, password: body.password, gameType: body.gameType, clientIp: ctx.clientIp },
      key,
    );
    return success(lobby, request.id, new Date());
  });

  /** Consistent (REPEATABLE READ) permitted projection plus the cursor vector. */
  app.get('/rooms/:id/snapshot', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const snapshot = await withTransaction(
      deps.pool,
      async (tx) => {
        const room = await readRoom(tx, roomId);
        if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
        const me = await requireMembership(tx, roomId, ctx.userId);
        const { streamIds: _ids, ...dto } = await buildSnapshot(
          tx,
          deps.secrets,
          room,
          me,
          await dbNow(tx),
          deps.rooms.gameProjector,
        );
        return dto;
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    return success(snapshot, request.id, new Date());
  });

  /** Replay after a cursor; unauthorized streams are concealed as 404. */
  app.get('/rooms/:id/events', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const query = EventsQuerySchema.safeParse(request.query);
    if (!query.success)
      throw new AppError('VALIDATION_FAILED', 'streamId and afterSeq are required.');
    const result = await withTransaction(
      deps.pool,
      async (tx) => {
        const me = await requireMembership(tx, roomId, ctx.userId);
        const stream = await tx.query(
          `SELECT 1 FROM app_private.room_streams
            WHERE id = $1 AND room_id = $2 AND ${streamAcl('$3')}`,
          [query.data.streamId, roomId, me.id],
        );
        if (stream.rowCount !== 1) throw new AppError('NOT_FOUND', 'Stream not found.');
        return replay(tx, query.data.streamId, query.data.afterSeq);
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    return success(result, request.id, new Date());
  });

  /** S22 squad view: any room member may read a team's acquired squad (no strategy). */
  app.get('/rooms/:id/franchises/:franchiseId/squad', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const teamId = Uuid.safeParse((request.params as { franchiseId?: string }).franchiseId);
    if (!teamId.success) throw new AppError('NOT_FOUND', 'Team not found.');
    const squad = await withTransaction(
      deps.pool,
      async (tx) => {
        await requireMembership(tx, roomId, ctx.userId);
        const room = await readRoom(tx, roomId);
        if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
        return squadOf(tx, room, teamId.data);
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    return success(squad, request.id, new Date());
  });

  /** S17: the viewer's own team (members, capabilities, requests, code, handover). */
  app.get('/rooms/:id/team', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const view = await withTransaction(
      deps.pool,
      async (tx) => {
        const me = await requireMembership(tx, roomId, ctx.userId);
        const room = await readRoom(tx, roomId);
        if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
        return teamView(tx, deps.secrets, room, me, await dbNow(tx));
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    return success(view, request.id, new Date());
  });

  /** S23: a team's private shortlist — its own members only; any other team reads as 404. */
  app.get('/rooms/:id/franchises/:franchiseId/shortlist', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const teamId = Uuid.safeParse((request.params as { franchiseId?: string }).franchiseId);
    if (!teamId.success) throw new AppError('NOT_FOUND', 'Team not found.');
    const view = await withTransaction(
      deps.pool,
      async (tx) => {
        const me = await requireMembership(tx, roomId, ctx.userId);
        const room = await readRoom(tx, roomId);
        if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
        return shortlistView(tx, room, me.id, teamId.data);
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    return success(view, request.id, new Date());
  });

  /** S26: the team's automated limits, control state and decisions — own team only (others: 404). */
  app.get('/rooms/:id/franchises/:franchiseId/strategy', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const teamId = Uuid.safeParse((request.params as { franchiseId?: string }).franchiseId);
    if (!teamId.success) throw new AppError('NOT_FOUND', 'Team not found.');
    const view = await withTransaction(
      deps.pool,
      async (tx) => {
        const me = await requireMembership(tx, roomId, ctx.userId);
        const room = await readRoom(tx, roomId);
        if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
        return autoView(tx, room, me.id, teamId.data);
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    return success(view, request.id, new Date());
  });

  /** S24/S25: chat history for the room channel, or the viewer's own team channel only. */
  app.get('/rooms/:id/chat/:channel/messages', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const kind = z
      .enum(['room', 'team'])
      .safeParse((request.params as { channel?: string }).channel);
    if (!kind.success) throw new AppError('NOT_FOUND', 'Chat not found.');
    const view = await withTransaction(deps.pool, async (tx) => {
      const me = await requireMembership(tx, roomId, ctx.userId);
      const room = await readRoom(tx, roomId);
      if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
      return channelView(tx, room, me, kind.data, await dbNow(tx));
    });
    return success(view, request.id, new Date());
  });

  /** S13/S27: temporary results — podium for members, own credits only; 410 once expired. */
  app.get('/rooms/:id/results', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const view = await withTransaction(deps.pool, async (tx) => {
      const me = await requireMembership(tx, roomId, ctx.userId);
      const room = await readRoom(tx, roomId);
      if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
      return readResults(tx, room, me, await dbNow(tx));
    });
    return success(view, request.id, new Date());
  });

  app.post('/rooms/:id/ready', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(ReadyRequestSchema, request.body);
    return success(await setReady(rooms, ctx, roomId, body, key), request.id, new Date());
  });

  app.patch('/rooms/:id/settings', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(SettingsPatchRequestSchema, request.body);
    return success(await updateSettings(rooms, ctx, roomId, body, key), request.id, new Date());
  });

  app.post('/rooms/:id/start', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(StartRequestSchema, request.body);
    return success(await startRoom(rooms, ctx, roomId, body, key), request.id, new Date());
  });

  app.post('/rooms/:id/leave', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    parseBody(z.object({}).strict(), request.body);
    return success(await leaveRoom(rooms, ctx, roomId, key), request.id, new Date());
  });

  app.post('/rooms/:id/kick', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(KickRequestSchema, request.body);
    return success(
      await kickMember(rooms, ctx, roomId, body.memberId, key),
      request.id,
      new Date(),
    );
  });

  app.post('/rooms/:id/host', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(HostTransferRequestSchema, request.body);
    return success(
      await proposeHostTransfer(rooms, ctx, roomId, body.memberId, key),
      request.id,
      new Date(),
    );
  });

  app.post('/rooms/:id/control', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const key = idempotencyKeyOf(request);
    const body = parseBody(ControlRequestSchema, request.body);
    return success(
      await takeControl(
        rooms,
        ctx,
        roomId,
        { currentEpoch: body.currentEpoch, socketId: body.deviceId },
        key,
      ),
      request.id,
      new Date(),
    );
  });

  /** HTTP fallback for `game.command`: identical envelope, allowlist and handler. */
  app.post('/rooms/:id/commands', async (request) => {
    const ctx = await member(request);
    const roomId = roomIdOf(request);
    const envelope = request.body as { roomId?: unknown } | undefined;
    if (!envelope || envelope.roomId !== roomId) {
      throw new AppError('VALIDATION_FAILED', 'Command room does not match the URL.');
    }
    return success(
      await deps.rooms.commands.dispatch(rooms, ctx, envelope),
      request.id,
      new Date(),
    );
  });

  /** Rooms the caller currently belongs to (dashboard "return to your room"). */
  app.get('/me/rooms', async (request) => {
    const ctx = await member(request);
    const res = await deps.pool.query<{
      id: string;
      game_type: 'card' | 'auction';
      name: string;
      lifecycle: string;
    }>(
      `SELECT r.id, r.game_type, r.name, r.lifecycle
         FROM app_private.room_members m JOIN app_private.rooms r ON r.id = m.room_id
        WHERE m.user_id = $1 AND m.left_at IS NULL
          AND r.lifecycle IN ('LOBBY', 'RUNNING', 'FINALIZING', 'RESULTS')
        ORDER BY m.joined_at DESC LIMIT 10`,
      [ctx.userId],
    );
    return success(
      {
        items: res.rows.map((r) => ({
          roomId: r.id,
          gameType: r.game_type,
          name: r.name,
          lifecycle: r.lifecycle,
        })),
      },
      request.id,
      new Date(),
    );
  });
}
