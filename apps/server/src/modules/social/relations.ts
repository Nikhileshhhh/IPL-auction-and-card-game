import type { FriendshipStatus } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';

/**
 * Relationship facts between two users (ADR-028). A block in either direction
 * conceals the other person everywhere social; only the blocker sees "blocked".
 */

type Db = Tx;

export const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

export async function blockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM app_private.user_blocks
      WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [a, b],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function friendshipRow(db: Db, a: string, b: string) {
  const [low, high] = pair(a, b);
  const res = await db.query<{ id: string; status: 'pending' | 'accepted'; requested_by: string }>(
    `SELECT id, status, requested_by FROM app_private.friendships WHERE low_user_id = $1 AND high_user_id = $2`,
    [low, high],
  );
  return res.rows[0] ?? null;
}

export async function relationship(
  db: Db,
  viewer: string,
  target: string,
): Promise<FriendshipStatus> {
  if (viewer === target) return 'self';
  const blocked = await db.query(
    'SELECT 1 FROM app_private.user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [viewer, target],
  );
  if (blocked.rowCount) return 'blocked';
  const row = await friendshipRow(db, viewer, target);
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requested_by === viewer ? 'requested' : 'incoming';
}

export async function areFriends(db: Db, a: string, b: string) {
  return (await friendshipRow(db, a, b))?.status === 'accepted';
}
