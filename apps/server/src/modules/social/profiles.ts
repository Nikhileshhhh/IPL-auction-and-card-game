import type pg from 'pg';
import type { MemberCard, ProfileDTO, ProfilePatchSchema } from '@stumps/contracts';
import type { z } from 'zod';
import { withTransaction } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import { VARIANT_WIDTHS, processPortrait } from '../media/pipeline';
import { portraitPath, variantKey } from '../media/service';
import type { MediaStorage } from '../media/storage';
import { areFriends, blockedEitherWay, relationship } from './relations';

/**
 * Profiles (S29, ADR-028). Visibility: `members` (any signed-in member),
 * `friends` (accepted friends) or `private` (only the owner); a block in
 * either direction conceals the profile entirely — all as a 404, so nothing
 * reveals which case applied. Medal counters are read from the receipt-derived
 * summary only; the profile form can never set them. E-mail is never exposed.
 */

interface ProfileRow {
  user_id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_asset_id: string | null;
  visibility: 'members' | 'friends' | 'private';
  activity_visible: boolean;
}

const COLUMNS =
  'user_id, username, display_name, bio, avatar_asset_id, visibility, activity_visible';

export const avatarUrl = (assetId: string | null) => (assetId ? portraitPath(assetId, 320) : null);

export const memberCard = (
  r: Pick<ProfileRow, 'user_id' | 'username' | 'display_name' | 'avatar_asset_id'>,
): MemberCard => ({
  userId: r.user_id,
  username: r.username,
  displayName: r.display_name,
  avatarUrl: avatarUrl(r.avatar_asset_id),
});

async function summaryOf(pool: pg.Pool, userId: string) {
  const row = (
    await pool.query<{
      gold: string;
      silver: string;
      bronze: string;
      games: string;
      card_wins: string;
      auction_wins: string;
    }>(
      `SELECT gold, silver, bronze, games, card_wins, auction_wins
         FROM app_private.achievement_summaries WHERE user_id = $1`,
      [userId],
    )
  ).rows[0];
  return {
    gold: Number(row?.gold ?? 0),
    silver: Number(row?.silver ?? 0),
    bronze: Number(row?.bronze ?? 0),
    games: Number(row?.games ?? 0),
    cardWins: Number(row?.card_wins ?? 0),
    auctionWins: Number(row?.auction_wins ?? 0),
  };
}

async function inRoom(pool: pg.Pool, userId: string) {
  const res = await pool.query(
    `SELECT 1 FROM app_private.room_members m JOIN app_private.rooms r ON r.id = m.room_id
      WHERE m.user_id = $1 AND m.left_at IS NULL AND r.lifecycle IN ('LOBBY', 'RUNNING') LIMIT 1`,
    [userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Can `viewer` see `target`'s profile at all? */
async function visible(pool: pg.Pool, viewer: string, target: ProfileRow) {
  if (viewer === target.user_id) return true;
  if (await blockedEitherWay(pool, viewer, target.user_id)) return false;
  if (target.visibility === 'members') return true;
  if (target.visibility === 'friends') return areFriends(pool, viewer, target.user_id);
  return false;
}

async function toDTO(pool: pg.Pool, viewer: string, p: ProfileRow): Promise<ProfileDTO> {
  const status = await relationship(pool, viewer, p.user_id);
  const showActivity = viewer === p.user_id || (status === 'friends' && p.activity_visible);
  return {
    userId: p.user_id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: avatarUrl(p.avatar_asset_id),
    bio: p.bio,
    privacy: { visibility: p.visibility, activityVisible: p.activity_visible },
    friendshipStatus: status,
    achievementSummary: await summaryOf(pool, p.user_id),
    permittedActivity: showActivity ? { inRoom: await inRoom(pool, p.user_id) } : null,
  };
}

export async function profileByUsername(pool: pg.Pool, viewer: string, username: string) {
  const row = (
    await pool.query<ProfileRow>(
      `SELECT ${COLUMNS} FROM app_private.profiles
        WHERE lower(username) = lower($1) AND onboarded_at IS NOT NULL`,
      [username],
    )
  ).rows[0];
  if (!row || !(await visible(pool, viewer, row))) {
    throw new AppError('NOT_FOUND', 'This profile is private or does not exist.');
  }
  return toDTO(pool, viewer, row);
}

/** Achievement receipts, newest first, under the same visibility as the profile. */
export async function achievementsOf(pool: pg.Pool, viewer: string, userId: string) {
  const row = (
    await pool.query<ProfileRow>(`SELECT ${COLUMNS} FROM app_private.profiles WHERE user_id = $1`, [
      userId,
    ])
  ).rows[0];
  if (!row || !(await visible(pool, viewer, row))) {
    throw new AppError('NOT_FOUND', 'This profile is private or does not exist.');
  }
  const res = await pool.query<{
    game_type: 'card' | 'auction';
    medal: 'gold' | 'silver' | 'bronze' | null;
    rank: number | null;
    scope: 'personal' | 'franchise';
    credited_role: string;
    completion_day: Date;
  }>(
    `SELECT game_type, medal, rank, scope, credited_role, completion_day
       FROM app_private.achievement_receipts WHERE user_id = $1
      ORDER BY completion_day DESC, created_at DESC LIMIT 50`,
    [userId],
  );
  return {
    receipts: res.rows.map((r) => ({
      gameType: r.game_type,
      medal: r.medal,
      rank: r.rank,
      scope: r.scope,
      creditedRole: r.credited_role,
      completionDay: r.completion_day.toISOString().slice(0, 10),
    })),
  };
}

/** Own allowlisted fields only — never counters, roles or medals. */
export async function updateProfile(
  pool: pg.Pool,
  userId: string,
  patch: z.infer<typeof ProfilePatchSchema>,
) {
  const res = await pool.query<ProfileRow>(
    `UPDATE app_private.profiles
        SET display_name = coalesce($2, display_name),
            bio = CASE WHEN $3 THEN $4 ELSE bio END,
            visibility = coalesce($5, visibility),
            activity_visible = coalesce($6, activity_visible)
      WHERE user_id = $1 RETURNING ${COLUMNS}`,
    [
      userId,
      patch.displayName ?? null,
      patch.bio !== undefined,
      patch.bio ? patch.bio : null,
      patch.visibility ?? null,
      patch.activityVisible ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Profile not found.');
  return toDTO(pool, userId, row);
}

/**
 * A member's own avatar: PNG/JPEG/WebP bytes only (no SVG, no URL), at most
 * 2 MiB, decoded and re-encoded to WebP with all metadata stripped.
 */
export async function uploadAvatar(
  pool: pg.Pool,
  storage: MediaStorage,
  userId: string,
  imageBase64: string,
) {
  const image = await processPortrait(Buffer.from(imageBase64, 'base64'));
  const objectKey = `avatars/${userId.replace(/-/g, '')}/${image.sha256.slice(0, 24)}`;
  for (const width of VARIANT_WIDTHS) {
    const bytes = image.variants.get(width);
    if (bytes) await storage.put(variantKey(objectKey, width), bytes, 'image/webp');
  }
  const largest = image.variants.get(960);
  return withTransaction(pool, async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM app_private.media_assets WHERE object_key = $1`,
      [objectKey],
    );
    const assetId =
      existing.rows[0]?.id ??
      (
        await tx.query<{ id: string }>(
          `INSERT INTO app_private.media_assets
             (bucket, object_key, purpose, mime, size_bytes, width, height, variant_widths,
              rights_basis, rights_status, alt_text, owner_user_id)
           VALUES ('avatars', $1, 'avatar', 'image/webp', $2, $3, $4, $5, 'user-upload', 'approved',
                   'Profile picture', $6)
           RETURNING id`,
          [objectKey, largest?.length ?? 1, image.width, image.height, [...VARIANT_WIDTHS], userId],
        )
      ).rows[0]?.id;
    await tx.query('UPDATE app_private.profiles SET avatar_asset_id = $2 WHERE user_id = $1', [
      userId,
      assetId,
    ]);
    return { assetId: assetId as string, avatarUrl: avatarUrl(assetId ?? null) };
  });
}

/**
 * Member search by username prefix (≥ 3 characters, at most 20): never by
 * e-mail, never private profiles, never anyone blocked either way.
 */
export async function searchMembers(pool: pg.Pool, viewer: string, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 3 || !/^[a-z0-9_]+$/.test(q)) return { members: [] };
  const res = await pool.query<ProfileRow>(
    `SELECT ${COLUMNS} FROM app_private.profiles p
      WHERE lower(p.username) LIKE $2 || '%' AND p.user_id <> $1 AND p.onboarded_at IS NOT NULL
        AND p.visibility <> 'private'
        AND NOT EXISTS (SELECT 1 FROM app_private.user_blocks b
                         WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id)
                            OR (b.blocker_id = p.user_id AND b.blocked_id = $1))
      ORDER BY lower(p.username) LIMIT 20`,
    [viewer, q],
  );
  const members = [];
  for (const r of res.rows) {
    members.push({
      ...memberCard(r),
      friendshipStatus: await relationship(pool, viewer, r.user_id),
    });
  }
  return { members };
}
