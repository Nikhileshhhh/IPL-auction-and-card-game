import type pg from 'pg';
import {
  AuctionSettingsSchema,
  type AuctionSettings,
  CardSettingsSchema,
  type CreateRoomRequest,
  type RoomLobbyDTO,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { dbNow, withTransaction, type Tx } from '../../db/transaction';
import { one } from '../../db/rows';
import type { Secrets } from '../../config/secrets';
import { generateRoomCode, roomCodeHash, sealRoomCode } from '../../rooms/codes';
import { listMembers, lobbyProjection, type MemberRow } from '../../rooms/projection';
import {
  bodyHash,
  readRoom,
  runRoomCommand,
  type DueSettler,
  type RoomRow,
} from '../../rooms/room-tx';
import { appendEvents, streamFor, type EventDraft } from '../../rooms/streams';
import type { StarterRegistry } from '../../rooms/starters';
import { setUpAuctionRoom } from '../auctions';
import { consumeRate } from '../security/rate-limit';
import type { MemberContext as FullMemberContext } from '../auth/service';

/** The parts of an authenticated member the room service needs (HTTP and sockets). */
export type MemberContext = Pick<FullMemberContext, 'userId' | 'profile'>;

export const LOBBY_INACTIVITY_MS = 30 * 60_000;
export const LOBBY_ABSOLUTE_MS = 2 * 60 * 60_000;
export const HOST_ABSENCE_MS = 60_000;
export const HANDOVER_TTL_MS = 60_000;
const MAX_ACTIVE_MEMBERSHIPS = 2;

export interface RoomDeps {
  pool: pg.Pool;
  secrets: Secrets;
  starters: StarterRegistry;
  settleDue: DueSettler;
  wake: () => void;
  /** Disconnect sockets of removed members / closed rooms after commit. */
  onMemberRemoved?: (roomId: string, memberId: string) => void;
  onRoomClosed?: (roomId: string) => void;
  /** Subscribe a member's open sockets to a stream they were just granted (team). */
  onStreamGranted?: (roomId: string, memberId: string, streamId: string) => void;
}

const userKey = (userId: string) => `user:${userId}`;

function validateSettings(gameType: 'card' | 'auction', settings: unknown) {
  const schema = gameType === 'card' ? CardSettingsSchema : AuctionSettingsSchema;
  const parsed = schema.safeParse(settings);
  if (!parsed.success) {
    throw new AppError('CONFIG_INVALID', 'Room settings are outside the allowed limits.', {
      fields: parsed.error.issues
        .slice(0, 10)
        .map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data as Record<string, unknown>;
}

function capacityOf(gameType: 'card' | 'auction', settings: Record<string, unknown>): number {
  if (gameType === 'card') return Number(settings.maxPlayers);
  return Math.min(60, Number(settings.franchiseCount) * Number(settings.collaboratorsPerFranchise));
}

/** Serialize membership-limit checks per user (taken before any room lock). */
async function lockUser(tx: Tx, userId: string) {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('stumps.user:' || $1::text))`, [userId]);
}

async function assertMembershipLimit(tx: Tx, userId: string, excludingRoomId?: string) {
  const res = await tx.query<{ active: number; running: number }>(
    `SELECT count(*)::int AS active, count(*) FILTER (WHERE r.lifecycle = 'RUNNING')::int AS running
       FROM app_private.room_members m JOIN app_private.rooms r ON r.id = m.room_id
      WHERE m.user_id = $1 AND m.left_at IS NULL AND r.lifecycle IN ('LOBBY', 'RUNNING', 'FINALIZING', 'RESULTS')
        AND ($2::uuid IS NULL OR r.id <> $2::uuid)`,
    [userId, excludingRoomId ?? null],
  );
  if (one(res).active >= MAX_ACTIVE_MEMBERSHIPS) {
    throw new AppError(
      'RULE_VIOLATION',
      'You are already in two rooms. Leave one before joining another.',
      {
        reason: 'MEMBERSHIP_LIMIT',
      },
    );
  }
}

async function scheduleLobbyExpiry(tx: Tx, roomId: string, dueAt: Date) {
  await tx.query(
    `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
     VALUES ($1, 'room.lobby_expiry', NULL, 0, $2)
     ON CONFLICT (room_id, kind, subject_id, generation) DO UPDATE SET due_at = EXCLUDED.due_at`,
    [roomId, dueAt],
  );
}

/** Extend lobby inactivity after a successful human action (never past the absolute limit). */
async function touchLobby(tx: Tx, room: RoomRow, now: Date) {
  if (room.lifecycle !== 'LOBBY') return;
  await scheduleLobbyExpiry(
    tx,
    room.id,
    new Date(Math.min(now.getTime() + LOBBY_INACTIVITY_MS, room.expires_at.getTime())),
  );
}

function lowestFreeSeat(members: MemberRow[], capacity: number): number | null {
  const taken = new Set(members.filter((m) => m.seat !== null).map((m) => m.seat));
  for (let seat = 0; seat < capacity; seat += 1) if (!taken.has(seat)) return seat;
  return null;
}

/**
 * POST /rooms. Codes are generated server-side only; the request receipt keeps
 * a pointer to the room (never the code) and the reply is rebuilt from the
 * live room on retry.
 */
export async function createRoom(
  deps: RoomDeps,
  ctx: MemberContext,
  input: CreateRoomRequest,
  idempotencyKey: string,
): Promise<{ lobby: RoomLobbyDTO; roomCode: string }> {
  const settings = validateSettings(input.gameType, input.settings);
  const hash = bodyHash(input);
  const existing = await deps.pool.query<{ body_hash: Buffer; resource_id: string | null }>(
    'SELECT body_hash, resource_id FROM app_private.request_receipts WHERE actor_id = $1 AND command_id = $2',
    [ctx.userId, idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior) {
    if (!prior.body_hash.equals(hash)) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'This request ID was already used for a different action.',
      );
    }
    if (!prior.resource_id) throw new AppError('ROOM_GONE', 'This room no longer exists.');
    return replayCreate(deps, ctx, prior.resource_id);
  }
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    { kind: 'room_create', limit: 5, windowSeconds: 3600 },
    ctx.userId,
  );
  const passwordHash = input.password
    ? await deps.secrets.roomPasswordHasher.hash(input.password)
    : null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode();
    try {
      const result = await withTransaction(deps.pool, async (tx) => {
        await lockUser(tx, ctx.userId);
        await assertMembershipLimit(tx, ctx.userId);
        const now = await dbNow(tx);
        const roomId = one(await tx.query<{ id: string }>('SELECT gen_random_uuid() AS id')).id;
        await tx.query(
          `INSERT INTO app_private.rooms
             (id, game_type, name, host_user_id, settings, max_members, results_ttl_seconds, code_hash, code_ciphertext,
              password_hash, created_at, last_activity_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)`,
          [
            roomId,
            input.gameType,
            input.name.trim(),
            ctx.userId,
            JSON.stringify(settings),
            capacityOf(input.gameType, settings),
            Number(settings.resultsSeconds),
            roomCodeHash(deps.secrets, code),
            sealRoomCode(deps.secrets, roomId, code),
            passwordHash,
            now,
            new Date(now.getTime() + LOBBY_ABSOLUTE_MS),
          ],
        );
        const member = one(
          await tx.query<{ id: string }>(
            `INSERT INTO app_private.room_members (room_id, user_id, seat, role) VALUES ($1, $2, $3, 'player') RETURNING id`,
            [roomId, ctx.userId, input.gameType === 'card' ? 0 : null],
          ),
        );
        await streamFor(tx, roomId, { kind: 'public' });
        await streamFor(tx, roomId, { kind: 'member', memberId: member.id });
        await scheduleLobbyExpiry(tx, roomId, new Date(now.getTime() + LOBBY_INACTIVITY_MS));
        if (input.gameType === 'auction') {
          await setUpAuctionRoom(tx, roomId, settings as AuctionSettings);
        }
        await tx.query(
          `INSERT INTO app_private.request_receipts (actor_id, command_id, body_hash, response, resource_id, created_at, expires_at)
           VALUES ($1, $2, $3, '{"created":true}', $4, $5, $6)`,
          [
            ctx.userId,
            idempotencyKey,
            hash,
            roomId,
            now,
            new Date(now.getTime() + 24 * 60 * 60_000),
          ],
        );
        const room = await readRoom(tx, roomId);
        if (!room) throw new AppError('INTERNAL', 'Room creation failed.');
        const lobby = await lobbyProjection(tx, deps.secrets, room, ctx.userId);
        return { lobby, roomCode: lobby.roomCode ?? '' };
      });
      return result;
    } catch (error) {
      // Retry only a code-hash collision, never overwrite an existing room.
      if (
        typeof error === 'object' &&
        error !== null &&
        'constraint' in error &&
        error.constraint === 'rooms_code_hash_key'
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError('SERVICE_UNAVAILABLE', 'Could not allocate a room code. Try again.');
}

async function replayCreate(deps: RoomDeps, ctx: MemberContext, roomId: string) {
  return withTransaction(deps.pool, async (tx) => {
    const room = await readRoom(tx, roomId);
    if (!room) throw new AppError('ROOM_GONE', 'This room no longer exists.');
    const lobby = await lobbyProjection(tx, deps.secrets, room, ctx.userId);
    return { lobby, roomCode: lobby.roomCode ?? '' };
  });
}

/**
 * POST /rooms/join. Bad code and bad password share one generic JOIN_FAILED
 * response with zero membership rows (E04, E05); capacity is checked under the
 * room lock so two joiners cannot both take the last seat (E13).
 */
export async function joinRoom(
  deps: RoomDeps,
  ctx: MemberContext,
  input: {
    code: string;
    password?: string | undefined;
    gameType: 'card' | 'auction';
    clientIp: string;
  },
  commandId: string,
): Promise<RoomLobbyDTO> {
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    { kind: 'room_join', limit: 10, windowSeconds: 60 },
    `${ctx.userId}`,
  );
  await consumeRate(
    deps.pool,
    deps.secrets.lookupKey,
    { kind: 'room_join_ip', limit: 30, windowSeconds: 60 },
    input.clientIp,
  );
  const lookup = await deps.pool.query<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM app_private.rooms WHERE code_hash = $1',
    [roomCodeHash(deps.secrets, input.code)],
  );
  const target = lookup.rows[0];
  const fail = () =>
    new AppError('JOIN_FAILED', 'Could not join. Check the room code and password.');
  if (!target) {
    // Uniform work: spend a hash verification even for unknown codes.
    await deps.secrets.roomPasswordHasher.verifyNothing(input.password ?? '');
    throw fail();
  }
  if (
    target.password_hash &&
    !(await deps.secrets.roomPasswordHasher.verify(target.password_hash, input.password ?? ''))
  ) {
    throw fail();
  }
  return runRoomCommand(
    deps.pool,
    { roomId: target.id, actorKey: userKey(ctx.userId), commandId, body: { op: 'join' } },
    async ({ tx, room, now }) => {
      if (room.game_type !== input.gameType) {
        throw new AppError(
          'GAME_MISMATCH',
          `This invitation is for ${room.game_type === 'card' ? 'Card Battle' : 'Mega Auction'}.`,
          {
            gameType: room.game_type,
          },
        );
      }
      const members = await listMembers(tx, room.id);
      const existing = members.find((m) => m.user_id === ctx.userId);
      if (existing) {
        return { reply: await lobbyProjection(tx, deps.secrets, room, ctx.userId) };
      }
      if (room.lifecycle !== 'LOBBY')
        throw new AppError('GAME_STARTED', 'This game has already started.');
      await assertMembershipLimit(tx, ctx.userId, room.id);
      if (members.length >= room.max_members) throw new AppError('ROOM_FULL', 'This room is full.');
      const seat = room.game_type === 'card' ? lowestFreeSeat(members, room.max_members) : null;
      const member = one(
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.room_members (room_id, user_id, seat, role) VALUES ($1, $2, $3, 'player') RETURNING id`,
          [room.id, ctx.userId, seat],
        ),
      );
      await streamFor(tx, room.id, { kind: 'member', memberId: member.id });
      await touchLobby(tx, room, now);
      return {
        reply: await lobbyProjection(tx, deps.secrets, room, ctx.userId),
        touch: true,
        events: [
          {
            audience: { kind: 'public' },
            type: 'room.memberJoined',
            payload: {
              memberId: member.id,
              username: ctx.profile.username,
              displayName: ctx.profile.displayName,
              seat,
              connectionStatus: 'offline',
            },
          },
        ],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake, beforeLock: (tx) => lockUser(tx, ctx.userId) },
  );
}

async function memberOf(tx: Tx, room: RoomRow, userId: string): Promise<MemberRow> {
  const member = (await listMembers(tx, room.id)).find((m) => m.user_id === userId);
  if (!member) throw new AppError('NOT_FOUND', 'Room not found.');
  return member;
}

function requireHost(room: RoomRow, userId: string) {
  if (room.host_user_id !== userId) throw new AppError('FORBIDDEN', 'Only the host can do that.');
}

function requireLobby(room: RoomRow) {
  if (room.lifecycle !== 'LOBBY')
    throw new AppError('GAME_STARTED', 'The game has already started.');
}

function requireConfig(room: RoomRow, configVersion: string) {
  if (room.config_version !== configVersion) {
    throw new AppError('STALE_CONFIG', 'The room rules changed. Review them and try again.', {
      configVersion: room.config_version,
    });
  }
}

export async function setReady(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  input: { ready: boolean; configVersion: string },
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'ready', ...input } },
    async ({ tx, room, now }) => {
      const me = await memberOf(tx, room, ctx.userId);
      requireLobby(room);
      requireConfig(room, input.configVersion);
      if (me.role !== 'player') throw new AppError('FORBIDDEN', 'Spectators do not ready up.');
      await tx.query('UPDATE app_private.room_members SET ready = $2 WHERE id = $1', [
        me.id,
        input.ready,
      ]);
      await touchLobby(tx, room, now);
      return {
        reply: { configVersion: room.config_version, ready: input.ready },
        touch: true,
        events: [
          {
            audience: { kind: 'public' },
            type: 'room.readinessChanged',
            payload: { configVersion: room.config_version, memberId: me.id, ready: input.ready },
          },
        ],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** Host settings change: version bump and every readiness cleared (E38). */
export async function updateSettings(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  input: { patch: Record<string, unknown>; configVersion: string },
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'settings', ...input } },
    async ({ tx, room, now }) => {
      await memberOf(tx, room, ctx.userId);
      requireHost(room, ctx.userId);
      requireLobby(room);
      requireConfig(room, input.configVersion);
      const settings = validateSettings(room.game_type, { ...room.settings, ...input.patch });
      const capacity = capacityOf(room.game_type, settings);
      const members = await listMembers(tx, room.id);
      if (capacity < members.length) {
        throw new AppError(
          'CONFIG_INVALID',
          `There are already ${members.length} people in this room.`,
        );
      }
      const configVersion = (BigInt(room.config_version) + 1n).toString();
      await tx.query(
        `UPDATE app_private.rooms SET settings = $2, max_members = $3, results_ttl_seconds = $4, config_version = $5
          WHERE id = $1`,
        [
          room.id,
          JSON.stringify(settings),
          capacity,
          Number(settings.resultsSeconds),
          configVersion,
        ],
      );
      await tx.query('UPDATE app_private.room_members SET ready = false WHERE room_id = $1', [
        room.id,
      ]);
      await touchLobby(tx, room, now);
      return {
        reply: { configVersion, settings },
        touch: true,
        events: [
          {
            audience: { kind: 'public' },
            type: 'room.settingsChanged',
            payload: { configVersion, settings },
          },
        ],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** Largest legal totals ≤ current for the seated count (E40 "offer nearest legal totals"). */
export function legalCardTotals(players: number, current: number): number[] {
  const totals: number[] = [];
  for (let per = 30; per >= 4; per -= 1) {
    const total = per * players;
    if (total <= 240) totals.push(total);
  }
  const lower = totals.filter((t) => t <= current).slice(0, 2);
  const higher = totals.filter((t) => t > current).slice(-1);
  return [...lower, ...higher].sort((a, b) => b - a);
}

/**
 * POST /rooms/:id/start. Validates host, current config, readiness, player
 * count and card divisibility, then hands off to the game starter. With no
 * starter registered the room stays in the lobby (ENGINE_UNAVAILABLE).
 */
export async function startRoom(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  input: { configVersion: string },
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'start', ...input } },
    async ({ tx, room, now }) => {
      await memberOf(tx, room, ctx.userId);
      requireHost(room, ctx.userId);
      requireLobby(room);
      requireConfig(room, input.configVersion);
      const players = (await listMembers(tx, room.id)).filter((m) => m.role === 'player');
      if (players.length < 2)
        throw new AppError('NOT_READY', 'At least two players are needed to start.', {
          reason: 'TOO_FEW_PLAYERS',
        });
      const notReady = players.filter((m) => !m.ready).map((m) => m.id);
      if (notReady.length > 0) {
        throw new AppError('NOT_READY', 'Everyone must be ready on the current rules.', {
          reason: 'NOT_READY',
          notReady,
        });
      }
      if (room.game_type === 'auction' && room.phase !== 'AUCTION_LOBBY') {
        throw new AppError(
          'NOT_READY',
          'Every team must finish franchise selection and lock its retentions first.',
          { reason: 'SETUP_INCOMPLETE', phase: room.phase },
        );
      }
      if (room.game_type === 'card') {
        const total = Number(room.settings.totalCards);
        const per = total / players.length;
        if (!Number.isInteger(per) || per < 4 || per > 30) {
          throw new AppError(
            'CONFIG_INVALID',
            `${total} cards cannot be dealt evenly to ${players.length} players.`,
            {
              reason: 'UNEVEN_DEAL',
              suggestedTotals: legalCardTotals(players.length, total),
            },
          );
        }
      }
      const starter = deps.starters.get(room.game_type);
      if (!starter) {
        throw new AppError(
          'RULE_VIOLATION',
          'This game engine is not available yet. The room stays open in the lobby.',
          {
            reason: 'ENGINE_UNAVAILABLE',
          },
        );
      }
      const started = await starter.start(tx, room, players, now);
      await tx.query(
        `UPDATE app_private.room_members m SET eligible_at_start = (role = 'player' AND ready),
            participation_opened_at = CASE WHEN EXISTS (SELECT 1 FROM app_private.room_connections c
                                                        WHERE c.member_id = m.id AND c.expires_at > $2)
                                           THEN $2::timestamptz END
          WHERE room_id = $1 AND left_at IS NULL`,
        [room.id, now],
      );
      const hard = new Date(now.getTime() + (room.game_type === 'card' ? 120 : 480) * 60_000);
      await tx.query(
        `UPDATE app_private.rooms SET lifecycle = $6, phase = $2, started_at = $3, data_version_id = $4,
            hard_deadline = $5, expires_at = $5 WHERE id = $1`,
        [room.id, started.phase, now, started.dataVersionId, hard, started.lifecycle ?? 'RUNNING'],
      );
      await tx.query(
        `DELETE FROM app_private.deadline_jobs WHERE room_id = $1 AND kind = 'room.lobby_expiry'`,
        [room.id],
      );
      return {
        reply: { stateVersion: (BigInt(room.state_version) + 1n).toString() },
        bumpState: true,
        touch: true,
        events: started.events,
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** Pick the earliest-joined connected non-spectator (UUID tie-break), else earliest joined. */
function successorFor(
  members: MemberRow[],
  excludingUserId: string,
  requireOnline: boolean,
): MemberRow | undefined {
  const candidates = members.filter((m) => m.user_id !== excludingUserId && m.role === 'player');
  const ordered = [...candidates].sort(
    (a, b) => a.joined_at.getTime() - b.joined_at.getTime() || (a.id < b.id ? -1 : 1),
  );
  return ordered.find((m) => m.online) ?? (requireOnline ? undefined : ordered[0]);
}

/** Catalog shape for memberLeft/memberRemoved (events.json). */
function departure(member: MemberRow) {
  return {
    memberId: member.id,
    displayName: member.display_name,
    seat: member.seat,
    connectionStatus: 'offline',
  };
}

export async function leaveRoom(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'leave' } },
    async ({ tx, room, now }) => {
      const members = await listMembers(tx, room.id);
      const me = members.find((m) => m.user_id === ctx.userId);
      // Retries of a completed leave are answered from the receipt before this point.
      if (!me) throw new AppError('NOT_FOUND', 'Room not found.');
      if (room.lifecycle !== 'LOBBY') {
        // After start a player keeps their game position; leaving only drops controls.
        await tx.query('DELETE FROM app_private.room_connections WHERE member_id = $1', [me.id]);
        return {
          reply: { departed: true },
          afterCommit: [() => deps.onMemberRemoved?.(room.id, me.id)],
        };
      }
      const remaining = members.filter((m) => m.id !== me.id);
      if (remaining.length === 0) {
        await tx.query('DELETE FROM app_private.rooms WHERE id = $1', [room.id]);
        return {
          reply: { departed: true },
          roomDeleted: true,
          afterCommit: [() => deps.onRoomClosed?.(room.id)],
        };
      }
      await tx.query('DELETE FROM app_private.room_members WHERE id = $1', [me.id]);
      const events: EventDraft[] = [
        { audience: { kind: 'public' }, type: 'room.memberLeft', payload: departure(me) },
      ];
      if (room.host_user_id === ctx.userId) {
        const next = successorFor(remaining, ctx.userId, false) ?? remaining[0];
        if (next) {
          await tx.query('UPDATE app_private.rooms SET host_user_id = $2 WHERE id = $1', [
            room.id,
            next.user_id,
          ]);
          events.push({
            audience: { kind: 'public' },
            type: 'room.hostTransferred',
            payload: { configVersion: room.config_version, hostId: next.id, reason: 'host_left' },
          });
        }
      }
      await touchLobby(tx, room, now);
      return {
        reply: { departed: true },
        events,
        afterCommit: [() => deps.onMemberRemoved?.(room.id, me.id)],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

export async function kickMember(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  memberId: string,
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'kick', memberId } },
    async ({ tx, room, now }) => {
      const me = await memberOf(tx, room, ctx.userId);
      requireHost(room, ctx.userId);
      if (room.lifecycle !== 'LOBBY')
        throw new AppError('GAME_STARTED', 'Players cannot be removed after the start.');
      if (memberId === me.id)
        throw new AppError('RULE_VIOLATION', 'You cannot remove yourself; leave the room instead.');
      const target = (await listMembers(tx, room.id)).find((m) => m.id === memberId);
      if (!target) throw new AppError('NOT_FOUND', 'That member is not in this room.');
      await tx.query('DELETE FROM app_private.room_members WHERE id = $1', [target.id]);
      await touchLobby(tx, room, now);
      return {
        reply: { removed: true },
        touch: true,
        events: [
          { audience: { kind: 'public' }, type: 'room.memberRemoved', payload: departure(target) },
        ],
        afterCommit: [() => deps.onMemberRemoved?.(room.id, target.id)],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** Voluntary host transfer: the target must accept within 60 seconds. */
export async function proposeHostTransfer(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  memberId: string,
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'host.propose', memberId } },
    async ({ tx, room, now }) => {
      const me = await memberOf(tx, room, ctx.userId);
      requireHost(room, ctx.userId);
      const target = (await listMembers(tx, room.id)).find((m) => m.id === memberId);
      if (!target || target.id === me.id || target.role !== 'player') {
        throw new AppError('RULE_VIOLATION', 'Choose another active player.');
      }
      await tx.query(
        `UPDATE app_private.host_handovers SET status = 'cancelled' WHERE room_id = $1 AND status = 'pending'`,
        [room.id],
      );
      const expiresAt = new Date(now.getTime() + HANDOVER_TTL_MS);
      const handover = one(
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.host_handovers (room_id, from_member_id, to_member_id, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [room.id, me.id, target.id, now, expiresAt],
        ),
      );
      await tx.query(
        `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
         VALUES ($1, 'room.handover_expiry', $2, 0, $3)`,
        [room.id, handover.id, expiresAt],
      );
      return {
        reply: { pendingHandover: handover.id, expiresAt: expiresAt.toISOString() },
        touch: true,
        events: [
          {
            audience: { kind: 'member', memberId: target.id },
            type: 'room.hostHandoverProposed',
            payload: {
              handoverId: handover.id,
              fromMemberId: me.id,
              expiresAt: expiresAt.toISOString(),
            },
          },
        ],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

export async function acceptHostTransfer(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  handoverId: string,
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'host.accept', handoverId } },
    async ({ tx, room, now }) => {
      const me = await memberOf(tx, room, ctx.userId);
      const res = await tx.query<{ id: string; from_member_id: string }>(
        `SELECT id, from_member_id FROM app_private.host_handovers
          WHERE id = $1 AND room_id = $2 AND to_member_id = $3 AND status = 'pending' AND expires_at > $4`,
        [handoverId, room.id, me.id, now],
      );
      if (!res.rows[0]) throw new AppError('STATE_CONFLICT', 'This host request has expired.');
      await tx.query(`UPDATE app_private.host_handovers SET status = 'accepted' WHERE id = $1`, [
        handoverId,
      ]);
      await tx.query('UPDATE app_private.rooms SET host_user_id = $2 WHERE id = $1', [
        room.id,
        ctx.userId,
      ]);
      return {
        reply: { hostId: me.id },
        touch: true,
        events: [
          {
            audience: { kind: 'public' },
            type: 'room.hostTransferred',
            payload: { configVersion: room.config_version, hostId: me.id, reason: 'accepted' },
          },
        ],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** Explicit fenced takeover: this tab becomes the controller; older tabs' epoch goes stale (E25). */
export async function takeControl(
  deps: RoomDeps,
  ctx: MemberContext,
  roomId: string,
  input: { currentEpoch: string; socketId: string },
  commandId: string,
) {
  return runRoomCommand(
    deps.pool,
    { roomId, actorKey: userKey(ctx.userId), commandId, body: { op: 'control', ...input } },
    async ({ tx, room }) => {
      const me = await memberOf(tx, room, ctx.userId);
      if (me.control_epoch !== input.currentEpoch) {
        throw new AppError(
          'CONTROL_EPOCH_STALE',
          'Another tab already took control. Refresh this one.',
        );
      }
      const owns = await tx.query(
        'SELECT 1 FROM app_private.room_connections WHERE member_id = $1 AND socket_id = $2',
        [me.id, input.socketId],
      );
      if (owns.rowCount !== 1) throw new AppError('RULE_VIOLATION', 'Connect this tab first.');
      const newEpoch = (BigInt(me.control_epoch) + 1n).toString();
      await tx.query('UPDATE app_private.room_members SET control_epoch = $2 WHERE id = $1', [
        me.id,
        newEpoch,
      ]);
      await tx.query(
        'UPDATE app_private.room_connections SET is_controller = false WHERE member_id = $1',
        [me.id],
      );
      await tx.query(
        'UPDATE app_private.room_connections SET is_controller = true, lease_epoch = $3 WHERE member_id = $1 AND socket_id = $2',
        [me.id, input.socketId, newEpoch],
      );
      return {
        reply: { newEpoch },
        events: [
          {
            audience: { kind: 'member', memberId: me.id },
            type: 'member.controlChanged',
            payload: { newEpoch, controllerConnectionId: input.socketId },
          },
        ],
      };
    },
    { settleDue: deps.settleDue, wake: deps.wake },
  );
}

/** Append system events for an already-locked room (used by workers and presence). */
export async function appendSystemEvents(tx: Tx, room: RoomRow, events: EventDraft[]) {
  if (events.length > 0) await appendEvents(tx, room.id, room.state_version, events);
}
