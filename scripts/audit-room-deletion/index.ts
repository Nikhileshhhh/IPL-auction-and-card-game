/**
 * Operator-only deletion proof and restore sweep (ADR-030).
 *   MIGRATION_DATABASE_URL=... tsx scripts/audit-room-deletion/index.ts <roomId> [<roomId> ...]
 *     → for each room, every table with a room_id column, the root, request
 *       receipts and the Storage prefix must be empty; exit 1 otherwise.
 *   MIGRATION_DATABASE_URL=... tsx scripts/audit-room-deletion/index.ts --sweep
 *     → after a backup restore, before admitting users: queue and run cleanup
 *       for every expired, aborted, purging or abandoned room, then report.
 * Output carries only identifiers and counts, never room content. Database
 * backups and provider logs keep their own retention: this proves live data
 * deletion, not erasure from backups.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { auditRoomDeletion } from '../../apps/server/src/modules/cleanup/audit';
import { runCleanupPass, scanRooms } from '../../apps/server/src/modules/cleanup';
import {
  LocalDiskStorage,
  SupabaseStorage,
  type MediaStorage,
} from '../../apps/server/src/modules/media/storage';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { sweep: { type: 'boolean', default: false } },
});
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required');

function storage(): MediaStorage {
  if (process.env.MEDIA_STORAGE === 'supabase') {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDIA_BUCKET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MEDIA_BUCKET) {
      throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and MEDIA_BUCKET are required');
    }
    return new SupabaseStorage(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDIA_BUCKET);
  }
  return new LocalDiskStorage(process.env.MEDIA_DIR ?? '.local/media');
}

const pool = new pg.Pool({ connectionString: url, max: 2 });
const media = storage();
let failed = false;
try {
  if (values.sweep) {
    const scan = await scanRooms(pool, media);
    let rounds = 0;
    let purged = 0;
    for (;;) {
      const pass = await runCleanupPass(pool, media);
      purged += pass.purged;
      rounds += 1;
      if (pass.purged + pass.failed === 0 || rounds > 100) break;
    }
    const left = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app_private.rooms
        WHERE (lifecycle = 'RESULTS' AND result_expires_at <= now()) OR lifecycle IN ('ABORTED', 'PURGING')`,
    );
    const pending = left.rows[0]?.n ?? 0;
    console.warn(JSON.stringify({ scan, purged, pending }));
    failed = pending > 0;
  }
  for (const roomId of positionals) {
    const audit = await auditRoomDeletion(pool, media, roomId);
    console.warn(JSON.stringify(audit));
    failed ||= !audit.clean;
  }
} finally {
  await pool.end();
}
process.exit(failed ? 1 : 0);
