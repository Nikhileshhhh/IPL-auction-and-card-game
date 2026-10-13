import type pg from 'pg';
import { dbNow, withTransaction, type Tx } from '../db/transaction';
import { readRoom, type DueSettler, type RoomRow } from '../rooms/room-tx';
import type { EventDraft } from '../rooms/streams';
import { appendEvents } from '../rooms/streams';

export interface DeadlineJob {
  id: string;
  room_id: string;
  kind: string;
  subject_id: string | null;
  generation: string;
  due_at: Date;
}

export interface DeadlineResult {
  events?: EventDraft[];
  afterCommit?: (() => void)[];
  bumpState?: boolean;
  /** Handler deleted the room; stop processing its other jobs. */
  roomDeleted?: boolean;
}

/**
 * A handler re-validates its target under the room lock and no-ops when stale
 * (ADR-007). Queue rows are wakeup hints, never the sole source of truth.
 */
export type DeadlineHandler = (
  tx: Tx,
  room: RoomRow,
  job: DeadlineJob,
  now: Date,
) => Promise<DeadlineResult>;

export class DeadlineRegistry {
  private readonly handlers = new Map<string, DeadlineHandler>();
  register(kind: string, handler: DeadlineHandler) {
    this.handlers.set(kind, handler);
  }
  get(kind: string) {
    return this.handlers.get(kind);
  }
}

/** Settle every due job of an already-locked room, in due order. */
export async function settleDueJobs(
  registry: DeadlineRegistry,
  tx: Tx,
  room: RoomRow,
  now: Date,
): Promise<{
  events: EventDraft[];
  afterCommit: (() => void)[];
  roomDeleted: boolean;
  bumpState: boolean;
}> {
  const jobs = await tx.query<DeadlineJob>(
    `SELECT id, room_id, kind, subject_id, generation::text, due_at FROM app_private.deadline_jobs
      WHERE room_id = $1 AND due_at <= $2 ORDER BY due_at, id`,
    [room.id, now],
  );
  const events: EventDraft[] = [];
  const afterCommit: (() => void)[] = [];
  let bumpState = false;
  for (const job of jobs.rows) {
    const handler = registry.get(job.kind);
    await tx.query('DELETE FROM app_private.deadline_jobs WHERE id = $1', [job.id]);
    if (!handler) continue;
    const current = await readRoom(tx, room.id);
    if (!current) return { events: [], afterCommit, roomDeleted: true, bumpState };
    const result = await handler(tx, current, job, now);
    events.push(...(result.events ?? []));
    afterCommit.push(...(result.afterCommit ?? []));
    bumpState ||= Boolean(result.bumpState);
    if (result.roomDeleted) return { events: [], afterCommit, roomDeleted: true, bumpState };
  }
  return { events, afterCommit, roomDeleted: false, bumpState };
}

export function dueSettler(registry: DeadlineRegistry): DueSettler {
  return async (tx, room, now) => {
    const result = await settleDueJobs(registry, tx, room, now);
    if (result.bumpState) {
      await tx.query(
        'UPDATE app_private.rooms SET state_version = state_version + 1 WHERE id = $1',
        [room.id],
      );
    }
    return { events: result.events, afterCommit: result.afterCommit };
  };
}

/**
 * One worker pass: find rooms with due work without locking, then lock each
 * room with SKIP LOCKED (never child-before-room) and settle under that lock.
 */
export async function runDuePass(
  pool: pg.Pool,
  registry: DeadlineRegistry,
  wake: () => void,
  batch = 20,
): Promise<number> {
  const candidates = await pool.query<{ room_id: string }>(
    `SELECT DISTINCT room_id FROM (
        SELECT room_id, due_at FROM app_private.deadline_jobs WHERE due_at <= now() ORDER BY due_at LIMIT $1
     ) due`,
    [batch],
  );
  let processed = 0;
  for (const { room_id } of candidates.rows) {
    const after: (() => void)[] = [];
    const handled = await withTransaction(pool, async (tx) => {
      after.length = 0;
      const locked = await tx.query<{ id: string }>(
        'SELECT id FROM app_private.rooms WHERE id = $1 FOR UPDATE SKIP LOCKED',
        [room_id],
      );
      if (locked.rowCount !== 1) return false;
      const room = await readRoom(tx, room_id);
      if (!room) return false;
      const now = await dbNow(tx);
      const result = await settleDueJobs(registry, tx, room, now);
      after.push(...result.afterCommit);
      if (result.roomDeleted) return true;
      let stateVersion = room.state_version;
      if (result.bumpState) {
        stateVersion = (BigInt(stateVersion) + 1n).toString();
        await tx.query('UPDATE app_private.rooms SET state_version = $2 WHERE id = $1', [
          room.id,
          stateVersion,
        ]);
      }
      if (result.events.length) await appendEvents(tx, room.id, stateVersion, result.events);
      return true;
    }).catch(() => false);
    if (handled) {
      processed += 1;
      for (const fn of after) fn();
    }
  }
  if (processed > 0) wake();
  return processed;
}

/**
 * Coordinator lease (runtime_leases): one fenced owner runs workers; others
 * idle. A heartbeat gap beyond expiry lets another instance take over with a
 * higher generation.
 */
export class CoordinatorLease {
  generation: string | undefined;
  /**
   * Set once when this instance takes the lease over from another owner whose
   * last heartbeat is older than the outage gap (crash or restart, not a graceful
   * hand-over, which deletes the row): the last healthy heartbeat to recover from.
   */
  takeoverGap: { lastHealthy: Date; gapMs: number } | undefined;
  constructor(
    private readonly pool: pg.Pool,
    readonly ownerId: string,
    private readonly ttlMs = 10_000,
  ) {}

  async tryAcquire(): Promise<boolean> {
    const res = await this.pool.query<{
      generation: string;
      owner_id: string;
      previous_owner: string | null;
      previous_heartbeat: Date | null;
      db_now: Date;
    }>(
      `WITH prev AS (SELECT owner_id, heartbeat_at FROM app_private.runtime_leases WHERE name = 'coordinator')
       INSERT INTO app_private.runtime_leases (name, owner_id, generation, heartbeat_at, expires_at)
       VALUES ('coordinator', $1, 1, now(), now() + make_interval(secs => $2::double precision / 1000))
       ON CONFLICT (name) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         generation = CASE WHEN app_private.runtime_leases.owner_id = EXCLUDED.owner_id
                           THEN app_private.runtime_leases.generation ELSE app_private.runtime_leases.generation + 1 END,
         heartbeat_at = now(), expires_at = EXCLUDED.expires_at
       WHERE app_private.runtime_leases.owner_id = EXCLUDED.owner_id OR app_private.runtime_leases.expires_at < now()
       RETURNING generation::text, owner_id, (SELECT owner_id FROM prev) AS previous_owner,
                 (SELECT heartbeat_at FROM prev) AS previous_heartbeat, now() AS db_now`,
      [this.ownerId, this.ttlMs],
    );
    const row = res.rows[0];
    const wasMine = this.generation !== undefined;
    this.generation = row?.owner_id === this.ownerId ? row.generation : undefined;
    if (
      row &&
      this.generation !== undefined &&
      !wasMine &&
      row.previous_owner !== null &&
      row.previous_owner !== this.ownerId &&
      row.previous_heartbeat
    ) {
      const gapMs = row.db_now.getTime() - row.previous_heartbeat.getTime();
      this.takeoverGap = { lastHealthy: row.previous_heartbeat, gapMs };
    }
    return this.generation !== undefined;
  }

  async release() {
    await this.pool.query(
      `DELETE FROM app_private.runtime_leases WHERE name = 'coordinator' AND owner_id = $1`,
      [this.ownerId],
    );
    this.generation = undefined;
  }
}
