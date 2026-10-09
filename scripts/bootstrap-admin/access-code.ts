import { createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type pg from 'pg';

/** Same peppered Argon2id construction as apps/server PasswordHasher (pepper v1). */
export async function hashAccessCode(code: string, pepperBase64: string): Promise<string> {
  const pepper = Buffer.from(pepperBase64, 'base64url');
  if (pepper.length < 32) throw new Error('ACCESS_CODE_PEPPER_V1 must decode to at least 32 bytes');
  const peppered = createHmac('sha256', pepper).update(code.normalize('NFKC')).digest();
  return argon2.hash(peppered, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
}

export function generateAccessCode(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * First-time gate opening (operator only). Refuses to overwrite an existing
 * code — later rotations go through the audited admin API with step-up.
 */
export async function setInitialAccessCode(client: pg.Client, hash: string) {
  await client.query('BEGIN');
  try {
    const current = await client.query<{ code_hash: string | null; version: string }>(
      'SELECT code_hash, version::text FROM app_private.access_config WHERE id = 1 FOR UPDATE',
    );
    if (current.rows[0]?.code_hash) {
      throw new Error('An access code is already set; rotate it from the admin console instead.');
    }
    await client.query(
      `UPDATE app_private.access_config
          SET code_hash = $1, version = version + 1, min_valid_version = version + 1, updated_at = now(), rotated_at = now()
        WHERE id = 1`,
      [hash],
    );
    await client.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES (NULL, 'access.bootstrap', 'access_config', '{"operatorScript": true}')`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
