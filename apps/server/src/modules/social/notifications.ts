import type pg from 'pg';
import type { NotificationsView } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { portraitPath } from '../media/service';

/**
 * The personal inbox (S31, DB/realtime §5.1): friend updates and room
 * invitations with a safe payload — names and ids only, never room codes,
 * passwords or chat text. Items expire after 30 days at most.
 */

type Db = Tx;
const TTL_DAYS = 30;

export async function notify(
  db: Db,
  userId: string,
  type: 'friend.requested' | 'friend.accepted' | 'room.invited',
  payload: Record<string, string>,
) {
  await db.query(
    `INSERT INTO app_private.notifications (user_id, type, safe_payload, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, type, JSON.stringify(payload), TTL_DAYS],
  );
}

export async function notificationsView(pool: pg.Pool, userId: string): Promise<NotificationsView> {
  const items = await pool.query<{
    id: string;
    type: string;
    safe_payload: Record<string, unknown>;
    created_at: Date;
    read_at: Date | null;
  }>(
    `SELECT id, type, safe_payload, created_at, read_at FROM app_private.notifications
      WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC, id LIMIT 50`,
    [userId],
  );
  const invites = await pool.query<{
    id: string;
    room_id: string;
    name: string;
    game_type: 'card' | 'auction';
    lifecycle: string;
    has_password: boolean;
    expires_at: Date;
    from_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
  }>(
    `SELECT i.id, i.room_id, r.name, r.game_type, r.lifecycle, r.password_hash IS NOT NULL AS has_password,
            i.expires_at, p.user_id AS from_id, p.username, p.display_name, p.avatar_asset_id AS avatar
       FROM app_private.room_invites i
       JOIN app_private.rooms r ON r.id = i.room_id
       JOIN app_private.profiles p ON p.user_id = i.inviter_id
      WHERE i.recipient_id = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM app_private.user_blocks b
                         WHERE (b.blocker_id = i.recipient_id AND b.blocked_id = i.inviter_id)
                            OR (b.blocker_id = i.inviter_id AND b.blocked_id = i.recipient_id))
      ORDER BY i.expires_at DESC`,
    [userId],
  );
  return {
    notifications: items.rows.map((n) => ({
      id: n.id,
      type: n.type,
      payload: n.safe_payload,
      createdAt: n.created_at.toISOString(),
      read: n.read_at !== null,
    })),
    invites: invites.rows.map((i) => ({
      inviteId: i.id,
      roomId: i.room_id,
      roomName: i.name,
      gameType: i.game_type,
      from: {
        userId: i.from_id,
        username: i.username,
        displayName: i.display_name,
        avatarUrl: i.avatar ? portraitPath(i.avatar, 320) : null,
      },
      expiresAt: i.expires_at.toISOString(),
      needsPassword: i.has_password,
      open: i.lifecycle === 'LOBBY',
    })),
    unread: items.rows.filter((n) => n.read_at === null).length,
  };
}

export async function markRead(pool: pg.Pool, userId: string, id: string) {
  const res = await pool.query(
    `UPDATE app_private.notifications SET read_at = coalesce(read_at, now())
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!res.rowCount) throw new AppError('NOT_FOUND', 'Notification not found.');
  return { read: true };
}
