import type pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from '@stumps/contracts';
import { AppError } from '../http/app-error';
import { failure, success } from '../http/envelope';
import { dbNow, withTransaction } from '../db/transaction';
import type { Secrets } from '../config/secrets';
import { buildSnapshot, listMembers, type GameProjector } from '../rooms/projection';
import { lockRoom, readRoom } from '../rooms/room-tx';
import { appendEvents, type EventDraft } from '../rooms/streams';
import { HOST_ABSENCE_MS, takeControl, type RoomDeps } from '../modules/rooms/service';
import type { CommandDispatcher } from '../modules/commands/dispatcher';
import { streamRoom } from './dispatcher';

export const CONNECTION_TTL_MS = 30_000;

export interface RoomSocketDeps {
  pool: pg.Pool;
  secrets: Secrets;
  rooms: RoomDeps;
  commands: CommandDispatcher;
  instanceId: string;
  gameProjector?: GameProjector;
}

type Ack = (response: unknown) => void;

declare module 'socket.io' {
  interface SocketData {
    /** roomId → { memberId, stream rooms joined } for server-side eviction. */
    rooms?: Map<string, { memberId: string; streams: string[] }>;
  }
}

/** Every realtime action re-verifies session, gate grant and ban (DB/realtime §2.3). */
async function reauthorize(pool: pg.Pool, socket: Socket) {
  const p = socket.data.principal;
  const res = await pool.query<{ username: string; display_name: string }>(
    `SELECT pr.username, pr.display_name
       FROM app_private.app_sessions s
       JOIN app_private.gate_grants g ON g.id = $2
       JOIN app_private.access_config c ON c.id = 1
       JOIN app_private.profiles pr ON pr.user_id = s.user_id
      WHERE s.id = $1 AND s.user_id = $3 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND g.revoked_at IS NULL AND g.expires_at > now() AND g.access_version >= c.min_valid_version
        AND (pr.suspended_until IS NULL OR pr.suspended_until <= now())`,
    [p.appSessionId, p.grantId, p.userId],
  );
  const row = res.rows[0];
  if (!row) {
    socket.emit('auth.revoked', { reason: 'session', reverifyUrl: '/access' });
    socket.disconnect(true);
    throw new AppError('SESSION_REVOKED', 'Sign in again.');
  }
  return {
    userId: p.userId,
    profile: { username: row.username, displayName: row.display_name, onboarded: true },
  };
}

function respond(socket: Socket, ack: unknown, work: () => Promise<unknown>) {
  const reply = typeof ack === 'function' ? (ack as Ack) : () => undefined;
  const requestId = `sock_${socket.id}_${Date.now()}`;
  work()
    .then((data) => reply(success(data, requestId, new Date())))
    .catch((error: unknown) => {
      if (error instanceof AppError)
        reply(failure(error.code, error.message, requestId, new Date(), error.details));
      else if (error instanceof z.ZodError)
        reply(failure('VALIDATION_FAILED', 'Request is malformed.', requestId, new Date()));
      else reply(failure('INTERNAL', 'Something went wrong.', requestId, new Date()));
    });
}

const SubscribeSchema = z.object({ roomId: z.uuid() }).strict();
const ControlSchema = z
  .object({ roomId: z.uuid(), currentEpoch: z.string().regex(/^\d+$/), commandId: z.uuid() })
  .strict();

/**
 * Room presence, subscriptions and commands over Socket.IO. The socket joins
 * only server-computed stream rooms for audiences it may read; a client never
 * names a raw channel.
 */
export function registerRoomSockets(io: Server, deps: RoomSocketDeps) {
  io.on('connection', (socket) => {
    socket.on('room.subscribe', (payload: unknown, ack: unknown) =>
      respond(socket, ack, async () => {
        const actor = await reauthorize(deps.pool, socket);
        const { roomId } = SubscribeSchema.parse(payload);
        // Register presence under the room lock, then join stream rooms, then snapshot.
        let memberId = '';
        const streamIds = await withTransaction(deps.pool, async (tx) => {
          const room = await lockRoom(tx, roomId);
          const members = await listMembers(tx, room.id);
          const me = members.find((m) => m.user_id === actor.userId);
          if (!me) throw new AppError('NOT_FOUND', 'Room not found.');
          const now = await dbNow(tx);
          // A crashed tab's expired row must not keep control away from a live one.
          await tx.query(
            'DELETE FROM app_private.room_connections WHERE member_id = $1 AND expires_at <= $2',
            [me.id, now],
          );
          const hasController = await tx.query(
            'SELECT 1 FROM app_private.room_connections WHERE member_id = $1 AND is_controller',
            [me.id],
          );
          // One room per connection (socket_id is unique); the client opens a socket per room.
          const registered = await tx.query(
            `INSERT INTO app_private.room_connections (room_id, member_id, socket_id, instance_id, is_controller, lease_epoch, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (socket_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, last_heartbeat_at = now()
             WHERE app_private.room_connections.room_id = EXCLUDED.room_id`,
            [
              room.id,
              me.id,
              socket.id,
              deps.instanceId,
              hasController.rowCount === 0,
              me.control_epoch,
              new Date(now.getTime() + CONNECTION_TTL_MS),
            ],
          );
          if (registered.rowCount !== 1)
            throw new AppError('RULE_VIOLATION', 'This connection already follows another room.');
          const events: EventDraft[] = [];
          if (!me.online) {
            events.push({
              audience: { kind: 'public' },
              type: 'presence.changed',
              payload: { memberId: me.id, status: 'online', lastSeenApprox: now.toISOString() },
            });
            await tx.query('UPDATE app_private.room_members SET last_seen_at = $2 WHERE id = $1', [
              me.id,
              now,
            ]);
          }
          if (room.host_user_id === actor.userId) {
            await tx.query(
              `DELETE FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'room.host_absent'`,
              [room.id],
            );
          }
          if (events.length) await appendEvents(tx, room.id, room.state_version, events);
          memberId = me.id;
          const streams = await tx.query<{ id: string }>(
            `SELECT id FROM app_private.room_streams WHERE room_id = $1
               AND (audience_kind = 'public' OR (audience_kind = 'member' AND audience_id = $2))`,
            [room.id, me.id],
          );
          return streams.rows.map((r) => r.id);
        });
        const rooms = (socket.data.rooms ??= new Map());
        rooms.set(roomId, { memberId, streams: streamIds.map(streamRoom) });
        for (const id of streamIds) await socket.join(streamRoom(id));
        deps.rooms.wake();
        return withTransaction(
          deps.pool,
          async (tx) => {
            const room = await readRoom(tx, roomId);
            if (!room) throw new AppError('ROOM_GONE', 'This room no longer exists.');
            const me = (await listMembers(tx, roomId)).find((m) => m.user_id === actor.userId);
            if (!me) throw new AppError('NOT_FOUND', 'Room not found.');
            const snapshot = await buildSnapshot(
              tx,
              deps.secrets,
              room,
              me,
              await dbNow(tx),
              deps.gameProjector,
              socket.id,
            );
            const { streamIds: _ids, ...dto } = snapshot;
            return dto;
          },
          { isolation: 'repeatable read', readOnly: true },
        );
      }),
    );

    socket.on('presence.ping', (_payload: unknown, ack: unknown) =>
      respond(socket, ack, async () => {
        await deps.pool.query(
          `UPDATE app_private.room_connections SET last_heartbeat_at = now(), expires_at = now() + interval '30 seconds'
            WHERE socket_id = $1 AND last_heartbeat_at < now() - interval '4 seconds'`,
          [socket.id],
        );
        return { serverNow: new Date().toISOString() };
      }),
    );

    socket.on('game.command', (envelope: unknown, ack: unknown) =>
      respond(socket, ack, async () => {
        const actor = await reauthorize(deps.pool, socket);
        return deps.commands.dispatch(deps.rooms, { ...actor, socketId: socket.id }, envelope);
      }),
    );

    socket.on('room.control.take', (payload: unknown, ack: unknown) =>
      respond(socket, ack, async () => {
        const actor = await reauthorize(deps.pool, socket);
        const input = ControlSchema.parse(payload);
        return takeControl(
          deps.rooms,
          actor,
          input.roomId,
          { currentEpoch: input.currentEpoch, socketId: socket.id },
          input.commandId,
        );
      }),
    );

    socket.on('disconnect', () => {
      void markDisconnected(deps, socket.id).catch(() => undefined);
      socket.data.rooms?.clear();
    });
  });
}

/** Drop a connection; announce offline and start the host-absence clock when needed. */
export async function markDisconnected(
  deps: Pick<RoomSocketDeps, 'pool' | 'rooms'>,
  socketId: string,
) {
  const conn = await deps.pool.query<{ room_id: string; member_id: string }>(
    'SELECT room_id, member_id FROM app_private.room_connections WHERE socket_id = $1',
    [socketId],
  );
  const row = conn.rows[0];
  if (!row) return;
  await withTransaction(deps.pool, async (tx) => {
    const room = await readRoom(tx, row.room_id);
    if (!room) return;
    await lockRoom(tx, room.id);
    await tx.query('DELETE FROM app_private.room_connections WHERE socket_id = $1', [socketId]);
    const members = await listMembers(tx, room.id);
    const me = members.find((m) => m.id === row.member_id);
    if (!me || me.online) return;
    const now = await dbNow(tx);
    await tx.query('UPDATE app_private.room_members SET last_seen_at = $2 WHERE id = $1', [
      me.id,
      now,
    ]);
    await appendEvents(tx, room.id, room.state_version, [
      {
        audience: { kind: 'public' },
        type: 'presence.changed',
        payload: { memberId: me.id, status: 'offline', lastSeenApprox: now.toISOString() },
      },
    ]);
    if (
      me.user_id === room.host_user_id &&
      (room.lifecycle === 'LOBBY' || room.lifecycle === 'RUNNING')
    ) {
      await tx.query(
        `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
         VALUES ($1, 'room.host_absent', $2, 0, $3)
         ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
        [room.id, me.id, new Date(now.getTime() + HOST_ABSENCE_MS)],
      );
    }
  });
  deps.rooms.wake();
}

/**
 * Drop room subscriptions after a membership ends (kick/leave) or the room is
 * deleted. Stream-room membership is delivery only; the database already
 * refuses the member, this just stops further pushes immediately.
 */
export function evictFromRoom(io: Server, roomId: string, memberId?: string) {
  for (const socket of io.sockets.sockets.values()) {
    const entry = socket.data.rooms?.get(roomId);
    if (!entry || (memberId && entry.memberId !== memberId)) continue;
    for (const stream of entry.streams) void socket.leave(stream);
    socket.data.rooms?.delete(roomId);
    socket.emit(memberId ? 'room.removed' : 'room.closed', { roomId });
  }
}

/** Expired connection rows (crashed tabs, restarts) become offline presence. */
export async function sweepStaleConnections(
  deps: Pick<RoomSocketDeps, 'pool' | 'rooms'>,
  limit = 100,
) {
  const stale = await deps.pool.query<{ socket_id: string }>(
    'SELECT socket_id FROM app_private.room_connections WHERE expires_at <= now() ORDER BY expires_at LIMIT $1',
    [limit],
  );
  for (const row of stale.rows) await markDisconnected(deps, row.socket_id).catch(() => undefined);
  return stale.rows.length;
}

export function isErrorCode(value: string): value is ErrorCode {
  return value in ERROR_CODES;
}
