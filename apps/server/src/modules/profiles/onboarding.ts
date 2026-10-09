import type pg from 'pg';
import type { OnboardingRequest } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import type { MemberContext } from '../auth/service';
import { one } from '../../db/rows';

/** Reserved names that could impersonate staff or the product. */
const RESERVED = new Set([
  'admin',
  'administrator',
  'stumps',
  'support',
  'moderator',
  'system',
  'root',
  'operator',
]);

export async function usernameAvailable(pool: pg.Pool, username: string, selfId: string) {
  if (RESERVED.has(username))
    return { available: false, suggestion: `${username}_${Math.floor(Math.random() * 90 + 10)}` };
  const res = await pool.query(
    'SELECT 1 FROM app_private.profiles WHERE lower(username) = $1 AND user_id <> $2',
    [username, selfId],
  );
  if (res.rowCount === 0) return { available: true };
  for (let i = 0; i < 5; i += 1) {
    const candidate = `${username.slice(0, 20)}_${Math.floor(Math.random() * 900 + 100)}`;
    const taken = await pool.query(
      'SELECT 1 FROM app_private.profiles WHERE lower(username) = $1',
      [candidate],
    );
    if (taken.rowCount === 0) return { available: false, suggestion: candidate };
  }
  return { available: false };
}

/** S03: only allowlisted own fields; counters/roles are not writable here. */
export async function completeOnboarding(
  pool: pg.Pool,
  ctx: MemberContext,
  input: OnboardingRequest,
) {
  if (RESERVED.has(input.username))
    throw new AppError('USERNAME_TAKEN', 'That username is not available.');
  try {
    const res = await pool.query<{ username: string; display_name: string }>(
      `UPDATE app_private.profiles
          SET username = $2, display_name = $3, bio = $4, visibility = $5, activity_visible = $6,
              onboarded_at = COALESCE(onboarded_at, now())
        WHERE user_id = $1 RETURNING username, display_name`,
      [
        ctx.userId,
        input.username,
        input.displayName,
        input.bio ?? null,
        input.visibility,
        input.activityVisible,
      ],
    );
    return one(res);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      const alt = await usernameAvailable(pool, input.username, ctx.userId);
      throw new AppError(
        'USERNAME_TAKEN',
        'That username is taken.',
        alt.suggestion ? { suggestion: alt.suggestion } : {},
      );
    }
    throw error;
  }
}
