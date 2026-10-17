import type pg from 'pg';
import type { CleanupQueue } from '@stumps/contracts';
import { withTransaction, type Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { lockRoom } from '../../rooms/room-tx';
import { CLEANUP_OVERDUE_MS, abortRoom, enqueueCleanup } from './index';

/**
 * Operations side of cleanup (S33, DB/realtime §7): the queue with safe fields
 * only, an audited retry, and an audited integrity abort. None of them can
 * change a result or a medal. Audit rows record the action, never the room
 * identity or content (room identifiers stay in the room's own events).
 */

export async function cleanupQueue(pool: pg.Pool): Promise<CleanupQueue> {
  const res = await pool.query<{
    room_id: string;
    game_type: 'card' | 'auction';
    lifecycle: string;
    stage: 'freeze' | 'assets' | 'rows';
    reason: CleanupQueue['tasks'][number]['reason'];
    attempts: number;
    last_error_code: string | null;
    next_attempt_at: Date;
    overdue: boolean;
  }>(
    `SELECT t.room_id, r.game_type, r.lifecycle, t.stage, t.reason, t.attempts, t.last_error_code,
            t.next_attempt_at,
            (now() - COALESCE(r.result_expires_at, t.created_at)) > make_interval(secs => $1) AS overdue
       FROM app_private.cleanup_tasks t JOIN app_private.rooms r ON r.id = t.room_id
      ORDER BY t.next_attempt_at LIMIT 200`,
    [CLEANUP_OVERDUE_MS / 1000],
  );
  const tasks = res.rows.map((t) => ({
    roomId: t.room_id,
    gameType: t.game_type,
    lifecycle: t.lifecycle,
    stage: t.stage,
    reason: t.reason,
    attempts: t.attempts,
    lastErrorCode: t.last_error_code,
    nextAttemptAt: t.next_attempt_at.toISOString(),
    overdue: t.overdue,
  }));
  return {
    tasks,
    total: tasks.length,
    overdue: tasks.filter((t) => t.overdue).length,
    failing: tasks.filter((t) => t.attempts > 0).length,
  };
}

async function audit(tx: Tx, actorId: string, action: string, diff: object) {
  await tx.query(
    `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
     VALUES ($1, $2, 'room', $3)`,
    [actorId, action, JSON.stringify(diff)],
  );
}

/** Retry now: only rooms whose results expired, or that are purging or aborted. */
export async function retryCleanup(pool: pg.Pool, actorId: string, roomId: string) {
  return withTransaction(pool, async (tx) => {
    const room = await lockRoom(tx, roomId).catch(() => null);
    if (!room) throw new AppError('ROOM_GONE', 'This room has already been deleted.');
    const expired = await tx.query(
      `SELECT 1 FROM app_private.rooms WHERE id = $1
          AND ((lifecycle = 'RESULTS' AND result_expires_at <= now()) OR lifecycle IN ('PURGING', 'ABORTED'))`,
      [roomId],
    );
    if (!expired.rowCount) {
      throw new AppError(
        'STATE_CONFLICT',
        'Only expired, aborted or purging rooms can be retried.',
      );
    }
    await enqueueCleanup(
      tx,
      roomId,
      room.lifecycle === 'RESULTS' ? 'results' : 'admin',
      new Date(0),
    );
    await tx.query(
      `UPDATE app_private.cleanup_tasks SET next_attempt_at = now(), locked_until = NULL WHERE room_id = $1`,
      [roomId],
    );
    await audit(tx, actorId, 'cleanup.retry', { lifecycle: room.lifecycle });
    return { queued: true };
  });
}

/** Integrity/security abort of a running room: no medals, deleted without a results period. */
export async function adminAbort(pool: pg.Pool, actorId: string, roomId: string, reason: string) {
  return withTransaction(pool, async (tx) => {
    const room = await lockRoom(tx, roomId).catch(() => null);
    if (!room) throw new AppError('ROOM_GONE', 'This room has already been deleted.');
    if (!['LOBBY', 'RUNNING', 'FINALIZING'].includes(room.lifecycle)) {
      throw new AppError('STATE_CONFLICT', 'Only a room that has not finished can be aborted.');
    }
    await abortRoom(tx, roomId, 'aborted', new Date());
    await audit(tx, actorId, 'room.abort', { reasonLength: reason.length, from: room.lifecycle });
    return { aborted: true };
  });
}
