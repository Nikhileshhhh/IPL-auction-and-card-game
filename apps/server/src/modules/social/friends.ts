import type pg from 'pg';
import type { FriendsView } from '@stumps/contracts';
import { withTransaction, type Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { notify } from './notifications';
import { memberCard } from './profiles';
import { blockedEitherWay, friendshipRow, pair, relationship } from './relations';

/**
 * Friends and blocks (S30, DB/realtime §7, ADR-028). Requests are idempotent,
 * capped at 20 pending, and impossible to or from a blocked person; only the
 * recipient accepts. Removing a friend or blocking someone cancels the room
 * invitations between them; unblocking never restores a friendship.
 */

const MAX_PENDING = 20;

async function profileOf(db: Tx, userId: string) {
  const res = await db.query<{
    user_id: string;
    username: string;
    display_name: string;
    avatar_asset_id: string | null;
  }>(
    `SELECT user_id, username, display_name, avatar_asset_id FROM app_private.profiles
      WHERE user_id = $1 AND onboarded_at IS NOT NULL`,
    [userId],
  );
  return res.rows[0] ?? null;
}

async function cancelInvites(tx: Tx, a: string, b: string) {
  await tx.query(
    `DELETE FROM app_private.room_invites
      WHERE accepted_at IS NULL
        AND ((inviter_id = $1 AND recipient_id = $2) OR (inviter_id = $2 AND recipient_id = $1))`,
    [a, b],
  );
}

/** Serialise one pair's changes (friend request racing the reverse request). */
async function lockPair(tx: Tx, a: string, b: string) {
  const [low, high] = pair(a, b);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `friend:${low}:${high}`,
  ]);
}

export async function requestFriend(pool: pg.Pool, me: string, target: string) {
  if (me === target) throw new AppError('VALIDATION_FAILED', 'You cannot befriend yourself.');
  return withTransaction(pool, async (tx) => {
    await lockPair(tx, me, target);
    const other = await profileOf(tx, target);
    // A block either way reads exactly like an unknown member.
    if (!other || (await blockedEitherWay(tx, me, target))) {
      throw new AppError('NOT_FOUND', 'Member not found.');
    }
    const existing = await friendshipRow(tx, me, target);
    if (existing?.status === 'accepted')
      return { status: 'friends' as const, friendshipId: existing.id };
    if (existing && existing.requested_by === me) {
      return { status: 'requested' as const, friendshipId: existing.id };
    }
    if (existing) {
      // They already asked: asking back accepts.
      await tx.query(`UPDATE app_private.friendships SET status = 'accepted' WHERE id = $1`, [
        existing.id,
      ]);
      const mine = await profileOf(tx, me);
      await notify(tx, target, 'friend.accepted', {
        userId: me,
        username: mine?.username ?? '',
        displayName: mine?.display_name ?? '',
      });
      return { status: 'friends' as const, friendshipId: existing.id };
    }
    const pending = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app_private.friendships WHERE requested_by = $1 AND status = 'pending'`,
      [me],
    );
    if ((pending.rows[0]?.n ?? 0) >= MAX_PENDING) {
      throw new AppError('RULE_VIOLATION', 'You have 20 requests waiting; wait for some answers.', {
        reason: 'TOO_MANY_PENDING',
      });
    }
    const [low, high] = pair(me, target);
    const id = (
      await tx.query<{ id: string }>(
        `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status)
         VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [low, high, me],
      )
    ).rows[0]?.id as string;
    const mine = await profileOf(tx, me);
    await notify(tx, target, 'friend.requested', {
      userId: me,
      username: mine?.username ?? '',
      displayName: mine?.display_name ?? '',
    });
    return { status: 'requested' as const, friendshipId: id };
  });
}

export async function acceptFriend(pool: pg.Pool, me: string, friendshipId: string) {
  return withTransaction(pool, async (tx) => {
    const row = (
      await tx.query<{
        low_user_id: string;
        high_user_id: string;
        requested_by: string;
        status: string;
      }>(
        `SELECT low_user_id, high_user_id, requested_by, status FROM app_private.friendships WHERE id = $1 FOR UPDATE`,
        [friendshipId],
      )
    ).rows[0];
    if (!row || (row.low_user_id !== me && row.high_user_id !== me)) {
      throw new AppError('NOT_FOUND', 'Request not found.');
    }
    if (row.status === 'accepted') return { status: 'friends' as const };
    if (row.requested_by === me) {
      throw new AppError('NOT_RECIPIENT', 'Only the person you asked can accept.');
    }
    await tx.query(`UPDATE app_private.friendships SET status = 'accepted' WHERE id = $1`, [
      friendshipId,
    ]);
    const mine = await profileOf(tx, me);
    await notify(tx, row.requested_by, 'friend.accepted', {
      userId: me,
      username: mine?.username ?? '',
      displayName: mine?.display_name ?? '',
    });
    return { status: 'friends' as const };
  });
}

/** Reject, cancel or remove — any endpoint of the edge; idempotent. */
export async function removeFriend(pool: pg.Pool, me: string, friendshipId: string) {
  return withTransaction(pool, async (tx) => {
    const row = (
      await tx.query<{ low_user_id: string; high_user_id: string }>(
        `DELETE FROM app_private.friendships WHERE id = $1 AND (low_user_id = $2 OR high_user_id = $2)
         RETURNING low_user_id, high_user_id`,
        [friendshipId, me],
      )
    ).rows[0];
    if (row) await cancelInvites(tx, row.low_user_id, row.high_user_id);
    return { removed: true };
  });
}

export async function blockMember(pool: pg.Pool, me: string, target: string) {
  if (me === target) throw new AppError('VALIDATION_FAILED', 'You cannot block yourself.');
  return withTransaction(pool, async (tx) => {
    await lockPair(tx, me, target);
    if (!(await profileOf(tx, target))) throw new AppError('NOT_FOUND', 'Member not found.');
    await tx.query(
      `INSERT INTO app_private.user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [me, target],
    );
    const [low, high] = pair(me, target);
    await tx.query(
      'DELETE FROM app_private.friendships WHERE low_user_id = $1 AND high_user_id = $2',
      [low, high],
    );
    await cancelInvites(tx, me, target);
    return { blocked: true };
  });
}

export async function unblockMember(pool: pg.Pool, me: string, target: string) {
  await pool.query(
    'DELETE FROM app_private.user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [me, target],
  );
  return { unblocked: true };
}

export async function friendsView(pool: pg.Pool, me: string): Promise<FriendsView> {
  const rows = await pool.query<{
    id: string;
    status: 'pending' | 'accepted';
    requested_by: string;
    updated_at: Date;
    created_at: Date;
    user_id: string;
    username: string;
    display_name: string;
    avatar_asset_id: string | null;
    activity_visible: boolean;
    in_room: boolean;
  }>(
    `SELECT f.id, f.status, f.requested_by, f.updated_at, f.created_at,
            p.user_id, p.username, p.display_name, p.avatar_asset_id, p.activity_visible,
            EXISTS (SELECT 1 FROM app_private.room_members m JOIN app_private.rooms r ON r.id = m.room_id
                     WHERE m.user_id = p.user_id AND m.left_at IS NULL
                       AND r.lifecycle IN ('LOBBY', 'RUNNING')) AS in_room
       FROM app_private.friendships f
       JOIN app_private.profiles p
         ON p.user_id = CASE WHEN f.low_user_id = $1 THEN f.high_user_id ELSE f.low_user_id END
      WHERE (f.low_user_id = $1 OR f.high_user_id = $1)
      ORDER BY lower(p.username)`,
    [me],
  );
  const blocked = await pool.query<{
    user_id: string;
    username: string;
    display_name: string;
    avatar_asset_id: string | null;
  }>(
    `SELECT p.user_id, p.username, p.display_name, p.avatar_asset_id FROM app_private.user_blocks b
       JOIN app_private.profiles p ON p.user_id = b.blocked_id
      WHERE b.blocker_id = $1 ORDER BY lower(p.username)`,
    [me],
  );
  return {
    friends: rows.rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({
        ...memberCard(r),
        friendshipId: r.id,
        since: r.updated_at.toISOString(),
        inRoom: r.activity_visible ? r.in_room : null,
      })),
    incoming: rows.rows
      .filter((r) => r.status === 'pending' && r.requested_by !== me)
      .map((r) => ({ ...memberCard(r), friendshipId: r.id, at: r.created_at.toISOString() })),
    outgoing: rows.rows
      .filter((r) => r.status === 'pending' && r.requested_by === me)
      .map((r) => ({ ...memberCard(r), friendshipId: r.id, at: r.created_at.toISOString() })),
    blocked: blocked.rows.map(memberCard),
  };
}

// ----------------------------------------------------------- room invites
const INVITE_MS = 2 * 60 * 60_000;

/** Invite an accepted friend to a room you are in. Never carries the code or password. */
export async function inviteToRoom(pool: pg.Pool, me: string, roomId: string, friend: string) {
  return withTransaction(pool, async (tx) => {
    const room = (
      await tx.query<{ name: string; game_type: string; lifecycle: string; expires_at: Date }>(
        `SELECT r.name, r.game_type, r.lifecycle, r.expires_at FROM app_private.rooms r
           JOIN app_private.room_members m ON m.room_id = r.id AND m.user_id = $2 AND m.left_at IS NULL
          WHERE r.id = $1`,
        [roomId, me],
      )
    ).rows[0];
    if (!room) throw new AppError('NOT_FOUND', 'Room not found.');
    if (room.lifecycle !== 'LOBBY') {
      throw new AppError('GAME_STARTED', 'Invite friends before the game starts.');
    }
    if (
      (await relationship(tx, me, friend)) !== 'friends' ||
      (await blockedEitherWay(tx, me, friend))
    ) {
      throw new AppError('NOT_FOUND', 'You can only invite your friends.');
    }
    const expiresAt = new Date(Math.min(Date.now() + INVITE_MS, room.expires_at.getTime()));
    const id = (
      await tx.query<{ id: string }>(
        `INSERT INTO app_private.room_invites (room_id, inviter_id, recipient_id, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (room_id, recipient_id) DO UPDATE
           SET inviter_id = EXCLUDED.inviter_id, expires_at = EXCLUDED.expires_at, accepted_at = NULL
         RETURNING id`,
        [roomId, me, friend, expiresAt],
      )
    ).rows[0]?.id as string;
    const mine = await profileOf(tx, me);
    await notify(tx, friend, 'room.invited', {
      inviteId: id,
      roomName: room.name,
      gameType: room.game_type,
      fromDisplayName: mine?.display_name ?? '',
    });
    return { inviteId: id, expiresAt: expiresAt.toISOString() };
  });
}

/** The invitation the recipient may use to join (the room password is still checked by join). */
export async function usableInvite(pool: pg.Pool, me: string, inviteId: string) {
  const row = (
    await pool.query<{ room_id: string; inviter_id: string; game_type: 'card' | 'auction' }>(
      `SELECT i.room_id, i.inviter_id, r.game_type FROM app_private.room_invites i
         JOIN app_private.rooms r ON r.id = i.room_id
        WHERE i.id = $1 AND i.recipient_id = $2 AND i.accepted_at IS NULL AND i.expires_at > now()`,
      [inviteId, me],
    )
  ).rows[0];
  if (!row || (await blockedEitherWay(pool, me, row.inviter_id))) {
    throw new AppError('NOT_FOUND', 'This invitation has expired.');
  }
  return row;
}

export async function markInviteAccepted(pool: pg.Pool, inviteId: string) {
  await pool.query('UPDATE app_private.room_invites SET accepted_at = now() WHERE id = $1', [
    inviteId,
  ]);
}
