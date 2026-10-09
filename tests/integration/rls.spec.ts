import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  applyMigrations,
  connect,
  createEmptyDatabase,
  createUser,
  databaseUrlFor,
  listMigrations,
  resetDatabase,
  runtimeUrl,
} from '../support/db';

const DB = 'stumps_it_rls';
let admin: pg.Client;
let runtime: pg.Client;

async function expectSqlError(promise: Promise<unknown>, sqlState: string) {
  await expect(promise).rejects.toMatchObject({ code: sqlState });
}

/** Run a statement as a browser role inside a rolled-back savepoint. */
async function asRole(role: 'anon' | 'authenticated', sql: string) {
  await admin.query('BEGIN');
  try {
    await admin.query(`SET LOCAL ROLE ${role}`);
    return await admin.query(sql);
  } finally {
    await admin.query('ROLLBACK');
  }
}

async function appTables(client: pg.Client): Promise<string[]> {
  const res = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_private' AND c.relkind = 'r' ORDER BY 1`,
  );
  return res.rows.map((r) => r.relname);
}

/** Structural fingerprint used to compare fresh vs upgraded schemas. */
async function fingerprint(client: pg.Client): Promise<string> {
  const columns = await client.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'app_private' ORDER BY 1, 2`,
  );
  const constraints = await client.query(
    `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = 'app_private'::regnamespace ORDER BY 1, 2`,
  );
  const indexes = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'app_private' ORDER BY 1`,
  );
  const policies = await client.query(
    `SELECT tablename, policyname, roles::text, cmd FROM pg_policies WHERE schemaname = 'app_private' ORDER BY 1, 2`,
  );
  return JSON.stringify([columns.rows, constraints.rows, indexes.rows, policies.rows]);
}

beforeAll(async () => {
  await resetDatabase(DB);
  admin = await connect(databaseUrlFor(DB));
  runtime = await connect(runtimeUrl(DB));
});

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

describe('migrations', () => {
  it('a fresh reset applies every migration once and records checksums', async () => {
    const files = listMigrations();
    const ledger = await admin.query<{ id: string }>(
      'SELECT id FROM app_meta.schema_migrations ORDER BY id',
    );
    expect(ledger.rows.map((r) => r.id)).toEqual(files.map((f) => f.id));
    expect(files.map((f) => f.id).slice(0, 4)).toEqual([
      '000_extensions_roles_schema',
      '010_profiles_security',
      '020_catalog',
      '030_social_achievements',
    ]);
  });

  it('re-applying is a no-op and an edited applied migration is refused', async () => {
    expect(await applyMigrations(admin)).toEqual([]);
    const tampered = listMigrations().map((f, i) =>
      i === 1 ? { ...f, checksum: 'f'.repeat(64) } : f,
    );
    await expect(applyMigrations(admin, tampered)).rejects.toThrow(/was edited/);
  });

  it('upgrading from the 010 baseline preserves data and matches a fresh schema', async () => {
    const name = 'stumps_it_upgrade';
    const url = await createEmptyDatabase(name);
    const upgraded = await connect(url);
    try {
      const all = listMigrations();
      const baseline = all.filter((f) => f.id <= '010_profiles_security');
      await applyMigrations(upgraded, baseline);
      const userId = await createUser(upgraded, 'baseline_user');
      const ran = await applyMigrations(upgraded, all);
      expect(ran).toEqual(all.filter((f) => f.id > '010_profiles_security').map((f) => f.id));
      const kept = await upgraded.query(
        'SELECT username FROM app_private.profiles WHERE user_id = $1',
        [userId],
      );
      expect(kept.rows[0]).toEqual({ username: 'baseline_user' });
      expect(await fingerprint(upgraded)).toEqual(await fingerprint(admin));
    } finally {
      await upgraded.end();
    }
  });
});

describe('browser roles are denied everywhere (B classification)', () => {
  it('anon and authenticated cannot read or write any app_private table', async () => {
    const tables = await appTables(admin);
    expect(tables.length).toBeGreaterThanOrEqual(35);
    for (const role of ['anon', 'authenticated'] as const) {
      for (const table of tables) {
        await expectSqlError(asRole(role, `SELECT 1 FROM app_private.${table} LIMIT 1`), '42501');
        await expectSqlError(asRole(role, `DELETE FROM app_private.${table}`), '42501');
      }
    }
  });

  it('browser roles have no USAGE on the private schema even with a real-looking JWT role', async () => {
    const usage = await admin.query(
      `SELECT has_schema_privilege('anon','app_private','USAGE') AS anon,
              has_schema_privilege('authenticated','app_private','USAGE') AS auth`,
    );
    expect(usage.rows[0]).toEqual({ anon: false, auth: false });
  });
});

describe('runtime role least privilege', () => {
  it('is not superuser, cannot bypass RLS, create databases or roles', async () => {
    const res = await admin.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'app_runtime'`,
    );
    expect(res.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it('cannot run DDL in app_private or public', async () => {
    await expectSqlError(runtime.query('CREATE TABLE app_private.evil (id int)'), '42501');
    await expectSqlError(runtime.query('CREATE TABLE public.evil (id int)'), '42501');
    await expectSqlError(
      runtime.query('ALTER TABLE app_private.profiles DISABLE ROW LEVEL SECURITY'),
      '42501',
    );
    await expectSqlError(runtime.query('DROP TABLE app_private.profiles'), '42501');
  });

  it('cannot read provider-owned auth tables', async () => {
    await expectSqlError(runtime.query('SELECT * FROM auth.users LIMIT 1'), '42501');
  });

  it('cannot assign administrators (bootstrap is operator-only)', async () => {
    const userId = await createUser(admin, 'would_be_admin');
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.admin_assignments (user_id, role) VALUES ($1, 'super_admin')`,
        [userId],
      ),
      '42501',
    );
    await expectSqlError(
      runtime.query(`UPDATE app_private.admin_assignments SET role = 'super_admin'`),
      '42501',
    );
  });

  it('cannot edit or delete achievement receipts, only append them', async () => {
    const userId = await createUser(admin, 'medal_holder');
    await runtime.query(
      `INSERT INTO app_private.achievement_receipts
         (award_batch, user_id, game_type, rank, medal_place, medal, scope, credited_role, completion_day,
          ruleset_version, qualifies)
       VALUES (gen_random_uuid(), $1, 'card', 1, 1, 'gold', 'personal', 'player', current_date, 'card-v1', true)`,
      [userId],
    );
    await expectSqlError(
      runtime.query(`UPDATE app_private.achievement_receipts SET medal = 'gold'`),
      '42501',
    );
    await expectSqlError(runtime.query(`DELETE FROM app_private.achievement_receipts`), '42501');
  });

  it('can perform ordinary profile reads and writes through its policy', async () => {
    const userId = await createUser(admin, 'runtime_ok');
    await runtime.query(`UPDATE app_private.profiles SET bio = 'hello' WHERE user_id = $1`, [
      userId,
    ]);
    const res = await runtime.query('SELECT bio FROM app_private.profiles WHERE user_id = $1', [
      userId,
    ]);
    expect(res.rows[0]).toEqual({ bio: 'hello' });
  });

  it('table grants alone never expose rows: a role without a policy sees nothing', async () => {
    await createUser(admin, 'hidden_row');
    await admin.query(`DROP ROLE IF EXISTS rls_probe`);
    await admin.query(`CREATE ROLE rls_probe NOLOGIN`);
    await admin.query(`GRANT USAGE ON SCHEMA app_private TO rls_probe`);
    await admin.query(`GRANT SELECT ON app_private.profiles TO rls_probe`);
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE rls_probe');
      const res = await admin.query('SELECT count(*)::int AS n FROM app_private.profiles');
      expect(res.rows[0]).toEqual({ n: 0 });
    } finally {
      await admin.query('ROLLBACK');
      await admin.query(`REVOKE ALL ON app_private.profiles FROM rls_probe`);
      await admin.query(`REVOKE ALL ON SCHEMA app_private FROM rls_probe`);
      await admin.query(`DROP ROLE rls_probe`);
    }
  });
});

describe('relational integrity and cross-user constraints', () => {
  it('enforces username format and case-insensitive uniqueness', async () => {
    await createUser(admin, 'unique_name');
    const other = await admin.query<{ id: string }>(
      `INSERT INTO auth.users (email) VALUES ('dupe@example.test') RETURNING id`,
    );
    await expectSqlError(
      admin.query(
        `INSERT INTO app_private.profiles (user_id, username, display_name) VALUES ($1, 'UNIQUE_NAME', 'x')`,
        [other.rows[0]!.id],
      ),
      '23514',
    );
    await expectSqlError(
      admin.query(
        `INSERT INTO app_private.profiles (user_id, username, display_name) VALUES ($1, 'unique_name', 'x')`,
        [other.rows[0]!.id],
      ),
      '23505',
    );
  });

  it('friendships are canonical pairs requested by an endpoint, once', async () => {
    const a = await createUser(admin, 'friend_a');
    const b = await createUser(admin, 'friend_b');
    const c = await createUser(admin, 'friend_c');
    const [low, high] = [a, b].sort();
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status) VALUES ($1,$2,$1,'pending')`,
        [high, low],
      ),
      '23514',
    );
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status) VALUES ($1,$2,$3,'pending')`,
        [low, high, c],
      ),
      '23514',
    );
    await runtime.query(
      `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status) VALUES ($1,$2,$1,'pending')`,
      [low, high],
    );
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status) VALUES ($1,$2,$2,'pending')`,
        [low, high],
      ),
      '23505',
    );
  });

  it('users cannot block themselves', async () => {
    const a = await createUser(admin, 'self_blocker');
    await expectSqlError(
      runtime.query(
        'INSERT INTO app_private.user_blocks (blocker_id, blocked_id) VALUES ($1, $1)',
        [a],
      ),
      '23514',
    );
  });

  it('receipts are unique per award batch and medals map exactly to places', async () => {
    const u = await createUser(admin, 'receipt_user');
    const insert = (
      batch: string,
      medal: string | null,
      place: number | null,
      qualifies = true,
      game = 'card',
      scope = 'personal',
    ) =>
      runtime.query(
        `INSERT INTO app_private.achievement_receipts
           (award_batch, user_id, game_type, rank, medal_place, medal, scope, credited_role, completion_day,
            ruleset_version, qualifies)
         VALUES ($1, $2, $3, 1, $4, $5, $6, 'player', current_date, 'v1', $7)`,
        [batch, u, game, place, medal, scope, qualifies],
      );
    const batch = '9e21c15b-c550-4637-a0f5-00e200000010';
    await insert(batch, 'gold', 1);
    await expectSqlError(insert(batch, 'gold', 1), '23505');
    await expectSqlError(insert('9e21c15b-c550-4637-a0f5-00e200000011', 'gold', 2), '23514');
    await expectSqlError(
      insert('9e21c15b-c550-4637-a0f5-00e200000012', 'bronze', 3, false),
      '23514',
    );
    await expectSqlError(
      insert('9e21c15b-c550-4637-a0f5-00e200000013', null, null, true, 'card', 'franchise'),
      '23514',
    );
    const dup = await runtime.query(
      `INSERT INTO app_private.achievement_receipts
         (award_batch, user_id, game_type, rank, medal_place, medal, scope, credited_role, completion_day,
          ruleset_version, qualifies)
       VALUES ($1, $2, 'card', 1, 1, 'gold', 'personal', 'player', current_date, 'v1', true)
       ON CONFLICT (award_batch, user_id) DO NOTHING RETURNING id`,
      [batch, u],
    );
    expect(dup.rowCount).toBe(0);
  });

  it('gate grants bind a user exactly when bound; socket tickets live at most 30 seconds', async () => {
    const u = await createUser(admin, 'grant_user');
    const hash = () => `decode(md5(random()::text) || md5(random()::text), 'hex')`;
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.gate_grants (token_hash, token_ciphertext, user_id, access_version, kind, expires_at)
         VALUES (${hash()}, '\\x00', $1, 1, 'preauth', now() + interval '10 minutes')`,
        [u],
      ),
      '23514',
    );
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.gate_grants (token_hash, token_ciphertext, access_version, kind, expires_at)
         VALUES (${hash()}, '\\x00', 1, 'bound', now() + interval '10 minutes')`,
      ),
      '23514',
    );
    const grant = await runtime.query<{ id: string }>(
      `INSERT INTO app_private.gate_grants (token_hash, token_ciphertext, user_id, access_version, kind, expires_at)
       VALUES (${hash()}, '\\x00', $1, 1, 'bound', now() + interval '12 hours') RETURNING id`,
      [u],
    );
    const session = await runtime.query<{ id: string }>(
      `INSERT INTO app_private.app_sessions (user_id, supabase_session_id, gate_grant_id, scope, expires_at)
       VALUES ($1, gen_random_uuid(), $2, 'member', now() + interval '12 hours') RETURNING id`,
      [u, grant.rows[0]!.id],
    );
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.socket_tickets (token_hash, session_id, grant_id, origin, expires_at)
         VALUES (${hash()}, $1, $2, 'http://localhost:3000', now() + interval '31 seconds')`,
        [session.rows[0]!.id, grant.rows[0]!.id],
      ),
      '23514',
    );
  });

  it('the access gate is fail-closed and fixed at three failures', async () => {
    const cfg = await runtime.query(
      'SELECT code_hash, max_failures FROM app_private.access_config WHERE id = 1',
    );
    expect(cfg.rows[0]).toEqual({ code_hash: null, max_failures: 3 });
    await expectSqlError(
      runtime.query('UPDATE app_private.access_config SET max_failures = 4'),
      '23514',
    );
    await expectSqlError(
      runtime.query(
        'INSERT INTO app_private.access_config (id, version, min_valid_version) VALUES (2, 1, 1)',
      ),
      '42501',
    );
  });

  it('account erasure cascades to owned profile data', async () => {
    const u = await createUser(admin, 'erase_me');
    const v = await createUser(admin, 'erase_friend');
    const [low, high] = [u, v].sort();
    await admin.query(
      `INSERT INTO app_private.friendships (low_user_id, high_user_id, requested_by, status) VALUES ($1,$2,$1,'accepted')`,
      [low, high],
    );
    await admin.query('DELETE FROM auth.users WHERE id = $1', [u]);
    const left = await admin.query(
      `SELECT (SELECT count(*) FROM app_private.profiles WHERE user_id = $1)::int AS profiles,
              (SELECT count(*) FROM app_private.friendships WHERE low_user_id = $1 OR high_user_id = $1)::int AS edges`,
      [u],
    );
    expect(left.rows[0]).toEqual({ profiles: 0, edges: 0 });
  });
});

describe('published catalog versions are immutable (E64)', () => {
  async function draftVersion(label: string) {
    const season = await admin.query<{ id: string }>(
      `INSERT INTO app_private.seasons (competition, label, starts_on, ends_on, snapshot_cutoff)
       VALUES ('DEMO', $1, '2026-01-01', '2026-12-31', now()) RETURNING id`,
      [label],
    );
    const source = await admin.query<{ id: string }>(
      `INSERT INTO app_private.data_sources (publisher, url, fetched_at, licence_label)
       VALUES ('STUMPS', 'stumps:demo-generator', now(), 'Original demo data') RETURNING id`,
    );
    const version = await admin.query<{ id: string }>(
      `INSERT INTO app_private.data_versions (season_id, label, kind, cutoff_at)
       VALUES ($1, 'v1', 'demo', now()) RETURNING id`,
      [season.rows[0]!.id],
    );
    const player = await admin.query<{ id: string }>(
      `INSERT INTO app_private.players (canonical_name, country_code, primary_role, is_fictional)
       VALUES ('Demo Batter', 'IN', 'batter', true) RETURNING id`,
    );
    return {
      versionId: version.rows[0]!.id,
      playerId: player.rows[0]!.id,
      sourceId: source.rows[0]!.id,
    };
  }

  async function publish(versionId: string) {
    await runtime.query(
      `UPDATE app_private.data_versions SET status = 'published', published_at = now(),
         content_hash = encode(sha256(id::text::bytea), 'hex') WHERE id = $1`,
      [versionId],
    );
  }

  it('rating rows of a published version cannot be inserted, changed or deleted', async () => {
    const { versionId, playerId } = await draftVersion('immut-1');
    await runtime.query(
      `INSERT INTO app_private.player_ratings (data_version_id, player_id, model_version, metric, points, completeness, provenance)
       VALUES ($1, $2, 'ratings-v1', 'batting', 700, 1, 'demo')`,
      [versionId, playerId],
    );
    await publish(versionId);
    await expectSqlError(
      runtime.query(
        `UPDATE app_private.player_ratings SET points = 999 WHERE data_version_id = $1`,
        [versionId],
      ),
      '23514',
    );
    await expectSqlError(
      runtime.query(`DELETE FROM app_private.player_ratings WHERE data_version_id = $1`, [
        versionId,
      ]),
      '23514',
    );
    await expectSqlError(
      runtime.query(
        `INSERT INTO app_private.player_ratings (data_version_id, player_id, model_version, metric, points, completeness, provenance)
         VALUES ($1, $2, 'ratings-v1', 'bowling', 100, 1, 'demo')`,
        [versionId, playerId],
      ),
      '23514',
    );
    await expectSqlError(
      runtime.query(`UPDATE app_private.data_versions SET label = 'renamed' WHERE id = $1`, [
        versionId,
      ]),
      '23514',
    );
    await expectSqlError(
      runtime.query(`DELETE FROM app_private.data_versions WHERE id = $1`, [versionId]),
      '23514',
    );
    await runtime.query(`UPDATE app_private.data_versions SET status = 'archived' WHERE id = $1`, [
      versionId,
    ]);
    await expectSqlError(
      runtime.query(`UPDATE app_private.data_versions SET status = 'published' WHERE id = $1`, [
        versionId,
      ]),
      '23514',
    );
  });

  it('dual cards need exactly two players and single cards exactly one (deferred check)', async () => {
    const { versionId, playerId } = await draftVersion('immut-2');
    const ratings = JSON.stringify({
      batting: 1,
      bowling: 1,
      fielding: 1,
      form: 1,
      experience: 1,
      versatility: 1,
    });
    await runtime.query('BEGIN');
    const card = await runtime.query<{ id: string }>(
      `INSERT INTO app_private.card_definitions (data_version_id, label, rarity, stars, ratings, model_version)
       VALUES ($1, 'Dual', 'dual_platinum', 5, $2, 'ratings-v1') RETURNING id`,
      [versionId, ratings],
    );
    await runtime.query(
      `INSERT INTO app_private.card_players (card_id, player_id, position) VALUES ($1, $2, 1)`,
      [card.rows[0]!.id, playerId],
    );
    await expectSqlError(runtime.query('COMMIT'), '23514');

    await runtime.query('BEGIN');
    const single = await runtime.query<{ id: string }>(
      `INSERT INTO app_private.card_definitions (data_version_id, label, rarity, stars, ratings, model_version)
       VALUES ($1, 'Single', 'gold', 4, $2, 'ratings-v1') RETURNING id`,
      [versionId, ratings],
    );
    await runtime.query(
      `INSERT INTO app_private.card_players (card_id, player_id, position) VALUES ($1, $2, 1)`,
      [single.rows[0]!.id, playerId],
    );
    await runtime.query('COMMIT');
    const count = await runtime.query(
      'SELECT count(*)::int AS n FROM app_private.card_players WHERE card_id = $1',
      [single.rows[0]!.id],
    );
    expect(count.rows[0]).toEqual({ n: 1 });
  });

  it('media assets reject path traversal keys and unsupported types', async () => {
    const base = `INSERT INTO app_private.media_assets
      (bucket, object_key, purpose, mime, size_bytes, width, height, rights_basis, rights_status, alt_text)
      VALUES ('original-assets', $1, 'portrait', $2, 1000, 320, 320, 'original-generated', 'approved', 'Portrait')`;
    await expectSqlError(runtime.query(base, ['players/../secrets', 'image/webp']), '23514');
    await expectSqlError(runtime.query(base, ['players/ok-key', 'image/svg+xml']), '23514');
    await runtime.query(base, ['players/ok-key', 'image/webp']);
  });
});
