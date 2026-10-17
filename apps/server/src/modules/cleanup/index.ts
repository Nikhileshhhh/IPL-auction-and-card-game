import type pg from 'pg';
import { withTransaction, type Tx } from '../../db/transaction';
import { lockRoom } from '../../rooms/room-tx';
import type { MediaStorage } from '../media/storage';

/**
 * Recoverable room deletion (DB/realtime §7 steps 4–5, ADR-030). Storage and
 * PostgreSQL cannot share a transaction, so each room has one cleanup task:
 *
 *   freeze  → under the room lock: PURGING, revoke connections, invites,
 *             handovers and timers; wait for in-flight upload leases;
 *   assets  → delete every manifest object and everything under the room's
 *             Storage prefix, then list again until it is empty;
 *   rows    → under the room lock, verify the prefix is still empty, then
 *             delete the root: the cascade removes every temporary row, the
 *             manifest and the task itself.
 *
 * A failure keeps the inaccessible PURGING root and retries with backoff; a
 * second cleaner skips work another one holds (room lock + task lease).
 * Profiles, friendships, receipts, summaries and shared media are never
 * touched. Logs carry only counts and error codes, never room content.
 */

export const CLEANUP_LEASE_MS = 120_000;
/** Retry after 1, 5, 15 and 60 minutes, then hourly. */
export const CLEANUP_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];
/** A running room whose every human has been gone this long is aborted. */
export const ABANDON_MS = 30 * 60_000;
/** Backend-proxied room uploads hold at most this lease. */
export const UPLOAD_LEASE_MS = 60_000;
/** Cleanup this far past its due time is an alert. */
export const CLEANUP_OVERDUE_MS = 15 * 60_000;

export type CleanupReason = 'results' | 'aborted' | 'abandoned' | 'admin' | 'lobby';

export interface ClosedNotice {
  expiresAt: string;
  reason: CleanupReason;
  profileUrl: string;
}

export interface CleanupHooks {
  /** Tell former members the room is gone (sockets leave its streams). */
  onRoomClosed?: (roomId: string, notice: ClosedNotice) => void;
}

export const roomPrefix = (roomId: string) => `rooms/${roomId}`;

class CleanupError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Queue (or bring forward) a room's single cleanup task. */
export async function enqueueCleanup(tx: Tx, roomId: string, reason: CleanupReason, dueAt: Date) {
  await tx.query(
    `INSERT INTO app_private.cleanup_tasks (room_id, reason, next_attempt_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id) DO UPDATE
       SET next_attempt_at = LEAST(app_private.cleanup_tasks.next_attempt_at, EXCLUDED.next_attempt_at)`,
    [roomId, reason, dueAt],
  );
}

/**
 * Delete a room with nothing outside PostgreSQL at once; a room that has
 * Storage objects goes through the recoverable task instead.
 */
export async function deleteOrEnqueue(tx: Tx, roomId: string, reason: CleanupReason, now: Date) {
  const assets = await tx.query(
    'SELECT 1 FROM app_private.room_assets WHERE room_id = $1 LIMIT 1',
    [roomId],
  );
  if (assets.rowCount) {
    await enqueueCleanup(tx, roomId, reason, now);
    return 'queued' as const;
  }
  await tx.query('DELETE FROM app_private.rooms WHERE id = $1', [roomId]);
  return 'deleted' as const;
}

/** End a running room without results or medals (abandoned, or an integrity abort). */
export async function abortRoom(
  tx: Tx,
  roomId: string,
  reason: 'abandoned' | 'aborted',
  now: Date,
) {
  await tx.query(
    `UPDATE app_private.rooms SET lifecycle = 'ABORTED', phase = 'ABORTED', saved_phase = NULL WHERE id = $1`,
    [roomId],
  );
  await tx.query('DELETE FROM app_private.deadline_jobs WHERE room_id = $1', [roomId]);
  await enqueueCleanup(tx, roomId, reason, now);
}

export function backoffMs(attempts: number) {
  return CLEANUP_BACKOFF_MS[attempts - 1] ?? 3_600_000;
}

/** Claim a due task: the room row is skipped if locked, the task lease if held. */
async function claim(pool: pg.Pool, roomId: string) {
  return withTransaction(pool, async (tx) => {
    const room = await tx.query(
      'SELECT id FROM app_private.rooms WHERE id = $1 FOR UPDATE SKIP LOCKED',
      [roomId],
    );
    if (!room.rowCount) return null;
    const task = await tx.query<{ stage: 'freeze' | 'assets' | 'rows'; reason: CleanupReason }>(
      `UPDATE app_private.cleanup_tasks
          SET locked_until = now() + make_interval(secs => $2::double precision / 1000)
        WHERE room_id = $1 AND next_attempt_at <= now()
          AND (locked_until IS NULL OR locked_until <= now())
        RETURNING stage, reason`,
      [roomId, CLEANUP_LEASE_MS],
    );
    return task.rows[0] ?? null;
  });
}

/** Freeze: no new reads, writes, uploads or timers; returns when assets may be removed. */
async function freeze(pool: pg.Pool, roomId: string, reason: CleanupReason) {
  return withTransaction(pool, async (tx) => {
    const room = await lockRoom(tx, roomId);
    if (!['RESULTS', 'ABORTED', 'LOBBY', 'PURGING'].includes(room.lifecycle)) {
      throw new CleanupError('ROOM_NOT_FINISHED');
    }
    // A lobby never started or got a data version, which the schema allows
    // only while LOBBY or ABORTED: it is frozen as ABORTED (closed the same
    // way), stamped with the freeze time, and deleted moments later.
    await tx.query(
      `UPDATE app_private.rooms
          SET lifecycle = CASE WHEN data_version_id IS NULL THEN 'ABORTED' ELSE 'PURGING' END,
              started_at = COALESCE(started_at, now()),
              phase = 'PURGING', saved_phase = NULL
        WHERE id = $1`,
      [roomId],
    );
    for (const table of ['room_connections', 'room_invites', 'host_handovers', 'deadline_jobs']) {
      await tx.query(`DELETE FROM app_private.${table} WHERE room_id = $1`, [roomId]);
    }
    await tx.query(
      `UPDATE app_private.room_assets SET status = 'deleting' WHERE room_id = $1 AND status = 'ready'`,
      [roomId],
    );
    // In-flight backend uploads keep their (≤ 60 s) lease; remove after it ends.
    const lease = await tx.query<{ until: Date | null }>(
      `SELECT max(upload_expires_at) AS until FROM app_private.room_assets
        WHERE room_id = $1 AND status = 'uploading'`,
      [roomId],
    );
    const waitUntil = lease.rows[0]?.until ?? null;
    await tx.query(
      `UPDATE app_private.cleanup_tasks
          SET stage = 'assets', next_attempt_at = GREATEST(now(), COALESCE($2, now())),
              locked_until = CASE WHEN $2::timestamptz > now() THEN NULL ELSE locked_until END
        WHERE room_id = $1`,
      [roomId, waitUntil],
    );
    return { waiting: waitUntil !== null && waitUntil.getTime() > Date.now(), reason };
  });
}

/** Remove every room object (manifest and prefix) and prove the prefix empty. */
async function removeAssets(pool: pg.Pool, storage: MediaStorage, roomId: string) {
  const manifest = await pool.query<{ object_key: string }>(
    `SELECT object_key FROM app_private.room_assets WHERE room_id = $1 AND status <> 'deleted'`,
    [roomId],
  );
  let listed: string[];
  try {
    listed = await storage.list(roomPrefix(roomId));
  } catch {
    throw new CleanupError('STORAGE_LIST_FAILED');
  }
  const keys = [...new Set([...manifest.rows.map((r) => r.object_key), ...listed])];
  try {
    // Already-missing objects count as removed.
    for (let i = 0; i < keys.length; i += 100) await storage.remove(keys.slice(i, i + 100));
  } catch {
    throw new CleanupError('STORAGE_REMOVE_FAILED');
  }
  let left: string[];
  try {
    left = await storage.list(roomPrefix(roomId));
  } catch {
    throw new CleanupError('STORAGE_LIST_FAILED');
  }
  if (left.length) throw new CleanupError('PREFIX_NOT_EMPTY');
  await withTransaction(pool, async (tx) => {
    await lockRoom(tx, roomId);
    await tx.query(
      `UPDATE app_private.room_assets SET status = 'deleted' WHERE room_id = $1 AND status <> 'deleted'`,
      [roomId],
    );
    await tx.query(`UPDATE app_private.cleanup_tasks SET stage = 'rows' WHERE room_id = $1`, [
      roomId,
    ]);
  });
}

/** Verify nothing is left outside PostgreSQL, then delete the root (cascade). */
async function deleteRows(pool: pg.Pool, storage: MediaStorage, roomId: string) {
  let left: string[];
  try {
    left = await storage.list(roomPrefix(roomId));
  } catch {
    throw new CleanupError('STORAGE_LIST_FAILED');
  }
  if (left.length) {
    // A late object appeared: back to the assets stage.
    await pool.query(`UPDATE app_private.cleanup_tasks SET stage = 'assets' WHERE room_id = $1`, [
      roomId,
    ]);
    throw new CleanupError('PREFIX_NOT_EMPTY');
  }
  await withTransaction(pool, async (tx) => {
    const room = await lockRoom(tx, roomId);
    if (room.lifecycle !== 'PURGING' && room.lifecycle !== 'ABORTED') {
      throw new CleanupError('ROOM_NOT_PURGING');
    }
    const pending = await tx.query(
      `SELECT 1 FROM app_private.room_assets WHERE room_id = $1 AND status <> 'deleted' LIMIT 1`,
      [roomId],
    );
    if (pending.rowCount) throw new CleanupError('ASSETS_PENDING');
    await tx.query('DELETE FROM app_private.rooms WHERE id = $1', [roomId]);
  });
}

async function fail(pool: pg.Pool, roomId: string, code: string) {
  // Backoff 1, 5, 15, 60 minutes, then hourly (CLEANUP_BACKOFF_MS); never abandoned silently.
  await pool.query(
    `UPDATE app_private.cleanup_tasks
        SET attempts = attempts + 1, last_error_code = $2, locked_until = NULL,
            next_attempt_at = now() + make_interval(secs => (CASE attempts + 1
              WHEN 1 THEN 60 WHEN 2 THEN 300 WHEN 3 THEN 900 ELSE 3600 END)::double precision)
      WHERE room_id = $1`,
    [roomId, code],
  );
}

export interface CleanupOutcome {
  purged: number;
  waiting: number;
  failed: number;
  skipped: number;
}

/** One room, as far as it can go now. */
async function processRoom(
  pool: pg.Pool,
  storage: MediaStorage,
  hooks: CleanupHooks,
  roomId: string,
): Promise<keyof CleanupOutcome> {
  const task = await claim(pool, roomId);
  if (!task) return 'skipped';
  try {
    let stage = task.stage;
    if (stage === 'freeze') {
      const { waiting } = await freeze(pool, roomId, task.reason);
      hooks.onRoomClosed?.(roomId, {
        expiresAt: new Date().toISOString(),
        reason: task.reason,
        profileUrl: '/play',
      });
      if (waiting) return 'waiting';
      stage = 'assets';
    }
    if (stage === 'assets') {
      await removeAssets(pool, storage, roomId);
      stage = 'rows';
    }
    await deleteRows(pool, storage, roomId);
    return 'purged';
  } catch (error) {
    const code = error instanceof CleanupError ? error.code : 'CLEANUP_FAILED';
    await fail(pool, roomId, code).catch(() => undefined);
    return 'failed';
  }
}

/** Work through due cleanup tasks (bounded batch). Safe to run on several instances. */
export async function runCleanupPass(
  pool: pg.Pool,
  storage: MediaStorage,
  hooks: CleanupHooks = {},
  batch = 20,
): Promise<CleanupOutcome> {
  const due = await pool.query<{ room_id: string }>(
    `SELECT room_id FROM app_private.cleanup_tasks
      WHERE next_attempt_at <= now() AND (locked_until IS NULL OR locked_until <= now())
      ORDER BY next_attempt_at LIMIT $1`,
    [batch],
  );
  const outcome: CleanupOutcome = { purged: 0, waiting: 0, failed: 0, skipped: 0 };
  for (const { room_id } of due.rows) {
    outcome[await processRoom(pool, storage, hooks, room_id)] += 1;
  }
  return outcome;
}

export interface ScanOutcome {
  abandoned: number;
  queued: number;
  evaluationsRestored: number;
  lobbyTimersRestored: number;
  orphanPrefixes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Stranded-state and abandonment scan (DB/realtime §7, §4): run at startup,
 * periodically and after a backup restore, before users are admitted. It
 * never touches profiles, friendships, receipts or shared media.
 */
export async function scanRooms(pool: pg.Pool, storage: MediaStorage): Promise<ScanOutcome> {
  const out: ScanOutcome = {
    abandoned: 0,
    queued: 0,
    evaluationsRestored: 0,
    lobbyTimersRestored: 0,
    orphanPrefixes: 0,
  };
  // A running room every human left 30 minutes ago: aborted, no medals.
  const idle = await pool.query<{ id: string }>(
    `SELECT r.id FROM app_private.rooms r
      WHERE r.lifecycle = 'RUNNING' AND r.last_activity_at < now() - make_interval(secs => $1)
        AND NOT EXISTS (SELECT 1 FROM app_private.room_connections c WHERE c.room_id = r.id AND c.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM app_private.room_members m
                         WHERE m.room_id = r.id AND m.last_seen_at >= now() - make_interval(secs => $1))
        AND r.saved_phase IS NULL`,
    [ABANDON_MS / 1000],
  );
  for (const { id } of idle.rows) {
    const done = await withTransaction(pool, async (tx) => {
      const room = await lockRoom(tx, id);
      if (room.lifecycle !== 'RUNNING' || room.saved_phase) return false;
      await abortRoom(tx, id, 'abandoned', new Date());
      return true;
    });
    if (done) out.abandoned += 1;
  }
  // Finished, expired or interrupted rooms without a task get one.
  const queued = await pool.query(
    `INSERT INTO app_private.cleanup_tasks (room_id, reason, next_attempt_at)
     SELECT r.id,
            CASE WHEN r.lifecycle = 'RESULTS' THEN 'results' ELSE 'aborted' END,
            now()
       FROM app_private.rooms r
      WHERE ((r.lifecycle = 'RESULTS' AND r.result_expires_at <= now())
             OR r.lifecycle IN ('ABORTED', 'PURGING'))
        AND NOT EXISTS (SELECT 1 FROM app_private.cleanup_tasks t WHERE t.room_id = r.id)
     ON CONFLICT (room_id) DO NOTHING`,
  );
  out.queued = queued.rowCount ?? 0;
  // An auction stuck finalizing gets its evaluation job back.
  const evaluations = await pool.query(
    `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
     SELECT r.id, 'auction.evaluate', NULL, 0, now() FROM app_private.rooms r
      WHERE r.game_type = 'auction' AND r.lifecycle = 'FINALIZING'
        AND NOT EXISTS (SELECT 1 FROM app_private.deadline_jobs j
                         WHERE j.room_id = r.id AND j.kind = 'auction.evaluate')
     ON CONFLICT (room_id, kind, subject_id, generation) DO NOTHING`,
  );
  out.evaluationsRestored = evaluations.rowCount ?? 0;
  // A card match never stays in FINALIZING (it finalizes in one transaction):
  // one that does predates finalization and is aborted without medals.
  const legacy = await pool.query<{ id: string }>(
    `SELECT id FROM app_private.rooms WHERE game_type = 'card' AND lifecycle = 'FINALIZING'`,
  );
  for (const { id } of legacy.rows) {
    await withTransaction(pool, async (tx) => {
      const room = await lockRoom(tx, id);
      if (room.lifecycle === 'FINALIZING') await abortRoom(tx, id, 'aborted', new Date());
    });
    out.abandoned += 1;
  }
  // Every lobby keeps its expiry timer.
  const lobbies = await pool.query(
    `INSERT INTO app_private.deadline_jobs (room_id, kind, subject_id, generation, due_at)
     SELECT r.id, 'room.lobby_expiry', NULL, 0,
            LEAST(r.expires_at, r.last_activity_at + interval '30 minutes')
       FROM app_private.rooms r
      WHERE r.lifecycle = 'LOBBY'
        AND NOT EXISTS (SELECT 1 FROM app_private.deadline_jobs j
                         WHERE j.room_id = r.id AND j.kind = 'room.lobby_expiry')
        AND NOT EXISTS (SELECT 1 FROM app_private.cleanup_tasks t WHERE t.room_id = r.id)
     ON CONFLICT (room_id, kind, subject_id, generation) DO NOTHING`,
  );
  out.lobbyTimersRestored = lobbies.rowCount ?? 0;
  // Orphan room prefixes (the root is already gone): delete their objects.
  const keys = await storage.list('rooms').catch(() => [] as string[]);
  const byRoom = new Map<string, string[]>();
  for (const key of keys) {
    const id = key.split('/')[1] ?? '';
    if (!UUID.test(id)) continue;
    byRoom.set(id, [...(byRoom.get(id) ?? []), key]);
  }
  if (byRoom.size) {
    const live = await pool.query<{ id: string }>(
      'SELECT id FROM app_private.rooms WHERE id = ANY($1::uuid[])',
      [[...byRoom.keys()]],
    );
    const known = new Set(live.rows.map((r) => r.id));
    for (const [id, objects] of byRoom) {
      if (known.has(id)) continue;
      await storage.remove(objects).catch(() => undefined);
      out.orphanPrefixes += 1;
    }
  }
  return out;
}
