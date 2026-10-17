import type pg from 'pg';
import { DEFAULT_UI_PREFERENCES, type UiPreferences } from '@stumps/contracts';
import { one } from '../../db/rows';

/**
 * Noncritical UI preferences (ADR-031): motion, sound effects and low-data
 * mode. They never change what the server decides or sends; a member
 * without a row gets the defaults.
 */

type Row = { motion: UiPreferences['motion']; sound_effects: boolean; low_data: boolean };

const toDto = (r: Row): UiPreferences => ({
  motion: r.motion,
  soundEffects: r.sound_effects,
  lowData: r.low_data,
});

export async function readPreferences(pool: pg.Pool, userId: string): Promise<UiPreferences> {
  const res = await pool.query<Row>(
    'SELECT motion, sound_effects, low_data FROM app_private.ui_preferences WHERE user_id = $1',
    [userId],
  );
  return res.rows[0] ? toDto(res.rows[0]) : { ...DEFAULT_UI_PREFERENCES };
}

export async function updatePreferences(
  pool: pg.Pool,
  userId: string,
  patch: { [K in keyof UiPreferences]?: UiPreferences[K] | undefined },
): Promise<UiPreferences> {
  const next = { ...(await readPreferences(pool, userId)), ...patch };
  const res = await pool.query<Row>(
    `INSERT INTO app_private.ui_preferences (user_id, motion, sound_effects, low_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       motion = COALESCE($5, app_private.ui_preferences.motion),
       sound_effects = COALESCE($6, app_private.ui_preferences.sound_effects),
       low_data = COALESCE($7, app_private.ui_preferences.low_data)
     RETURNING motion, sound_effects, low_data`,
    [
      userId,
      next.motion,
      next.soundEffects,
      next.lowData,
      patch.motion ?? null,
      patch.soundEffects ?? null,
      patch.lowData ?? null,
    ],
  );
  return toDto(one(res));
}
