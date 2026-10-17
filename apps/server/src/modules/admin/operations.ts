import type pg from 'pg';
import type { AdminOverview, AdminRooms, AdminUser } from '@stumps/contracts';
import { ROOM_LIFECYCLES } from '@stumps/contracts';
import { one } from '../../db/rows';
import { withTransaction } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { cleanupQueue } from '../cleanup/admin';

/**
 * S33 operations read models and the two administrative writes of phase 16
 * (ADR-031). Every value is measured from the database at request time; a
 * widget that cannot be measured is reported as unavailable, never guessed.
 * Rows carry counts and safe fields only: no room names, codes, members,
 * chat, cards or results, and audit previews never include `safe_diff`.
 */

const MAX_SUSPENSION_MS = 366 * 24 * 3600 * 1000;

export async function adminOverview(pool: pg.Pool): Promise<AdminOverview> {
  const [lifecycles, connections, migration, leases, security, announcements, audit, queue] =
    await Promise.all([
      pool.query<{ lifecycle: string; n: number }>(
        `SELECT lifecycle, count(*)::int AS n FROM app_private.rooms GROUP BY lifecycle`,
      ),
      pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app_private.room_connections WHERE expires_at > now()`,
      ),
      pool.query<{ id: string }>(
        `SELECT id FROM app_meta.schema_migrations ORDER BY id DESC LIMIT 1`,
      ),
      pool.query<{ name: string; healthy: boolean; heartbeat_at: Date }>(
        `SELECT name, expires_at > now() AS healthy, heartbeat_at
           FROM app_private.runtime_leases ORDER BY name`,
      ),
      pool.query<{ warnings: number; suspended: number }>(
        `SELECT (SELECT count(*)::int FROM app_private.security_events
                  WHERE severity IN ('warning', 'critical') AND occurred_at > now() - interval '24 hours') AS warnings,
                (SELECT count(*)::int FROM app_private.profiles WHERE suspended_until > now()) AS suspended`,
      ),
      pool.query<{
        id: string;
        title: string;
        starts_at: Date;
        ends_at: Date;
        status: AdminOverview['announcements'][number]['status'];
      }>(
        `SELECT id, title, starts_at, ends_at,
                CASE WHEN archived_at IS NOT NULL THEN 'archived'
                     WHEN ends_at <= now() THEN 'ended'
                     WHEN starts_at > now() THEN 'scheduled'
                     ELSE 'active' END AS status
           FROM app_private.announcements
          ORDER BY (archived_at IS NULL AND ends_at > now()) DESC, starts_at DESC LIMIT 10`,
      ),
      pool.query<{
        action: string;
        target_class: string;
        username: string | null;
        occurred_at: Date;
      }>(
        `SELECT a.action, a.target_class, p.username, a.occurred_at
           FROM app_private.admin_audit a LEFT JOIN app_private.profiles p ON p.user_id = a.actor_id
          ORDER BY a.occurred_at DESC LIMIT 20`,
      ),
      cleanupQueue(pool),
    ]);
  const rooms = Object.fromEntries(ROOM_LIFECYCLES.map((l) => [l, 0])) as AdminOverview['rooms'];
  for (const r of lifecycles.rows) {
    if (r.lifecycle in rooms) rooms[r.lifecycle as keyof typeof rooms] = r.n;
  }
  return {
    generatedAt: new Date().toISOString(),
    health: {
      database: true,
      migration: migration.rows[0]?.id ?? 'none',
      workers: leases.rows.map((l) => ({
        name: l.name,
        healthy: l.healthy,
        heartbeatAt: l.heartbeat_at.toISOString(),
      })),
    },
    rooms,
    liveConnections: connections.rows[0]?.n ?? 0,
    cleanup: { total: queue.total, overdue: queue.overdue, failing: queue.failing },
    security: {
      warnings24h: security.rows[0]?.warnings ?? 0,
      suspendedUsers: security.rows[0]?.suspended ?? 0,
    },
    announcements: announcements.rows.map((a) => ({
      id: a.id,
      title: a.title,
      startsAt: a.starts_at.toISOString(),
      endsAt: a.ends_at.toISOString(),
      status: a.status,
    })),
    audit: audit.rows.map((a) => ({
      action: a.action,
      targetClass: a.target_class,
      actorUsername: a.username,
      occurredAt: a.occurred_at.toISOString(),
    })),
  };
}

/** S33 ActiveRoomTable: every room that is not yet deleted, newest activity first. */
export async function adminRooms(pool: pg.Pool): Promise<AdminRooms> {
  const res = await pool.query<{
    id: string;
    game_type: 'card' | 'auction';
    lifecycle: AdminRooms['rooms'][number]['lifecycle'];
    phase: string;
    members: number;
    live: number;
    created_at: Date;
    last_activity_at: Date;
    reason: AdminRooms['rooms'][number]['cleanupReason'];
    total: number;
  }>(
    `SELECT r.id, r.game_type, r.lifecycle, r.phase, r.created_at, r.last_activity_at,
            (SELECT count(*)::int FROM app_private.room_members m
              WHERE m.room_id = r.id AND m.left_at IS NULL) AS members,
            (SELECT count(*)::int FROM app_private.room_connections c
              WHERE c.room_id = r.id AND c.expires_at > now()) AS live,
            t.reason, count(*) OVER ()::int AS total
       FROM app_private.rooms r LEFT JOIN app_private.cleanup_tasks t ON t.room_id = r.id
      ORDER BY r.last_activity_at DESC LIMIT 100`,
  );
  return {
    total: res.rows[0]?.total ?? 0,
    rooms: res.rows.map((r) => ({
      roomId: r.id,
      gameType: r.game_type,
      lifecycle: r.lifecycle,
      phase: r.phase,
      members: r.members,
      liveConnections: r.live,
      createdAt: r.created_at.toISOString(),
      lastActivityAt: r.last_activity_at.toISOString(),
      cleanupReason: r.reason,
    })),
  };
}

type UserRow = {
  user_id: string;
  username: string;
  display_name: string;
  onboarded_at: Date | null;
  suspended_until: Date | null;
  is_admin: boolean;
  created_at: Date;
};

const USER_SQL = `SELECT p.user_id, p.username, p.display_name, p.onboarded_at, p.suspended_until,
                         p.created_at,
                         EXISTS (SELECT 1 FROM app_private.admin_assignments a
                                  WHERE a.user_id = p.user_id AND a.revoked_at IS NULL) AS is_admin
                    FROM app_private.profiles p`;

function userDto(r: UserRow): AdminUser {
  return {
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    onboarded: r.onboarded_at !== null,
    suspendedUntil:
      r.suspended_until && r.suspended_until > new Date() ? r.suspended_until.toISOString() : null,
    isAdmin: r.is_admin,
    createdAt: r.created_at.toISOString(),
  };
}

/** Exact username lookup (no prefix search, no email). */
export async function adminFindUser(pool: pg.Pool, username: string): Promise<AdminUser> {
  const res = await pool.query<UserRow>(`${USER_SQL} WHERE lower(p.username) = lower($1)`, [
    username,
  ]);
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'No member has that username.');
  return userDto(row);
}

/**
 * Suspend a member until a time, or lift a suspension. A suspension revokes
 * every session at once (sockets close on their next ticket or heartbeat
 * check); the member keeps their profile, friends and medals. Administrators
 * cannot be restricted here, and nobody can restrict themselves.
 */
export async function restrictUser(
  pool: pg.Pool,
  actorId: string,
  userId: string,
  suspendedUntil: Date | null,
  reason: string,
): Promise<AdminUser> {
  if (userId === actorId) throw new AppError('FORBIDDEN', 'You cannot restrict yourself.');
  return withTransaction(pool, async (tx) => {
    const { now } = one(await tx.query<{ now: Date }>('SELECT now() AS now'));
    if (suspendedUntil) {
      if (suspendedUntil <= now) {
        throw new AppError('VALIDATION_FAILED', 'Choose a time in the future.');
      }
      if (suspendedUntil.getTime() - now.getTime() > MAX_SUSPENSION_MS) {
        throw new AppError('VALIDATION_FAILED', 'A suspension can last at most a year.');
      }
    }
    const res = await tx.query<UserRow>(`${USER_SQL} WHERE p.user_id = $1 FOR UPDATE OF p`, [
      userId,
    ]);
    const row = res.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'No member has that ID.');
    if (row.is_admin) {
      throw new AppError('FORBIDDEN', 'Administrators are managed by the operator script.');
    }
    const updated = await tx.query<{ suspended_until: Date | null }>(
      `UPDATE app_private.profiles SET suspended_until = $2 WHERE user_id = $1
       RETURNING suspended_until`,
      [userId, suspendedUntil],
    );
    if (suspendedUntil) {
      await tx.query(
        `UPDATE app_private.app_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    }
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, $2, 'user', $3)`,
      [
        actorId,
        suspendedUntil ? 'user.suspend' : 'user.unsuspend',
        JSON.stringify({ reasonLength: reason.length }),
      ],
    );
    return userDto({ ...row, suspended_until: one(updated).suspended_until });
  });
}

export async function createAnnouncement(
  pool: pg.Pool,
  actorId: string,
  a: { title: string; body: string; startsAt: string; endsAt: string },
) {
  return withTransaction(pool, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO app_private.announcements (title, body, starts_at, ends_at, author_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [a.title, a.body, a.startsAt, a.endsAt, actorId],
    );
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'announcement.create', 'announcement', '{}')`,
      [actorId],
    );
    return { id: one(res).id };
  });
}

export async function archiveAnnouncement(pool: pg.Pool, actorId: string, id: string) {
  return withTransaction(pool, async (tx) => {
    const res = await tx.query(
      `UPDATE app_private.announcements SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL RETURNING id`,
      [id],
    );
    if (res.rowCount === 0) throw new AppError('NOT_FOUND', 'No open announcement has that ID.');
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'announcement.archive', 'announcement', '{}')`,
      [actorId],
    );
    return { id, archived: true };
  });
}
