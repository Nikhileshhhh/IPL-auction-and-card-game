import type pg from 'pg';
import type { RoomRuntime } from '../modules/rooms/runtime';
import { sweepStaleConnections } from '../realtime/rooms-socket';
import { CoordinatorLease, runDuePass } from './deadlines';
import { OUTAGE_GAP_MS, recoverAfterOutage, type RecoveredRoom } from './recovery';

export interface RoomWorkerOptions {
  pool: pg.Pool;
  rooms: RoomRuntime;
  instanceId: string;
  tickMs?: number;
  onError?: (error: unknown) => void;
  /** Rooms paused for recovery after an outage (sockets get `server.recovering`). */
  onRecovered?: (rooms: RecoveredRoom[]) => void;
}

/**
 * Embedded background workers (ADR-007): only the fenced coordinator settles
 * due deadlines and sweeps stale connections. Everything a worker needs lives
 * in PostgreSQL, so a restart rebuilds timers from `deadline_jobs` and expired
 * `room_connections` instead of in-memory state.
 */
export function startRoomWorkers(options: RoomWorkerOptions): () => Promise<void> {
  const lease = new CoordinatorLease(options.pool, options.instanceId);
  const tickMs = options.tickMs ?? 500;
  let stopped = false;
  let running: Promise<void> | undefined;
  let lastSweep = 0;

  const tick = async () => {
    if (!(await lease.tryAcquire())) return;
    // Taking over after a crash or restart: pause clocks that fell due while nobody ran them.
    const gap = lease.takeoverGap;
    if (gap) {
      lease.takeoverGap = undefined;
      if (gap.gapMs > OUTAGE_GAP_MS) {
        const recovered = await recoverAfterOutage(options.pool, gap.lastHealthy);
        if (recovered.length) {
          options.rooms.deps.wake();
          options.onRecovered?.(recovered);
        }
      }
    }
    // Settle until nothing is due (a pass handles a bounded batch of rooms).
    while (
      !stopped &&
      (await runDuePass(options.pool, options.rooms.deadlines, options.rooms.deps.wake)) > 0
    ) {
      /* keep draining */
    }
    if (Date.now() - lastSweep >= 5_000) {
      lastSweep = Date.now();
      await sweepStaleConnections({ pool: options.pool, rooms: options.rooms.deps });
    }
  };

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = tick()
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        running = undefined;
      });
  }, tickMs);
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
    await lease.release().catch(() => undefined);
  };
}
