import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
export const SEED_DIR = join(ROOT, 'supabase', 'seed');

/** Admin (superuser) URL used only by local reset/test tooling, never by the runtime. */
export function adminUrl(): string {
  return process.env.MIGRATION_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
}

export function databaseUrlFor(name: string, base = adminUrl()): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Destructive tooling refuses non-local hosts and production unless explicitly overridden. */
export function assertSafeToReset(url: string) {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing destructive reset in production');
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_DB_RESET !== 'yes') {
    throw new Error(`Refusing destructive reset against non-local host ${host}`);
  }
}

export interface MigrationFile {
  id: string;
  sql: string;
  checksum: string;
}

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), 'utf8');
      return {
        id: file.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

export function listSeeds(dir = SEED_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), 'utf8');
      return { id: file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/** Apply pending migrations, each in its own transaction, recording a checksum ledger. */
export async function applyMigrations(client: pg.Client, files = listMigrations()) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS app_meta`);
  await client.query(`REVOKE ALL ON SCHEMA app_meta FROM PUBLIC`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
       id text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const applied = new Map(
    (
      await client.query<{ id: string; checksum: string }>(
        'SELECT id, checksum FROM app_meta.schema_migrations',
      )
    ).rows.map((r) => [r.id, r.checksum]),
  );
  const ran: string[] = [];
  for (const file of files) {
    const previous = applied.get(file.id);
    if (previous) {
      if (previous !== file.checksum)
        throw new Error(`Applied migration ${file.id} was edited; add a new migration instead`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(file.sql);
      await client.query('INSERT INTO app_meta.schema_migrations (id, checksum) VALUES ($1, $2)', [
        file.id,
        file.checksum,
      ]);
      await client.query('COMMIT');
      ran.push(file.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file.id} failed: ${(error as Error).message}`, { cause: error });
    }
  }
  return ran;
}

/** Drop and recreate a database, then apply all migrations (and optionally seeds). */
export async function resetDatabase(name: string, options: { seed?: boolean } = {}) {
  const admin = adminUrl();
  assertSafeToReset(admin);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error('invalid database name');
  const adminClient = new pg.Client({ connectionString: admin });
  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${name}`);
  } finally {
    await adminClient.end();
  }
  const client = new pg.Client({ connectionString: databaseUrlFor(name, admin) });
  await client.connect();
  try {
    const ran = await applyMigrations(client);
    // Local-only credential for the runtime role; real environments set it via secret managers.
    const roleExists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime'`);
    if (roleExists.rowCount === 1) {
      await client.query(`ALTER ROLE app_runtime WITH LOGIN PASSWORD 'local-dev-only'`);
    }
    const seeds: string[] = [];
    if (options.seed) {
      for (const seed of listSeeds()) {
        await client.query(seed.sql);
        seeds.push(seed.id);
      }
    }
    return { migrations: ran, seeds };
  } finally {
    await client.end();
  }
}
