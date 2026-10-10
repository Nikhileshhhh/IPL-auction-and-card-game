import type pg from 'pg';
import type { Server } from 'socket.io';
import { toEnvelope } from '../rooms/projection';

export const streamRoom = (streamId: string) => `stream:${streamId}`;

/**
 * Transactional outbox publisher (DB/realtime §3.1). Events are emitted to the
 * Socket.IO room of their audience stream, in commit order, then marked
 * published. A crash before marking may re-send: clients dedupe by seq.
 * "Published" is not proof of receipt — replay is the recovery path.
 */
export class OutboxDispatcher {
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly pool: pg.Pool,
    private readonly io: Server,
    private readonly batch = 200,
  ) {}

  start(pollMs = 250) {
    this.timer = setInterval(() => this.wake(), pollMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  wake = () => {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.wake();
      }
    });
  };

  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const res = await this.pool
        .query<{
          id: string;
          schema_version: number;
          type: string;
          stream_id: string;
          seq: string;
          state_version: string;
          created_at: Date;
          payload: Record<string, unknown>;
        }>(
          `SELECT id, schema_version, type, stream_id, seq::text, state_version::text, created_at, payload
             FROM app_private.room_events WHERE published_at IS NULL ORDER BY position LIMIT $1`,
          [this.batch],
        )
        .catch(() => ({ rows: [] as never[] }));
      if (res.rows.length === 0) return total;
      for (const row of res.rows) {
        this.io.to(streamRoom(row.stream_id)).emit('room.event', toEnvelope(row));
      }
      await this.pool
        .query(
          'UPDATE app_private.room_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])',
          [res.rows.map((r) => r.id)],
        )
        .catch(() => undefined);
      total += res.rows.length;
      if (res.rows.length < this.batch) return total;
    }
  }
}
