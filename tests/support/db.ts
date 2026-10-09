import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';
import {
  adminUrl,
  applyMigrations,
  databaseUrlFor,
  listMigrations,
  resetDatabase,
  ROOT,
} from '../../scripts/db/lib';

export { adminUrl, applyMigrations, databaseUrlFor, listMigrations, resetDatabase };

/** Start the throwaway local cluster when no external admin URL is configured. */
export async function ensurePostgres(): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl() });
  try {
    await client.connect();
    await client.end();
    return;
  } catch {
    if (process.env.MIGRATION_ADMIN_URL)
      throw new Error(`PostgreSQL not reachable at MIGRATION_ADMIN_URL`);
  }
  execFileSync(join(ROOT, 'scripts', 'db', 'local-pg.sh'), ['start'], { stdio: 'ignore' });
}

/** Runtime-role connection string (app_runtime, local-only password set by resetDatabase). */
export function runtimeUrl(dbName: string): string {
  const url = new URL(databaseUrlFor(dbName));
  url.username = 'app_runtime';
  url.password = 'local-dev-only';
  return url.toString();
}

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Create an empty database (no migrations) for baseline-upgrade tests. */
export async function createEmptyDatabase(name: string): Promise<string> {
  const admin = await connect(adminUrl());
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return databaseUrlFor(name);
}

/** Insert an Auth user and onboarded profile using the elevated connection. */
export async function createUser(
  client: pg.Client,
  username: string,
  options: { confirmed?: boolean } = {},
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO auth.users (email, email_confirmed_at) VALUES ($1, $2) RETURNING id`,
    [`${username}@example.test`, options.confirmed === false ? null : new Date()],
  );
  const id = result.rows[0]!.id;
  await client.query(
    `INSERT INTO app_private.profiles (user_id, username, display_name, onboarded_at) VALUES ($1, $2, $3, now())`,
    [id, username, username.toUpperCase()],
  );
  return id;
}
