import type { MediaStorage } from '../media/storage';
import { roomPrefix } from './index';

interface Queryable {
  query<R extends object>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export interface DeletionAudit {
  roomId: string;
  /** Tables that still hold rows for the room (empty when deleted). */
  remaining: Record<string, number>;
  /** Storage objects still under the room prefix. */
  objects: string[];
  clean: boolean;
}

/**
 * Deletion proof (master plan §8): every app_private table with a `room_id`
 * column — read from the live schema, so a new temporary table is covered
 * without editing this list — plus the root row, request receipts pointing at
 * the room, and the room's Storage prefix must all be empty.
 */
export async function auditRoomDeletion(
  db: Queryable,
  storage: MediaStorage,
  roomId: string,
): Promise<DeletionAudit> {
  const tables = await db.query<{ table_name: string }>(
    `SELECT DISTINCT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'app_private' AND c.column_name = 'room_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  const checks: [string, string][] = [
    ['rooms', 'id'],
    ['request_receipts', 'resource_id'],
    ...tables.rows.map((t) => [t.table_name, 'room_id'] as [string, string]),
  ];
  const remaining: Record<string, number> = {};
  for (const [table, column] of checks) {
    const res = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app_private.${table} WHERE ${column} = $1`,
      [roomId],
    );
    const n = res.rows[0]?.n ?? 0;
    if (n > 0) remaining[table] = n;
  }
  const objects = await storage.list(roomPrefix(roomId));
  return {
    roomId,
    remaining,
    objects,
    clean: Object.keys(remaining).length === 0 && objects.length === 0,
  };
}

/** Every table the audit covers (for reports). */
export async function auditedTables(db: Queryable) {
  const res = await db.query<{ table_name: string }>(
    `SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'app_private' AND column_name = 'room_id' ORDER BY table_name`,
  );
  return res.rows.map((r) => r.table_name);
}
