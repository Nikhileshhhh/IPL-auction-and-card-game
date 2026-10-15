import { createHash } from 'node:crypto';
import type pg from 'pg';
import { AppError } from '../http/app-error';
import { dbNow, withTransaction, type Tx } from '../db/transaction';
import { appendEvents, type EventDraft } from './streams';

export interface RoomRow {
  id: string;
  game_type: 'card' | 'auction';
  name: string;
  host_user_id: string;
  lifecycle: 'LOBBY' | 'RUNNING' | 'FINALIZING' | 'RESULTS' | 'PURGING' | 'ABORTED';
  phase: string;
  settings: Record<string, unknown>;
  max_members: number;
  results_ttl_seconds: number;
  config_version: string;
  state_version: string;
  generation: string;
  password_hash: string | null;
  code_ciphertext: Buffer;
  expires_at: Date;
  last_activity_at: Date;
  started_at: Date | null;
  data_version_id: string | null;
  ruleset_id: string | null;
  /** Outage recovery pause: gameplay waits until this time (ADR-027). */
  recovery_until: Date | null;
  recovery_generation: string;
  /** Set while an end-game vote is open (ADR-029): gameplay is frozen. */
  saved_phase: { voteId: string; phase: string; expiresAt: string } | null;
}

const ROOM_COLUMNS = `id, game_type, name, host_user_id, lifecycle, phase, settings, max_members, results_ttl_seconds,
  config_version::text, state_version::text, generation::text, password_hash, code_ciphertext, expires_at,
  last_activity_at, started_at, data_version_id, ruleset_id, recovery_until, recovery_generation::text, saved_phase`;

/** Lock order: room row first, always (DB/realtime §3). */
export async function lockRoom(tx: Tx, roomId: string): Promise<RoomRow> {
  const res = await tx.query<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM app_private.rooms WHERE id = $1 FOR UPDATE`,
    [roomId],
  );
  const room = res.rows[0];
  if (!room) throw new AppError('ROOM_GONE', 'This room no longer exists.');
  return room;
}

export async function readRoom(tx: Tx, roomId: string): Promise<RoomRow | undefined> {
  const res = await tx.query<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM app_private.rooms WHERE id = $1`,
    [roomId],
  );
  return res.rows[0];
}

/** Due-work hook: settle already-due deadlines before a later command (rules §7). */
export type DueSettler = (
  tx: Tx,
  room: RoomRow,
  now: Date,
) => Promise<{ events: EventDraft[]; afterCommit: (() => void)[] }>;

export interface CommandOutcome<T> {
  reply: T;
  events?: EventDraft[];
  /** Increment rooms.state_version (gameplay transitions only). */
  bumpState?: boolean;
  /** Extend lobby inactivity (successful human action). */
  touch?: boolean;
  afterCommit?: (() => void)[];
  /** The handler deleted the room (e.g. last lobby member left): no receipt or events. */
  roomDeleted?: boolean;
}

export interface CommandContext {
  tx: Tx;
  room: RoomRow;
  now: Date;
}

/** Canonical JSON (sorted keys) so retries with reordered keys hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function bodyHash(body: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(body)).digest();
}

export interface RoomCommandInput {
  roomId: string;
  /** `user:<uuid>` for humans, `system:<kind>` for workers. */
  actorKey: string;
  commandId: string;
  body: unknown;
}

export type OutboxWake = () => void;

/**
 * The single gameplay write path: lock room → idempotency receipt → DB clock →
 * settle due deadlines → handler → events + receipt → commit → wake outbox.
 * A retry with the same body returns the stored reply without re-applying; a
 * different body under the same command ID is IDEMPOTENCY_CONFLICT (E43/E44).
 */
export async function runRoomCommand<T>(
  pool: pg.Pool,
  input: RoomCommandInput,
  handler: (ctx: CommandContext) => Promise<CommandOutcome<T>>,
  options: {
    settleDue?: DueSettler;
    wake?: OutboxWake;
    beforeLock?: (tx: Tx) => Promise<void>;
  } = {},
): Promise<T> {
  const hash = bodyHash(input.body);
  const after: (() => void)[] = [];
  let refused: AppError | null = null;
  const reply = await withTransaction(pool, async (tx) => {
    after.length = 0;
    refused = null;
    // Global locks (e.g. per-user membership limits) are always taken before the room.
    if (options.beforeLock) await options.beforeLock(tx);
    const room = await lockRoom(tx, input.roomId);
    const prior = await tx.query<{ body_hash: Buffer; response: T }>(
      'SELECT body_hash, response FROM app_private.room_commands WHERE room_id = $1 AND actor_key = $2 AND command_id = $3',
      [input.roomId, input.actorKey, input.commandId],
    );
    const receipt = prior.rows[0];
    if (receipt) {
      if (!receipt.body_hash.equals(hash)) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'This request ID was already used for a different action.',
        );
      }
      return receipt.response;
    }
    const now = await dbNow(tx);
    let dueEvents: EventDraft[] = [];
    if (options.settleDue) {
      const due = await options.settleDue(tx, room, now);
      dueEvents = due.events;
      after.push(...due.afterCommit);
    }
    // Re-read in case a due transition changed the room; due events carry the
    // state version their transition produced.
    const current = await lockRoom(tx, input.roomId);
    if (dueEvents.length > 0) await appendEvents(tx, room.id, current.state_version, dueEvents);
    // A refused command still commits the due work settled above (rules §7):
    // the refusal rolls back only the handler's own writes.
    await tx.query('SAVEPOINT room_command');
    let outcome: CommandOutcome<T>;
    try {
      outcome = await handler({ tx, room: current, now });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await tx.query('ROLLBACK TO SAVEPOINT room_command');
      refused = error;
      return undefined as T;
    }
    if (outcome.roomDeleted) {
      after.push(...(outcome.afterCommit ?? []));
      return outcome.reply;
    }
    let stateVersion = current.state_version;
    if (outcome.bumpState) {
      stateVersion = (BigInt(stateVersion) + 1n).toString();
      await tx.query('UPDATE app_private.rooms SET state_version = $2 WHERE id = $1', [
        current.id,
        stateVersion,
      ]);
    }
    if (outcome.touch) {
      await tx.query('UPDATE app_private.rooms SET last_activity_at = $2 WHERE id = $1', [
        current.id,
        now,
      ]);
    }
    if (outcome.events?.length) await appendEvents(tx, current.id, stateVersion, outcome.events);
    await tx.query(
      `INSERT INTO app_private.room_commands (room_id, actor_key, command_id, body_hash, response)
       VALUES ($1, $2, $3, $4, $5)`,
      [current.id, input.actorKey, input.commandId, hash, JSON.stringify(outcome.reply ?? null)],
    );
    after.push(...(outcome.afterCommit ?? []));
    return outcome.reply;
  });
  options.wake?.();
  for (const fn of after) fn();
  if (refused) throw refused;
  return reply;
}

/**
 * Gameplay is frozen while an end-game vote is open (ADR-029) and during an
 * outage recovery pause (ADR-027), which waits for the visible countdown:
 * nothing can be bought or decided until play resumes.
 */
export function requireNotRecovering(room: RoomRow, now: Date) {
  if (room.saved_phase) {
    // An end-game vote freezes every gameplay action for its 15 seconds (ADR-029).
    throw new AppError('GAME_PAUSED', 'Play is paused while the room votes on ending the game.', {
      reason: 'VOTE',
      until: room.saved_phase.expiresAt,
    });
  }
  if (room.recovery_until && room.recovery_until.getTime() > now.getTime()) {
    throw new AppError('GAME_PAUSED', 'The server is recovering; play resumes in a moment.', {
      reason: 'RECOVERY',
      until: room.recovery_until.toISOString(),
    });
  }
}
